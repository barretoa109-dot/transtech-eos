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

import { adminSinTipos } from "../supabase/sin-tipos.ts";
import { UMBRAL_USO_ALTO, cuentasConUsoAlto, describirCuenta } from "./uso-alto.ts";

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
  // Sin tarifa, uso_mensual guarda los tokens pero el costo en USD queda en
  // cero: no se puede saber cuánto cuesta cada cliente.
  "EOS_USD_POR_MTOK_ENTRADA",
  "EOS_USD_POR_MTOK_SALIDA",
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
  chequeos.push(await chequeoEmbudo());
  chequeos.push(await chequeoChatReal());
  chequeos.push(await chequeoUsoAlto());

  const fallos = chequeos.filter((c) => !c.ok);

  return {
    sano: fallos.length === 0,
    verificado_en: new Date().toISOString(),
    chequeos,
    fallos,
  };
}

export type FilaEmbudo = {
  acciones_ok: number;
  activado_v1: boolean;
  primer_pago: string | null;
  ultimo_mensaje: string | null;
};

/**
 * El embudo de las cuentas REALES en una línea.
 *
 * Solo cuentas reales (`eos_cuentas_v172`): las de QA, certificación y las
 * huérfanas inflaban cada conteo de esta pantalla. "Activada" es la hipótesis
 * v1 de la migración v173 (acción exitosa + memoria + dos días de uso), no una
 * verdad: se muestra para poder mirarla, no para decidir con ella.
 */
export function resumirEmbudo(filas: FilaEmbudo[], ahora: number = Date.now()): string {
  const activas7d = filas.filter(
    (f) => f.ultimo_mensaje !== null && ahora - Date.parse(f.ultimo_mensaje) <= 7 * 86_400_000,
  ).length;
  const conAccion = filas.filter((f) => f.acciones_ok > 0).length;
  const activadas = filas.filter((f) => f.activado_v1).length;
  const pagaron = filas.filter((f) => f.primer_pago !== null).length;

  return (
    `${filas.length} cuentas reales · ${activas7d} activas en 7 días · ` +
    `${conAccion} con una acción exitosa · ${activadas} activadas · ${pagaron} con un pago`
  );
}

async function chequeoEmbudo(): Promise<Chequeo> {
  const nombre = "Embudo de cuentas reales (informativo)";

  try {
    const { data, error } = await adminSinTipos()
      .from("eos_analitica_usuario_v172")
      .select("acciones_ok,activado_v1,primer_pago,ultimo_mensaje")
      .eq("tipo", "real")
      .limit(5000);

    if (error) throw new Error(error.message);

    return { nombre, ok: true, detalle: resumirEmbudo((data ?? []) as FilaEmbudo[]) };
  } catch (error) {
    // Informativo: que no se pueda calcular no es una falla que alarme a nadie.
    return {
      nombre,
      ok: true,
      detalle: "no se pudo calcular: " + (error instanceof Error ? error.message : String(error)),
    };
  }
}

export type SolicitudChat = {
  usuario_id: string;
  status: string;
  release_reason: string | null;
  expires_at: string | null;
};

/** Cuántas solicitudes sin respuesta, y qué proporción, hacen que esto despierte a alguien. */
export const CHAT_MIN_FALLAS = 3;
export const CHAT_MIN_PROPORCION = 0.15;

/**
 * ¿Se le está cayendo el chat a la gente?
 *
 * Cada mensaje reserva cuota (`eos_message_usage_v40`) y la consume al
 * responder o la libera si falla. Una solicitud SIN RESPUESTA es una que se
 * liberó (n8n vacío, error del modelo, corte de red) o una reservada cuyo plazo
 * venció sin terminar: la persona escribió y no le contestamos.
 *
 * Solo cuentas REALES. El 2026-09-18 las 54 solicitudes vencidas del mes y las
 * 5 colgadas de ese día eran todas de la cuenta de certificación de Bancard: sin
 * este filtro la alarma sonaría por trabajo de prueba y se aprendería a ignorarla.
 *
 * Alarma si hay al menos `CHAT_MIN_FALLAS` sin respuesta Y son al menos el
 * `CHAT_MIN_PROPORCION` (15 %) del total. Calibrado con 30 días reales: el único
 * incidente (2026-09-16, 6 sin respuesta de 30 = 20 %, respuestas vacías de n8n)
 * tiene que alarmar, y con 15 % los otros 19 días con tráfico dan cero falsas
 * alarmas. Con 25 % ese incidente pasaba sin que nadie lo viera. Con este volumen (decenas por día) una falla
 * suelta no es una señal, y un porcentaje solo se dispara con dos mensajes.
 */
export function evaluarChat(
  solicitudes: SolicitudChat[],
  reales: Set<string>,
  ahora: number = Date.now(),
): { ok: boolean; detalle: string } {
  const propias = solicitudes.filter((x) => reales.has(x.usuario_id));

  let respondidas = 0;
  const motivos = new Map<string, number>();

  for (const x of propias) {
    if (x.status === "consumed") {
      respondidas++;
    } else if (x.status === "released") {
      const motivo = x.release_reason || "sin motivo";
      motivos.set(motivo, (motivos.get(motivo) ?? 0) + 1);
    } else if (
      x.status === "reserved" &&
      x.expires_at !== null &&
      Date.parse(x.expires_at) < ahora
    ) {
      motivos.set("nunca terminó", (motivos.get("nunca terminó") ?? 0) + 1);
    }
    // "reserved" con plazo vigente: todavía está en curso, no cuenta para ningún lado.
  }

  const sinRespuesta = [...motivos.values()].reduce((t, n) => t + n, 0);
  const total = respondidas + sinRespuesta;

  if (total === 0) return { ok: true, detalle: "sin mensajes de cuentas reales en 24 h" };

  const proporcion = sinRespuesta / total;
  const lista = [...motivos.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${m}: ${n}`)
    .join(", ");

  const detalle =
    `${total} ${total === 1 ? "solicitud" : "solicitudes"} de cuentas reales en 24 h · ` +
    `${respondidas} respondidas · ${sinRespuesta} sin respuesta` +
    (sinRespuesta > 0 ? ` (${lista})` : "");

  return {
    ok: !(sinRespuesta >= CHAT_MIN_FALLAS && proporcion >= CHAT_MIN_PROPORCION),
    detalle,
  };
}

/**
 * Informativo, nunca "roto": que una cuenta sin tope pase de 400 mensajes
 * es una decisión comercial por tomar, no una falla del sistema, y tumbar la
 * salud (que consulta un monitor externo) por eso lo haría parpadear. El aviso
 * por correo sale aparte, una vez por cuenta y por mes (ver `uso-alto.ts`).
 */
async function chequeoUsoAlto(): Promise<Chequeo> {
  const nombre = `Cuentas sin tope sobre ${UMBRAL_USO_ALTO} mensajes (informativo)`;

  try {
    const cuentas = await cuentasConUsoAlto(false);

    return {
      nombre,
      ok: true,
      detalle:
        cuentas.length === 0
          ? "ninguna este mes"
          : cuentas.map(describirCuenta).join(" | "),
    };
  } catch (error) {
    return {
      nombre,
      ok: true,
      detalle: "no se pudo calcular: " + (error instanceof Error ? error.message : String(error)),
    };
  }
}

async function chequeoChatReal(): Promise<Chequeo> {
  const nombre = "Chat de cuentas reales (24 h)";

  try {
    const admin = adminSinTipos();
    const desde = new Date(Date.now() - 24 * 3_600_000).toISOString();

    const [solicitudes, cuentas] = await Promise.all([
      admin
        .from("eos_message_usage_v40")
        .select("usuario_id,status,release_reason,expires_at")
        .gte("reserved_at", desde)
        .limit(5000),
      admin.from("eos_cuentas_v172").select("usuario_id").eq("tipo", "real").limit(5000),
    ]);

    if (solicitudes.error) throw new Error(solicitudes.error.message);
    if (cuentas.error) throw new Error(cuentas.error.message);

    const reales = new Set(((cuentas.data ?? []) as { usuario_id: string }[]).map((c) => c.usuario_id));
    const { ok, detalle } = evaluarChat((solicitudes.data ?? []) as SolicitudChat[], reales);

    return { nombre, ok, detalle };
  } catch (error) {
    // No poder medirlo es un problema de esta vigilancia, no un chat caído:
    // se informa, pero no dispara la alarma de "algo está roto".
    return {
      nombre,
      ok: true,
      detalle: "no se pudo calcular: " + (error instanceof Error ? error.message : String(error)),
    };
  }
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
  consumo?: {
    periodo: string;
    usuarios: number;
    mensajes: number;
    tokens_entrada: number;
    tokens_salida: number;
    costo_usd: number;
    el_mas_caro: {
      tokens: number;
      mensajes: number;
      costo_usd: number;
      plan: string;
    } | null;
  };
};

async function chequeosOperativos(): Promise<Chequeo[]> {
  let datos: Operativa;

  try {
    const { data, error } = await adminSinTipos().rpc("eos_salud_operativa");

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

  const { pagos, acciones, briefing, documentos, uso, consumo } = datos;

  const miles = (n: number) => Number(n || 0).toLocaleString("es-PY");

  /*
   * ============================================================
   * LO QUE CUESTA ATENDER A LA GENTE
   * ============================================================
   *
   * Informativo y no vigilado, porque no hay un número que esté "roto": lo que
   * es mucho depende de la tarifa de OpenAI del momento y de lo que se esté
   * cobrando. Pero tiene que estar a la vista, porque hasta hace dos días EOS
   * cobraba una suscripción sin saber cuánto gastaba en atenderla.
   *
   * El más caro va aparte del total a propósito. El promedio esconde justamente
   * al usuario que rompe la cuenta: con veinte clientes tranquilos y uno que
   * manda fotos todo el día, el promedio se ve sano y el margen no lo está. Y
   * el tramo de conversaciones ilimitadas no tiene techo de consumo.
   */
  const filasConsumo: Chequeo[] = consumo
    ? [
        {
          nombre: "Consumo del mes (informativo)",
          ok: true,
          detalle:
            `${consumo.usuarios} ${consumo.usuarios === 1 ? "usuario" : "usuarios"} · ` +
            `${miles(consumo.mensajes)} mensajes · ` +
            `${miles(consumo.tokens_entrada + consumo.tokens_salida)} tokens` +
            (consumo.costo_usd > 0 ? ` · USD ${consumo.costo_usd}` : " · costo sin tarifa configurada"),
        },
        {
          nombre: "El usuario más pesado (informativo)",
          ok: true,
          detalle: consumo.el_mas_caro
            ? `${miles(consumo.el_mas_caro.tokens)} tokens en ` +
              `${consumo.el_mas_caro.mensajes} ` +
              `${consumo.el_mas_caro.mensajes === 1 ? "mensaje" : "mensajes"} · ` +
              `plan ${consumo.el_mas_caro.plan}`
            : "todavía nadie consumió este mes",
        },
      ]
    : [];

  return [
    ...filasConsumo,
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
