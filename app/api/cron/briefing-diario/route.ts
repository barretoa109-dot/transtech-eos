import { timingSafeEqual } from "crypto";
import { after } from "next/server";
import { NextResponse } from "next/server";
import { Resend } from "resend";

import { renderBriefing, type BriefingFila } from "@/lib/briefing/email";
import { correrChequeos, enviarAlerta } from "@/lib/monitoreo/salud";
import { avisarUsoAlto } from "@/lib/monitoreo/uso-alto";
import { avisarRiesgos } from "@/lib/finanzas/avisarRiesgos";
import { avisarAgenda } from "@/lib/calendario/avisar-agenda";
import { avisarRiesgosNegocio } from "@/lib/erp/avisar-negocio";
import { avisarSeguimientosCRM } from "@/lib/crm/avisar-crm";
import { enviarMotivacionales } from "@/lib/email/motivacionales";
import { capturarIndicadores } from "@/lib/kpi/capturar";
import { capturarPulsoPersonal } from "@/lib/finanzas/capturarPulso";
import { puntuarBriefingsDeHoy } from "@/lib/kpi/scoreBriefing";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/*
 * Envío del briefing diario por correo.
 *
 * El motor de briefing ya generaba contenido todos los días; lo que faltaba
 * era que saliera de la app. Un producto que solo existe cuando lo abrís no
 * genera el hábito que lo vuelve indispensable.
 *
 * Reglas que definen el comportamiento, todas deliberadas:
 *
 *  - ES OPT-IN. Solo se envía a quien tenga `canal_email = true` en
 *    `eos_followup_preferences`, cuyo default es `false`. Nadie recibe un
 *    correo que no pidió: mandarlo sin permiso quema el canal para siempre.
 *  - UNA VEZ POR DÍA. El UNIQUE de `eos_briefing_envios` es la garantía;
 *    recibir el mismo briefing dos veces destruye la confianza en el canal.
 *  - SOLO BRIEFINGS DE HOY. Si el motor no generó el de hoy, no se manda el
 *    de ayer disfrazado de actual.
 *  - UN FALLO NO FRENA AL RESTO. Cada usuario se procesa aislado y su error
 *    queda registrado en la fila, no solo en los logs.
 *
 * Limitación conocida: el plan Hobby de Vercel permite una sola ejecución
 * diaria, así que `hora_local` de las preferencias todavía no se respeta —
 * todos reciben a la hora del cron. Cuando haya plan con cron por hora, este
 * mismo endpoint puede filtrar por `hora_local` sin más cambios.
 */

const MAX_POR_EJECUCION = 200;

function baseUrlApp() {
  const base =
    process.env.EOS_APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://www.transtech.com.py";

  return base.replace(/\/$/, "");
}

function autorizado(request: Request) {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) return { ok: false, sinConfigurar: true };

  const header = request.headers.get("authorization") || "";
  const recibido = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!recibido) return { ok: false, sinConfigurar: false };

  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return { ok: false, sinConfigurar: false };

  return { ok: timingSafeEqual(a, b), sinConfigurar: false };
}

/** Hoy en Paraguay. El día del briefing es el del usuario, no el del servidor. */
function hoyEnParaguay() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return partes; // en-CA ya devuelve YYYY-MM-DD
}

export async function GET(request: Request) {
  const permiso = autorizado(request);
  if (permiso.sinConfigurar) {
    return NextResponse.json({ error: "Cron no configurado." }, { status: 503 });
  }
  if (!permiso.ok) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  // El chequeo de salud viaja pegado a este cron porque el plan Hobby de
  // Vercel solo permite dos crons y los dos ya están usados.
  //
  // Se agenda ACÁ, apenas pasa la autorización y antes de cualquier `return`
  // temprano: si nadie tiene el briefing activado, la función corta antes de
  // llegar al final y el chequeo nunca se ejecutaría — justo el escenario en
  // el que más falta hace, porque nadie estaría mirando.
  //
  // Va en `after()` para no demorar la respuesta, y solo avisa si algo falla.
  after(async () => {
    try {
      const base = baseUrlApp();
      const reporte = await correrChequeos(base);
      if (!reporte.sano) await enviarAlerta(reporte, base);
    } catch (error) {
      console.error("Briefing: falló el chequeo de salud posterior:", error);
    }
  });

  // Aviso INTERNO de consumo: cuentas que llevan Gs. 70.000 de IA en el mes. Nunca
  // le llega a la persona y no corta nada; es para que decidan quienes administran
  // EOS. Sale en el momento del mensaje (`procesar-mensaje.ts`); esto es el
  // respaldo, por si ese correo falló. Va acá, antes de cualquier salida temprana,
  // por lo mismo que el chequeo de salud. Cada cuenta se avisa una vez por mes.
  after(async () => {
    try {
      await avisarUsoAlto(baseUrlApp());
    } catch (error) {
      console.error("Briefing: falló el aviso de uso alto:", error);
    }
  });

  // El aviso de la agenda: lo que la persona anotó —a mano o por el chat— para hoy y
  // para mañana, y lo que quedó atrás. Va en su PROPIO `after` y antes de cualquier
  // salida temprana, por lo mismo que el chequeo de salud: si nadie tiene el briefing
  // activado o falta la clave de correo, este aviso igual tiene que salir por push.
  //
  // Es independiente de los avisos de riesgo (esos son de plata y de negocio, con su
  // propio historial): un recordatorio es algo que la persona pidió que le recuerden.
  after(async () => {
    try {
      const clave = process.env.RESEND_API_KEY;

      const resumen = await avisarAgenda(adminSinTipos(), {
        hoy: hoyEnParaguay(),
        enviarCorreo: clave
          ? async ({ para, asunto, texto }) => {
              await new Resend(clave).emails.send({
                from: process.env.EOS_BRIEFING_FROM || "EOS <no-reply@transtech.com.py>",
                to: para,
                subject: asunto,
                text: texto,
              });
            }
          : undefined,
      });

      console.log("Agenda: avisos del día", resumen);
    } catch (error) {
      console.error("Briefing: falló el aviso de agenda:", error);
    }
  });

  // Los avisos de riesgo se agendan ACÁ por el mismo motivo que el chequeo de
  // salud: los `return` tempranos de más abajo —sin RESEND_API_KEY, sin nadie
  // suscripto al correo— se saltearían este trabajo. Ya pasó dos veces en este
  // archivo; la tercera se evita poniéndolo antes de cualquier salida.
  //
  // Es independiente del briefing a propósito: el briefing es un resumen que
  // se lee cuando se puede, y esto es un aprieto con fecha. Que alguien tenga
  // el resumen apagado no significa que no quiera enterarse de que el 28 no le
  // va a alcanzar.
  after(async () => {
    try {
      const cliente = adminSinTipos();
      const clave = process.env.RESEND_API_KEY;

      const resumen = await avisarRiesgos(cliente, {
        hoy: hoyEnParaguay(),
        // El correo es el respaldo de quien no tiene push. Si no hay clave, se
        // avisa igual por push: media entrega es mejor que ninguna.
        enviarCorreo: clave
          ? async ({ para, asunto, texto }) => {
              await new Resend(clave).emails.send({
                from: process.env.EOS_BRIEFING_FROM || "EOS <no-reply@transtech.com.py>",
                to: para,
                subject: asunto,
                text: texto,
              });
            }
          : undefined,
      });

      console.log("Riesgo: avisos del día", resumen);

      // Los riesgos del negocio van en el mismo `after` pero en su propio
      // recorrido: evalúan a quien tiene el módulo ERP, que no es la misma
      // gente que definió su Constitución Financiera. Ver `lib/erp/avisar-negocio`.
      const negocio = await avisarRiesgosNegocio(cliente, {
        hoy: hoyEnParaguay(),
        enviarCorreo: clave
          ? async ({ para, asunto, texto }) => {
              await new Resend(clave).emails.send({
                from: process.env.EOS_BRIEFING_FROM || "EOS <no-reply@transtech.com.py>",
                to: para,
                subject: asunto,
                text: texto,
              });
            }
          : undefined,
      });

      console.log("Negocio: avisos del día", negocio);

      /*
       * El CRM, en su propio try: aprende de lo que se cerró y avisa a quién hay que retomar.
       * Que falle no le quita al negocio sus avisos (ya salieron) ni al barrido de abajo.
       */
      try {
        const crm = await avisarSeguimientosCRM(cliente, {
          hoy: hoyEnParaguay(),
          enviarCorreo: clave
            ? async ({ para, asunto, texto }) => {
                await new Resend(clave).emails.send({
                  from: process.env.EOS_BRIEFING_FROM || "EOS <no-reply@transtech.com.py>",
                  to: para,
                  subject: asunto,
                  text: texto,
                });
              }
            : undefined,
        });

        console.log("CRM: seguimientos del día", crm);
      } catch (error) {
        console.error("CRM: falló el aviso de seguimientos:", error);
      }

      /*
       * Y se barren los contadores de límite que ya no afectan a nadie.
       *
       * Va acá y no en `pg_cron`, que este proyecto no usa. Sin barrido, la
       * tabla acumula una fila por cada visitante que alguna vez tocó una ruta
       * pública — y aunque las claves sean opacas, guardar para siempre algo
       * que ya no sirve es guardar de más.
       */
      const { data: limpiados } = await cliente.rpc("eos_limpiar_limites_v99");
      console.log("Límites: contadores vencidos borrados:", limpiados ?? 0);
    } catch (error) {
      console.error("Briefing: falló la detección de riesgos:", error);
    }
  });

  /*
   * La foto diaria de los indicadores, en su PROPIO `after`.
   *
   * Separado del bloque de avisos a propósito: son cosas distintas y un fallo
   * de una no puede llevarse la otra. Avisar de un aprieto es urgente; guardar
   * la historia es acumulativo —un día perdido es un hueco en la serie, no una
   * noticia que no llegó— así que va después y aislado.
   *
   * Sin esto, la tendencia de un indicador nunca podría ser más que "este mes
   * contra el anterior": el margen de julio no se puede recalcular hoy porque
   * el costo del producto cambió, y el stock no tiene historia.
   */
  after(async () => {
    try {
      const captura = await capturarIndicadores(adminSinTipos(), { hoy: hoyEnParaguay() });
      console.log("KPI: foto diaria de indicadores", captura);
    } catch (error) {
      console.error("KPI: falló la captura diaria de indicadores:", error);
    }

    /*
     * Y la foto del pulso PERSONAL, en la misma cola pero en su propio try:
     * si la del negocio falla, quien solo lleva sus finanzas personales igual
     * tiene que quedarse con su serie (son dos poblaciones distintas).
     *
     * Iban en dos `after` separados. Ahora van uno detrás del otro porque el
     * score del briefing (abajo) necesita las DOS fotos de hoy: corriendo en
     * paralelo no habría forma de saber cuándo terminaron las dos.
     */
    try {
      const pulso = await capturarPulsoPersonal(adminSinTipos(), { hoy: hoyEnParaguay() });
      console.log("Pulso: foto diaria personal", pulso);
    } catch (error) {
      console.error("Pulso: falló la captura diaria personal:", error);
    }

    // El EOS Score real en el briefing de hoy, en vez del 0 de relleno que
    // escribe la base. Ver `lib/kpi/scoreBriefing.ts`.
    try {
      const score = await puntuarBriefingsDeHoy(adminSinTipos(), hoyEnParaguay());
      console.log("Score: briefings de hoy puntuados", score);
    } catch (error) {
      console.error("Score: falló el score de los briefings de hoy:", error);
    }
  });

  /*
   * El correo motivacional, cada 3 días, en su PROPIO `after`.
   *
   * Corre todos los días y es idempotente: el ciclo de 3 días lo decide
   * `enviarMotivacionales`, no el cron (el plan Hobby no deja crear otro).
   * Va antes de los `return` tempranos por el mismo motivo que el resto —
   * "nadie tiene el briefing activado" no tiene nada que ver con este correo,
   * que le llega a toda cuenta que no se dio de baja.
   */
  after(async () => {
    try {
      const clave = process.env.RESEND_API_KEY;
      const secreto = process.env.CRON_SECRET;
      if (!clave || !secreto) {
        console.error("Motivacionales: falta RESEND_API_KEY o CRON_SECRET; no se manda.");
        return;
      }

      const resend = new Resend(clave);
      const resumen = await enviarMotivacionales(adminSinTipos(), {
        hoy: hoyEnParaguay(),
        appUrl: baseUrlApp(),
        secreto,
        enviar: async ({ para, asunto, html, texto, urlBaja }) => {
          const { error } = await resend.emails.send({
            from: process.env.EOS_BRIEFING_FROM || "EOS <no-reply@transtech.com.py>",
            to: para,
            subject: asunto,
            html,
            text: texto,
            // Baja de un clic para los clientes de correo (RFC 8058).
            headers: {
              "List-Unsubscribe": `<${urlBaja}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          });
          if (error) throw new Error(error.message ?? "Resend rechazó el envío.");
        },
      });

      console.log("Motivacionales: correos del ciclo", resumen);
    } catch (error) {
      console.error("Motivacionales: falló el envío del ciclo:", error);
    }
  });

  const apiKey = process.env.RESEND_API_KEY;
  const remitente = process.env.EOS_BRIEFING_FROM || "EOS <no-reply@transtech.com.py>";

  // Validado antes de construir el cliente: `new Resend(undefined)` lanza, y
  // un throw acá se leería como otra cosa. Misma lección que el webhook.
  if (!apiKey) {
    console.error("Briefing: falta RESEND_API_KEY.");
    return NextResponse.json({ error: "Correo no configurado." }, { status: 503 });
  }

  const resend = new Resend(apiKey);
  const admin = adminSinTipos();
  const hoy = hoyEnParaguay();

  const { data: preferencias, error: prefError } = await admin
    .from("eos_followup_preferences")
    .select("usuario_id")
    .eq("canal_email", true)
    .eq("habilitado", true)
    .limit(MAX_POR_EJECUCION);

  if (prefError) {
    console.error("Briefing: no se pudieron leer las preferencias:", prefError);
    return NextResponse.json({ error: "No disponible." }, { status: 503 });
  }

  const destinatarios = (preferencias ?? []) as { usuario_id: string }[];

  if (destinatarios.length === 0) {
    return NextResponse.json({ ok: true, fecha: hoy, suscriptos: 0, enviados: 0 });
  }

  const ids = destinatarios.map((p) => p.usuario_id);

  const [{ data: briefings }, { data: perfiles }, { data: yaEnviados }] = await Promise.all([
    admin
      .from("eos_daily_briefings")
      .select(
        "usuario_id,briefing_date,saludo,titulo_dia,resumen,enfoque_dia,prioridad_1,prioridad_2,prioridad_3,recomendacion_principal,proximos_pasos,riesgos,score",
      )
      .in("usuario_id", ids)
      .eq("briefing_date", hoy)
      .eq("estado", "listo"),
    admin.from("usuarios").select("id,nombre,email").in("id", ids),
    admin
      .from("eos_briefing_envios")
      .select("usuario_id")
      .eq("briefing_date", hoy)
      .eq("canal", "email")
      .in("usuario_id", ids),
  ]);

  const porUsuario = new Map<string, BriefingFila>();
  for (const b of (briefings ?? []) as (BriefingFila & { usuario_id: string })[]) {
    porUsuario.set(b.usuario_id, b);
  }

  const perfilDe = new Map<string, { nombre: string | null; email: string | null }>();
  for (const p of (perfiles ?? []) as { id: string; nombre: string | null; email: string | null }[]) {
    perfilDe.set(p.id, { nombre: p.nombre, email: p.email });
  }

  const enviadosPrevios = new Set(
    ((yaEnviados ?? []) as { usuario_id: string }[]).map((e) => e.usuario_id),
  );

  // La pestaña de Briefing, no el chat pelado: es a donde el correo dice que
  // lleva, y sin el parámetro la persona caía siempre en el chat y tenía que
  // ir a buscarla ella misma.
  const urlApp = `${baseUrlApp()}/eos/chat?vista=briefing`;
  let enviados = 0;
  let omitidos = 0;
  let fallidos = 0;

  for (const usuarioId of ids) {
    if (enviadosPrevios.has(usuarioId)) {
      omitidos += 1;
      continue;
    }

    const briefing = porUsuario.get(usuarioId);
    const perfil = perfilDe.get(usuarioId);

    // Sin briefing de hoy no se manda nada: preferimos el silencio a mandar
    // el de ayer como si fuera el de hoy.
    if (!briefing || !perfil?.email) {
      omitidos += 1;
      continue;
    }

    try {
      const { asunto, html, texto } = renderBriefing(briefing, {
        nombre: perfil.nombre,
        urlApp,
      });

      const { error: envioError } = await resend.emails.send({
        from: remitente,
        to: perfil.email,
        subject: asunto,
        html,
        text: texto,
      });

      if (envioError) throw new Error(envioError.message ?? "Resend rechazó el envío.");

      // Se registra DESPUÉS de enviar: si el insert falla, el peor caso es un
      // duplicado mañana, no un usuario que nunca recibe nada.
      await admin.from("eos_briefing_envios").insert({
        usuario_id: usuarioId,
        briefing_date: hoy,
        canal: "email",
        estado: "enviado",
      });

      enviados += 1;
    } catch (error) {
      fallidos += 1;
      const detalle = error instanceof Error ? error.message : "Error desconocido";
      console.error(`Briefing: fallo enviando a ${usuarioId}:`, detalle);

      await admin
        .from("eos_briefing_envios")
        .insert({
          usuario_id: usuarioId,
          briefing_date: hoy,
          canal: "email",
          estado: "error",
          detalle: detalle.slice(0, 500),
        })
        .then(
          () => undefined,
          () => undefined,
        );
    }
  }

  return NextResponse.json({
    ok: true,
    fecha: hoy,
    suscriptos: ids.length,
    enviados,
    omitidos,
    fallidos,
  });
}
