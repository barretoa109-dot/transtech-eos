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

import { createAdminClient } from "@/lib/supabase-admin";

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
  // Sin estas dos el push queda apagado en silencio: el botón directamente no
  // aparece y nadie se entera de que falta configuración.
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
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

  // Entorno de cobros, siempre visible.
  //
  // Cobrar tarjetas reales apuntando a staging —o al revés— es un desastre
  // silencioso: no falla nada visible, simplemente el dinero no existe donde
  // se cree que existe. Tenerlo a la vista en el chequeo evita descubrirlo
  // por un cliente que reclama.
  const entornoBancard = (process.env.BANCARD_ENV || "staging").trim().toLowerCase();
  chequeos.push({
    nombre: "Entorno de cobros (Bancard)",
    ok: true,
    detalle:
      entornoBancard === "production"
        ? "PRODUCCIÓN — se cobran tarjetas reales"
        : `${entornoBancard} — los cobros son de prueba, no entra dinero`,
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

  /* ============================================================
     CÓMO VINO FUNCIONANDO, NO CÓMO ESTÁ CONFIGURADO
     ============================================================

     Todo lo de arriba puede estar perfecto mientras un aviso de pago lleva seis
     horas sin procesarse. Esa es la clase de falla que nadie ve: no hay
     excepción, no hay 500, simplemente algo no pasó.

     Los números salen de `eos_salud_operativa()` en un solo viaje. Los umbrales
     se deciden acá y no en la base, porque acá se pueden explicar en castellano
     y cambiar sin una migración. */
  chequeos.push(...(await chequeosOperativos()));

  const fallos = chequeos.filter((c) => !c.ok);

  return {
    sano: fallos.length === 0,
    verificado_en: new Date().toISOString(),
    chequeos,
    fallos,
  };
}

type Operativa = {
  pagos: {
    avisos_sin_procesar: number;
    avisos_con_error: number;
    pagados_hoy: number;
    rechazados_hoy: number;
  };
  acciones: { con_error_24h: number; trabadas: number; completadas_24h: number };
  briefing: { con_error_hoy: number; enviados_hoy: number };
  documentos: { generados_24h: number };
  uso: { usuarios_activos_24h: number };
};

async function chequeosOperativos(): Promise<Chequeo[]> {
  let datos: Operativa;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el cliente tipado no conoce esta función
    const { data, error } = await (createAdminClient() as any).rpc("eos_salud_operativa");

    if (error) throw new Error(error.message);

    datos = data as Operativa;
  } catch (error) {
    return [
      {
        nombre: "Estado operativo",
        ok: false,
        detalle:
          "no se pudo consultar: " + (error instanceof Error ? error.message : String(error)),
      },
    ];
  }

  const { pagos, acciones, briefing, documentos, uso } = datos;

  return [
    {
      /*
       * El peor fallo posible de todo el sistema: alguien pagó y nosotros no
       * nos enteramos. No hay error visible en ningún lado; simplemente la
       * persona no recibe lo que compró.
       */
      nombre: "Avisos de pago procesados",
      ok: pagos.avisos_sin_procesar === 0,
      detalle:
        pagos.avisos_sin_procesar === 0
          ? `${pagos.pagados_hoy} cobrados y ${pagos.rechazados_hoy} rechazados en 24 h`
          : `${pagos.avisos_sin_procesar} sin procesar hace más de 15 minutos`,
    },
    {
      nombre: "Avisos de pago sin error",
      ok: pagos.avisos_con_error === 0,
      detalle:
        pagos.avisos_con_error === 0
          ? "ninguno con error en 24 h"
          : `${pagos.avisos_con_error} con error en 24 h`,
    },
    {
      /*
       * Tomadas por un worker que nunca volvió. El lease existe para que otro
       * las retome; si venció y siguen en ejecución, nadie lo hizo.
       */
      nombre: "Acciones sin trabar",
      ok: acciones.trabadas === 0,
      detalle:
        acciones.trabadas === 0
          ? `${acciones.completadas_24h} completadas en 24 h`
          : `${acciones.trabadas} tomadas por un worker que no volvió`,
    },
    {
      /*
       * Las acciones con error NO tumban la salud, y es a propósito: la mayoría
       * son el sistema haciendo lo correcto —negarse a vender un producto
       * ambiguo, rechazar un cliente que no existe—. Se muestran para poder
       * mirarlas, no para despertar a nadie.
       */
      nombre: "Acciones con error (informativo)",
      ok: true,
      detalle: `${acciones.con_error_24h} en 24 h`,
    },
    {
      nombre: "Briefing diario",
      ok: briefing.con_error_hoy === 0,
      detalle:
        briefing.con_error_hoy === 0
          ? `${briefing.enviados_hoy} enviados hoy`
          : `${briefing.con_error_hoy} fallaron hoy`,
    },
    {
      nombre: "Actividad (informativo)",
      ok: true,
      detalle:
        `${uso.usuarios_activos_24h} usuarios activos · ` +
        `${documentos.generados_24h} documentos generados en 24 h`,
    },
  ];
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
