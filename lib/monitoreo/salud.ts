/**
 * Chequeo de salud de EOS.
 *
 * Existe por una razón concreta: el formulario de contacto del sitio estuvo
 * devolviendo 503 durante un tiempo indeterminado —ninguna consulta de ventas
 * llegaba— y nadie se enteró hasta que lo descubrimos por casualidad
 * diagnosticando otra cosa.
 *
 * Ese fallo, y el 401 del webhook de correo, tenían algo en común: **no eran
 * excepciones**. Eran respuestas manejadas, correctas desde el punto de vista
 * del código. Un capturador de errores tipo Sentry no los habría visto. Lo
 * único que los detecta es preguntar periódicamente "¿esto sigue respondiendo
 * lo que tiene que responder?".
 *
 * Reglas de diseño:
 *  - Silencio = todo bien. Solo se avisa cuando algo está roto; una alerta
 *    diaria que casi siempre dice "ok" se ignora a las dos semanas.
 *  - Ningún chequeo puede tumbar al resto: cada uno se aísla.
 *  - Nada destructivo. Los chequeos leen, nunca escriben.
 */

export type Chequeo = {
  nombre: string;
  ok: boolean;
  detalle: string;
};

export type Reporte = {
  sano: boolean;
  verificado_en: string;
  chequeos: Chequeo[];
  fallos: Chequeo[];
};

/** Variables sin las cuales alguna parte de EOS deja de funcionar en silencio. */
const VARIABLES_CRITICAS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "RESEND_API_KEY",
  "CRON_SECRET",
] as const;

/**
 * Variables que, si faltan, apagan una función entera sin romper nada visible.
 * Se reportan aparte porque su ausencia puede ser deliberada.
 */
const VARIABLES_OPCIONALES = [
  "RESEND_WEBHOOK_SECRET",
  "EOS_CORREO_DOMINIO",
  "EOS_APP_BASE_URL",
  // Tiene un valor por defecto escrito en `app/api/eos/route.ts`, así que su
  // ausencia no rompe el chat. Se informa igual porque significa que la URL
  // de n8n vive en el código: si n8n cambia de dirección haría falta un
  // deploy en vez de cambiar una variable.
  "N8N_EOS_WEBHOOK_URL",
] as const;

async function aislar(nombre: string, fn: () => Promise<Chequeo>): Promise<Chequeo> {
  try {
    return await fn();
  } catch (error) {
    return {
      nombre,
      ok: false,
      detalle: error instanceof Error ? error.message : "error desconocido",
    };
  }
}

/**
 * Verifica que un endpoint siga devolviendo lo que corresponde.
 *
 * Se comprueba contra los códigos ESPERADOS, no contra "no falló". El
 * formulario de contacto respondía 503 con toda normalidad: para el servidor
 * no había ningún error, y sin embargo estaba roto.
 */
async function verificarEndpoint(
  nombre: string,
  url: string,
  opciones: { esperados: number[]; metodo?: string; cuerpo?: string },
): Promise<Chequeo> {
  const res = await fetch(url, {
    method: opciones.metodo ?? "GET",
    headers: opciones.cuerpo ? { "Content-Type": "application/json" } : undefined,
    body: opciones.cuerpo,
    cache: "no-store",
  });

  const ok = opciones.esperados.includes(res.status);

  return {
    nombre,
    ok,
    detalle: ok
      ? `HTTP ${res.status}`
      : `HTTP ${res.status}, se esperaba ${opciones.esperados.join(" o ")}`,
  };
}

export async function correrChequeos(baseUrl: string): Promise<Reporte> {
  const chequeos: Chequeo[] = [];

  // --- Configuración -----------------------------------------------------
  const faltantes = VARIABLES_CRITICAS.filter((v) => !process.env[v]);
  chequeos.push({
    nombre: "Variables de entorno críticas",
    ok: faltantes.length === 0,
    detalle: faltantes.length === 0 ? "todas presentes" : `faltan: ${faltantes.join(", ")}`,
  });

  const opcionalesFaltantes = VARIABLES_OPCIONALES.filter((v) => !process.env[v]);
  if (opcionalesFaltantes.length > 0) {
    chequeos.push({
      nombre: "Funciones desactivadas por configuración",
      ok: true, // No es un fallo: puede ser deliberado. Se informa, no se alarma.
      detalle: `sin configurar: ${opcionalesFaltantes.join(", ")}`,
    });
  }

  // --- Endpoints públicos ------------------------------------------------
  //
  // El contacto se prueba con un cuerpo vacío a propósito: la validación del
  // cuerpo ocurre DESPUÉS del chequeo de configuración, así que un 400 prueba
  // que el servicio de correo está bien y un 503 delata que no.
  chequeos.push(
    await aislar("Formulario de contacto", () =>
      verificarEndpoint("Formulario de contacto", `${baseUrl}/api/ventas/contacto`, {
        metodo: "POST",
        cuerpo: "{}",
        esperados: [400],
      }),
    ),
  );

  // Sin firma tiene que rechazar con 401. Un 503 significaría que le falta
  // configuración y estaría descartando correos del usuario en silencio.
  if (process.env.RESEND_WEBHOOK_SECRET) {
    chequeos.push(
      await aislar("Webhook de ingesta por correo", () =>
        verificarEndpoint("Webhook de ingesta por correo", `${baseUrl}/api/finanzas/correo`, {
          metodo: "POST",
          cuerpo: "{}",
          esperados: [401],
        }),
      ),
    );
  }

  chequeos.push(
    await aislar("Páginas legales", async () => {
      const [priv, term] = await Promise.all([
        fetch(`${baseUrl}/privacidad`, { cache: "no-store" }),
        fetch(`${baseUrl}/terminos`, { cache: "no-store" }),
      ]);
      const ok = priv.ok && term.ok;
      return {
        nombre: "Páginas legales",
        ok,
        detalle: ok ? "ambas responden" : `privacidad ${priv.status}, términos ${term.status}`,
      };
    }),
  );

  const fallos = chequeos.filter((c) => !c.ok);

  return {
    sano: fallos.length === 0,
    verificado_en: new Date().toISOString(),
    chequeos,
    fallos,
  };
}

/**
 * Manda la alerta por correo. Solo tiene efecto si hay fallos.
 *
 * Vive acá y no en la ruta para que el cron diario y el endpoint de salud
 * usen exactamente el mismo camino: dos implementaciones del mismo aviso
 * terminan divergiendo, y la que se rompe es siempre la que nadie mira.
 */
export async function enviarAlerta(reporte: Reporte, baseUrl: string): Promise<void> {
  if (reporte.sano) return;

  const apiKey = process.env.RESEND_API_KEY;
  const destino = process.env.ADMIN_EMAILS?.split(",")[0]?.trim();

  if (!apiKey || !destino) {
    console.error(
      "Salud: hay fallos pero no se puede avisar (falta RESEND_API_KEY o ADMIN_EMAILS).",
      reporte.fallos,
    );
    return;
  }

  try {
    const { Resend } = await import("resend");
    const { asunto, html, texto } = redactarAlerta(reporte, baseUrl);

    await new Resend(apiKey).emails.send({
      from: process.env.EOS_BRIEFING_FROM || "EOS <no-reply@transtech.com.py>",
      to: destino,
      subject: asunto,
      html,
      text: texto,
    });
  } catch (error) {
    // Si ni el aviso se puede mandar, al menos que quede en los logs.
    console.error("Salud: no se pudo enviar la alerta:", error, reporte.fallos);
  }
}

/** Correo de alerta. Solo se manda cuando hay algo roto. */
export function redactarAlerta(reporte: Reporte, baseUrl: string) {
  const lineas = reporte.fallos.map((f) => `• ${f.nombre}: ${f.detalle}`).join("\n");

  const texto = [
    "EOS detectó que algo dejó de funcionar:",
    "",
    lineas,
    "",
    `Verificado: ${reporte.verificado_en}`,
    baseUrl,
    "",
    "Este aviso solo se envía cuando hay un problema.",
  ].join("\n");

  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f172a">
<p style="margin:0 0 14px"><strong>EOS detectó que algo dejó de funcionar:</strong></p>
<ul style="list-style:disc outside;padding-left:20px;margin:0 0 16px">
${reporte.fallos.map((f) => `<li style="margin-bottom:6px"><strong>${f.nombre}</strong>: ${f.detalle}</li>`).join("")}
</ul>
<p style="margin:0 0 6px;font-size:13px;color:#64748b">Verificado: ${reporte.verificado_en}</p>
<p style="margin:0;font-size:13px;color:#64748b">Este aviso solo se envía cuando hay un problema.</p>
</div>`;

  return {
    asunto: `EOS · ${reporte.fallos.length} ${reporte.fallos.length === 1 ? "problema detectado" : "problemas detectados"}`,
    texto,
    html,
  };
}
