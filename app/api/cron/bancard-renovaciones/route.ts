import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase-admin";
import { ejecutarCobroBancard } from "@/lib/bancard-cobro";
import { hoyEnParaguay } from "@/lib/fecha";
import {
  avisarRenovacionPendiente,
  type EnviarCorreo,
  type MotivoRenovacion,
} from "@/lib/pagos/avisoRenovacion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/*
 * Renovación automática de suscripciones con tarjeta guardada.
 *
 * Se ejecuta por cron. Busca suscripciones por vencer (o recién
 * vencidas, dentro de una ventana de gracia) que tengan una tarjeta
 * principal activa, y las cobra sin intervención del usuario.
 *
 * Protecciones contra doble cobro:
 *  - sólo entran suscripciones cuyo vencimiento cae en la ventana;
 *  - se saltea a quien ya tenga un pago Bancard acreditado en las
 *    últimas 24 h (el cobro exitoso empuja el vencimiento fuera de la
 *    ventana, pero esto cubre reintentos del cron en el mismo día);
 *  - la confirmación en base es idempotente.
 */

const DIAS_ANTICIPACION = 1;
const DIAS_GRACIA = 3;
const MAX_POR_EJECUCION = 50;

function baseUrlApp() {
  const base =
    process.env.EOS_APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://www.transtech.com.py";

  return base.replace(/\/$/, "");
}

/*
 * El correo es el respaldo de quien no tiene push activado. Sin la clave se
 * avisa igual por push: media entrega es mejor que ninguna.
 */
function armarEnviarCorreo(): EnviarCorreo | undefined {
  const clave = process.env.RESEND_API_KEY;

  if (!clave) return undefined;

  return async ({ para, asunto, texto }) => {
    await new Resend(clave).emails.send({
      from: process.env.EOS_BRIEFING_FROM || "EOS <no-reply@transtech.com.py>",
      to: para,
      subject: asunto,
      text: texto,
    });
  };
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

export async function GET(request: Request) {
  const permiso = autorizado(request);

  if (permiso.sinConfigurar) {
    return NextResponse.json(
      { error: "Renovación automática no configurada." },
      { status: 503 },
    );
  }

  if (!permiso.ok) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const admin: any = createAdminClient();
  const ahora = new Date();

  const hasta = new Date(ahora.getTime() + DIAS_ANTICIPACION * 86_400_000);
  const desde = new Date(ahora.getTime() - DIAS_GRACIA * 86_400_000);

  /*
   * A quién hay que renovarle: dos poblaciones, no una.
   *
   * La consulta original buscaba por `usuarios.plan_vencimiento`, que servía
   * cuando el plan ERA el producto. Con el plan armado hay un caso que se cae
   * de esa red y no hace ruido:
   *
   * Quien contrató el panel y el briefing pero ningún tramo de conversaciones
   * queda con `plan = 'free'` —se puede tener EOS sin chatear— y
   * `asignar_plan_eos` le pone `plan_vencimiento = NULL` a todo lo que sea
   * free. Un NULL no entra en un filtro de rango, así que ese usuario nunca
   * sería candidato: sus módulos vencerían en silencio, dejaría de tener el
   * producto que paga y nadie le volvería a cobrar. Las dos pérdidas sin una
   * sola alarma.
   *
   * Entonces:
   *
   *   A. Planes de los de siempre → por `plan_vencimiento`, como antes.
   *   B. EOS armados → por el vencimiento de SUS MÓDULOS, que es lo que de
   *      verdad se les acaba.
   *
   * Va en varias consultas y no en un `or` porque PostgREST no sabe filtrar
   * por la existencia de una fila en otra tabla sin una vista de por medio.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el cliente admin ya viene sin tipar acá arriba
  const comunes = (consulta: any) =>
    consulta
      .select("id,plan,plan_vencimiento,estado_suscripcion,cancelar_al_vencimiento")
      .eq("estado_suscripcion", "active")
      .eq("cancelar_al_vencimiento", false)
      .limit(MAX_POR_EJECUCION);

  const { data: porPlan, error: errorPlan } = await comunes(admin.from("usuarios"))
    .neq("plan", "free")
    .gte("plan_vencimiento", desde.toISOString())
    .lte("plan_vencimiento", hasta.toISOString());

  // Los módulos que se están por vencer, de gente que tiene un armado vigente.
  const [{ data: porVencer }, { data: armadosVigentes }] = await Promise.all([
    admin
      .from("eos_usuario_modulos")
      .select("usuario_id")
      .eq("estado", "activo")
      .not("vencimiento", "is", null)
      .gte("vencimiento", desde.toISOString())
      .lte("vencimiento", hasta.toISOString())
      .limit(MAX_POR_EJECUCION * 20),
    admin
      .from("eos_planes_armados")
      .select("usuario_id")
      .eq("estado", "vigente")
      .limit(MAX_POR_EJECUCION * 20),
  ]);

  const conArmado = new Set(
    ((armadosVigentes ?? []) as { usuario_id: string }[]).map((a) => a.usuario_id),
  );

  const idsPorModulo = [
    ...new Set(
      ((porVencer ?? []) as { usuario_id: string }[])
        .map((m) => m.usuario_id)
        .filter((id) => conArmado.has(id)),
    ),
  ];

  let porArmado: unknown[] = [];
  let errorArmado = null;

  if (idsPorModulo.length > 0) {
    const respuesta = await comunes(admin.from("usuarios")).in("id", idsPorModulo);
    porArmado = respuesta.data ?? [];
    errorArmado = respuesta.error;
  }

  const candidatosError = errorPlan || errorArmado;

  // Alguien puede caer en las dos listas —tiene plan con vencimiento Y un
  // armado— y cobrarle dos veces sería el peor error posible de este cron.
  type Candidato = {
    id: string;
    plan: string | null;
    plan_vencimiento: string | null;
  };

  const porId = new Map<string, Candidato>();
  for (const u of [...((porPlan ?? []) as Candidato[]), ...(porArmado as Candidato[])]) {
    porId.set(String(u.id), u);
  }

  const candidatos = [...porId.values()].slice(0, MAX_POR_EJECUCION);

  if (candidatosError) {
    console.error("Renovaciones: no se pudo listar candidatos:", candidatosError);

    return NextResponse.json(
      { error: "No se pudieron listar las renovaciones." },
      { status: 500 },
    );
  }

  const resumen = {
    evaluados: (candidatos || []).length,
    cobrados: 0,
    rechazados: 0,
    omitidos: 0,
    errores: 0,
    /* Cuántas renovaciones caídas terminaron en un aviso entregado. */
    avisados: 0,
    sin_aviso: 0,
  };

  const enviarCorreo = armarEnviarCorreo();
  const hoy = hoyEnParaguay(ahora);

  for (const usuario of candidatos || []) {
    try {
      const { data: tarjeta } = await admin
        .from("eos_bancard_tarjetas_v51")
        .select("id")
        .eq("usuario_id", usuario.id)
        .eq("estado", "activa")
        .eq("es_principal", true)
        .maybeSingle();

      if (!tarjeta?.id) {
        resumen.omitidos += 1;
        continue;
      }

      // Ya se le cobró hace poco: no reintentar en la misma ventana.
      const { data: reciente } = await admin
        .from("solicitudes_pago")
        .select("id")
        .eq("usuario_id", usuario.id)
        .eq("proveedor", "bancard")
        .eq("estado", "pagado")
        .gte("pagado_at", new Date(ahora.getTime() - 86_400_000).toISOString())
        .limit(1);

      if (reciente && reciente.length > 0) {
        resumen.omitidos += 1;
        continue;
      }

      // La periodicidad se hereda del último pago acreditado.
      const { data: ultimo } = await admin
        .from("solicitudes_pago")
        .select("periodicidad")
        .eq("usuario_id", usuario.id)
        .eq("estado", "pagado")
        .order("pagado_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const periodicidad = ultimo?.periodicidad === "anual" ? "anual" : "mensual";

      /*
       * Qué se le renueva: el EOS que armó, o el plan de siempre.
       *
       * Un usuario que armó su EOS función por función paga la suma de esas
       * funciones. Sin esta consulta, la renovación cobraría el precio del plan
       * —o sea, solo el tramo de conversaciones— y le seguiría entregando todo
       * lo que eligió. Cobrar de menos y entregar de más, todos los meses.
       *
       * El monto sale del armado y está CONGELADO ahí desde que lo contrató: si
       * mañana sube el precio de un módulo, a este usuario se le sigue cobrando
       * lo que aceptó hasta que él lo cambie.
       */
      const { data: armado } = await admin.rpc("eos_armado_vigente", {
        p_usuario_id: usuario.id,
      });

      const armadoId = (armado as { armado_id?: string } | null)?.armado_id ?? null;

      const resultado = await ejecutarCobroBancard({
        admin,
        usuarioId: usuario.id,
        plan: String(usuario.plan || "").toLowerCase(),
        // Un armado trae su propia periodicidad congelada; la del último pago
        // solo manda cuando se renueva un plan de los viejos.
        periodicidad:
          (armado as { periodicidad?: string } | null)?.periodicidad === "anual"
            ? "anual"
            : armadoId
              ? "mensual"
              : periodicidad,
        tarjetaId: tarjeta.id,
        baseUrlApp: baseUrlApp(),
        armadoId,
      });

      /*
       * Una renovación se cae sola de dos formas: el emisor pide una
       * verificación que nadie puede responder, o la tarjeta rechaza el
       * cobro. Las dos terminan igual —sin plan y sin enterarse— así que
       * las dos avisan, con distinto texto.
       */
      let pendiente: { motivo: MotivoRenovacion; solicitudId: string } | null = null;

      if (resultado.tipo === "pagado") {
        resumen.cobrados += 1;
      } else if (resultado.tipo === "rechazado") {
        resumen.rechazados += 1;

        if (resultado.solicitudId) {
          pendiente = { motivo: "rechazo", solicitudId: resultado.solicitudId };
        }
      } else if (resultado.tipo === "3ds") {
        /*
         * 3DS necesita al usuario presente, así que no se puede
         * completar en un cobro desatendido. Queda como rechazo para
         * que se le pida pagar manualmente.
         */
        await admin.rpc("eos_bancard_confirmar_cobro_v51", {
          p_shop_process_id: String(resultado.shopProcessId),
          p_aprobado: false,
          p_detalle: { motivo: "3ds_requerido_en_renovacion_automatica" },
        });

        resumen.rechazados += 1;

        pendiente = { motivo: "verificacion", solicitudId: resultado.solicitudId };
      } else {
        resumen.errores += 1;
      }

      /*
       * Sin esto la suscripción se cae en silencio: el usuario no hizo nada
       * mal, el cobro no se pudo completar, y se enteraría el día que pierde
       * el acceso.
       */
      if (pendiente) {
        const aviso = await avisarRenovacionPendiente(admin, {
          motivo: pendiente.motivo,
          usuarioId: usuario.id,
          solicitudId: pendiente.solicitudId,
          plan: String(usuario.plan || "").toLowerCase(),
          periodicidad,
          vence: usuario.plan_vencimiento
            ? hoyEnParaguay(new Date(usuario.plan_vencimiento))
            : null,
          hoy,
          ventanaDesde: desde.toISOString(),
          baseUrl: baseUrlApp(),
          enviarCorreo,
        });

        if (aviso.avisado) {
          resumen.avisados += 1;
        } else if (aviso.motivo !== "repetido") {
          // "repetido" es el caso sano: ya se le avisó en esta ventana.
          console.error(
            "Renovaciones: renovación caída sin aviso para",
            usuario.id,
            aviso.motivo,
          );
          resumen.sin_aviso += 1;
        }
      }
    } catch (error) {
      console.error("Renovaciones: fallo con usuario", usuario.id, error);
      resumen.errores += 1;
    }
  }

  return NextResponse.json({ ok: true, ...resumen });
}
