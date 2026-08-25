import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase-admin";
import { ejecutarCobroBancard } from "@/lib/bancard-cobro";
import { hoyEnParaguay } from "@/lib/fecha";
import {
  avisarRenovacionPendiente,
  type EnviarCorreo,
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

  const { data: candidatos, error: candidatosError } = await admin
    .from("usuarios")
    .select("id,plan,plan_vencimiento,estado_suscripcion,cancelar_al_vencimiento")
    .neq("plan", "free")
    .eq("estado_suscripcion", "active")
    .eq("cancelar_al_vencimiento", false)
    .gte("plan_vencimiento", desde.toISOString())
    .lte("plan_vencimiento", hasta.toISOString())
    .limit(MAX_POR_EJECUCION);

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
    /* Cuántos de los rechazos por 3DS terminaron en un aviso entregado. */
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

      const resultado = await ejecutarCobroBancard({
        admin,
        usuarioId: usuario.id,
        plan: String(usuario.plan || "").toLowerCase(),
        periodicidad,
        tarjetaId: tarjeta.id,
        baseUrlApp: baseUrlApp(),
      });

      if (resultado.tipo === "pagado") {
        resumen.cobrados += 1;
      } else if (resultado.tipo === "rechazado") {
        resumen.rechazados += 1;
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

        /*
         * Y se le avisa. Sin esto la suscripción se cae en silencio: el
         * usuario no hizo nada mal, el cobro no se pudo completar porque
         * su banco pide una verificación que sólo puede responder él, y
         * se enteraría el día que pierde el acceso.
         */
        const aviso = await avisarRenovacionPendiente(admin, {
          usuarioId: usuario.id,
          solicitudId: resultado.solicitudId,
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
            "Renovaciones: 3DS sin aviso para",
            usuario.id,
            aviso.motivo,
          );
          resumen.sin_aviso += 1;
        }
      } else {
        resumen.errores += 1;
      }
    } catch (error) {
      console.error("Renovaciones: fallo con usuario", usuario.id, error);
      resumen.errores += 1;
    }
  }

  return NextResponse.json({ ok: true, ...resumen });
}
