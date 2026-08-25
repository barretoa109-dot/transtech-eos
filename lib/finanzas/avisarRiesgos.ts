import { armarPanorama } from "./panorama.ts";
import { detectarRiesgo, redactarAviso } from "./riesgo.ts";
import { convieneAvisar, TITULO_AVISO } from "./avisos.ts";
import { enviarAviso, pushConfigurado, type Suscripcion } from "../push/enviar.ts";
import type { Deuda } from "./deudas.ts";
import type { Fijo } from "./fijos.ts";

/**
 * Que el aviso salga solo.
 *
 * La fase 3 de la hoja de ruta pide "notificaciones de salida, nunca de
 * entrada": EOS avisa, el usuario no responde ahí para cargar datos. Este
 * módulo es esa salida.
 *
 * Se llama desde el cron diario. La detección en sí es pura y vive en
 * `riesgo.ts`; acá está el I/O y las reglas de a quién y por dónde.
 */

/** Tope por corrida: un cron que se cuelga no avisa a nadie. */
const MAX_USUARIOS = 50;
const HORIZONTE_DIAS = 45;

type EnviarCorreo = (args: { para: string; asunto: string; texto: string }) => Promise<void>;

export type ResumenAvisos = {
  evaluados: number;
  con_riesgo: number;
  avisados: number;
  omitidos_por_repetido: number;
  sin_canal: number;
  /** No se pudo leer el historial: se calla para no repetir. */
  sin_historial: number;
};

function sumarDias(iso: string, dias: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

function num(valor: unknown): number {
  const n = typeof valor === "string" ? Number(valor) : Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function avisarRiesgos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- los tipos generados no incluyen estas tablas
  admin: any,
  opciones: { hoy: string; enviarCorreo?: EnviarCorreo },
): Promise<ResumenAvisos> {
  const { hoy } = opciones;
  const hasta = sumarDias(hoy, HORIZONTE_DIAS);

  const resumen: ResumenAvisos = {
    evaluados: 0,
    con_riesgo: 0,
    avisados: 0,
    omitidos_por_repetido: 0,
    sin_canal: 0,
    sin_historial: 0,
  };

  // Solo se evalúa a quien ya definió su Constitución Financiera: sin saldo de
  // partida no hay nada que simular, y EOS no inventa uno para poder alarmar.
  const { data: politicas } = await admin
    .from("eos_finanzas_politica")
    .select("usuario_id,moneda,saldo_inicial,saldo_inicial_fecha,reserva_minima")
    .limit(MAX_USUARIOS);

  const usuarios = (politicas ?? []) as {
    usuario_id: string;
    moneda: string | null;
    saldo_inicial: number | string;
    saldo_inicial_fecha: string;
    reserva_minima: number | string;
  }[];

  for (const politica of usuarios) {
    const uid = politica.usuario_id;
    resumen.evaluados += 1;

    try {
      const [movimientos, conciliaciones, fijos, deudas, previo] = await Promise.all([
        admin
          .from("eos_movimientos_financieros")
          .select("tipo,monto,fecha,descripcion")
          .eq("usuario_id", uid)
          .order("fecha", { ascending: true }),
        admin
          .from("eos_finanzas_conciliaciones")
          .select("fecha,saldo_declarado")
          .eq("usuario_id", uid),
        admin
          .from("eos_finanzas_fijos")
          .select("tipo,descripcion,monto,dia_del_mes")
          .eq("usuario_id", uid)
          .eq("activo", true),
        admin
          .from("eos_finanzas_deudas")
          .select(
            "acreedor,tipo,moneda,saldo_declarado,saldo_declarado_el,cuota_monto,cuota_dia,cuotas_totales,cuotas_pagadas,vence_el,estado,preocupa",
          )
          .eq("usuario_id", uid)
          .neq("estado", "saldada"),
        admin
          .from("eos_finanzas_avisos_riesgo")
          .select("fecha_riesgo,faltante")
          .eq("usuario_id", uid)
          .order("fecha_riesgo", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const panorama = armarPanorama({
        hoy,
        hasta,
        saldoInicial: num(politica.saldo_inicial),
        saldoInicialFecha: politica.saldo_inicial_fecha,
        reservaMinima: num(politica.reserva_minima),
        movimientos: ((movimientos.data ?? []) as Record<string, unknown>[]).map((m) => ({
          tipo: m.tipo as "ingreso" | "gasto" | "compromiso",
          monto: num(m.monto),
          fecha: m.fecha as string,
          descripcion: (m.descripcion as string | null) ?? null,
        })),
        conciliaciones: ((conciliaciones.data ?? []) as Record<string, unknown>[]).map((c) => ({
          fecha: c.fecha as string,
          saldo_declarado: num(c.saldo_declarado),
        })),
        fijos: ((fijos.data ?? []) as Record<string, unknown>[]).map<Fijo>((f) => ({
          tipo: f.tipo === "ingreso" ? "ingreso" : "gasto",
          descripcion: f.descripcion as string,
          monto: num(f.monto),
          dia_del_mes: f.dia_del_mes as number,
        })),
        deudas: ((deudas.data ?? []) as unknown as Deuda[]).map((d) => ({
          ...d,
          saldo_declarado: num(d.saldo_declarado),
          cuota_monto: d.cuota_monto === null ? null : num(d.cuota_monto),
        })),
      });

      const riesgo = detectarRiesgo({
        hoy,
        saldoActual: panorama.saldoActual,
        reservaMinima: panorama.reservaMinima,
        egresos: panorama.egresos,
        ingresos: panorama.ingresos,
      });

      // Lo normal es que no haya nada. Silencio es la respuesta correcta.
      if (!riesgo) continue;
      resumen.con_riesgo += 1;

      // Si no se puede leer el historial de avisos, NO se avisa.
      //
      // Parece contradictorio callar por un error de lectura, pero la
      // alternativa es peor: sin historial, `convieneAvisar` diría que sí
      // todos los días y el usuario recibiría el mismo susto cinco veces
      // seguidas. Si EOS no puede saber si ya avisó, no vuelve a avisar.
      if (previo.error) {
        console.error("Riesgo: no se pudo leer el historial de avisos:", previo.error);
        resumen.sin_historial += 1;
        continue;
      }

      const anterior = previo.data
        ? {
            fecha_riesgo: previo.data.fecha_riesgo as string,
            faltante: num(previo.data.faltante),
          }
        : null;

      if (!convieneAvisar(riesgo, anterior)) {
        resumen.omitidos_por_repetido += 1;
        continue;
      }

      const texto = redactarAviso(riesgo, politica.moneda ?? "PYG");
      const entregado = await entregar(admin, uid, texto, opciones.enviarCorreo);

      if (!entregado) {
        // Sin canal no se anota el aviso: si mañana el usuario activa el push,
        // tiene que enterarse del problema que sigue vigente.
        resumen.sin_canal += 1;
        continue;
      }

      await admin.from("eos_finanzas_avisos_riesgo").upsert(
        {
          usuario_id: uid,
          fecha_riesgo: riesgo.fecha,
          faltante: riesgo.faltante,
          veces: anterior && anterior.fecha_riesgo === riesgo.fecha ? 2 : 1,
          enviado_en: new Date().toISOString(),
        },
        { onConflict: "usuario_id,fecha_riesgo" },
      );

      resumen.avisados += 1;
    } catch (error) {
      // Un usuario con datos raros no puede dejar sin aviso a los demás.
      console.error("Riesgo: falló la evaluación de un usuario:", error);
    }
  }

  return resumen;
}

/**
 * Un solo canal por aviso.
 *
 * Push primero porque un aprieto de plata es urgente y el correo puede tardar
 * horas en mirarse. Mandar los dos sería recibir el mismo susto dos veces, que
 * es la clase de detalle que hace que alguien apague las notificaciones.
 */
async function entregar(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver arriba
  admin: any,
  usuarioId: string,
  texto: string,
  enviarCorreo?: EnviarCorreo,
): Promise<boolean> {
  if (pushConfigurado()) {
    const { data } = await admin
      .from("eos_push_suscripciones")
      .select("endpoint,p256dh,auth")
      .eq("usuario_id", usuarioId)
      .eq("activa", true);

    const suscripciones = (data ?? []) as Suscripcion[];

    if (suscripciones.length > 0) {
      const resultado = await enviarAviso(suscripciones, {
        titulo: TITULO_AVISO,
        cuerpo: texto,
        url: "/eos/chat",
        tag: "eos-riesgo",
      });

      if (resultado.muertas.length > 0) {
        await admin
          .from("eos_push_suscripciones")
          .update({ activa: false })
          .in("endpoint", resultado.muertas);
      }

      if (resultado.enviados > 0) return true;
    }
  }

  if (!enviarCorreo) return false;

  const { data: preferencia } = await admin
    .from("eos_followup_preferences")
    .select("usuario_id")
    .eq("usuario_id", usuarioId)
    .eq("canal_email", true)
    .eq("habilitado", true)
    .maybeSingle();

  if (!preferencia) return false;

  const { data: perfil } = await admin
    .from("usuarios")
    .select("email")
    .eq("id", usuarioId)
    .maybeSingle();

  const email = (perfil?.email as string | null) ?? null;
  if (!email) return false;

  await enviarCorreo({
    para: email,
    // El asunto no lleva la cifra: se ve en la lista de correos, y el monto es
    // asunto del usuario, no de quien mire su pantalla.
    asunto: "Algo que conviene mirar antes de que pase",
    texto,
  });

  return true;
}
