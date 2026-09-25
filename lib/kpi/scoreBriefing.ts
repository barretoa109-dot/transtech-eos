import { capturarIndicadores, motivo } from "./capturar.ts";
import { capturarPulsoPersonal } from "../finanzas/capturarPulso.ts";
import { DIMENSIONES_PERSONALES, CON_UMBRALES_PERSONALES } from "../finanzas/pulso.ts";
import { DIMENSIONES } from "./score.ts";
import { CON_UMBRALES } from "./registro.ts";
import { scoresEOSPorDia, scoresPorDia, type FilaHistoriaScore, type PuntoScoreDiario } from "./scoreDiario.ts";
import { sumarDias } from "../fecha.ts";
import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";

/**
 * El EOS Score del briefing, calculado de verdad.
 *
 * ============================================================
 * EL CERO DE RELLENO
 * ============================================================
 *
 * El briefing se genera en la base (`briefing_respaldo_automatico_v5` y el
 * enriquecimiento de n8n) y su score es
 * `coalesce(profile.score_general, latest_intelligence.score, 0)`. Ninguna de
 * las dos fuentes se escribe para la mayoría de las cuentas, así que el score
 * quedaba en 0 todos los días: la tarjeta, el gráfico y el correo decían
 * "Crítico" de alguien a quien nadie había medido.
 *
 * El score que SÍ se calcula sale de los indicadores del negocio y de Personal
 * (`lib/kpi/scoreDiario.ts`). Esto lo escribe en `eos_daily_briefings.score`
 * desde dos lugares:
 *
 *   · el cron diario, después de sacar la foto de los indicadores;
 *   · `GET /api/briefing`, que además rellena los briefings viejos cuyo día
 *     tiene foto. Así una cuenta se arregla la primera vez que la persona abre
 *     EOS, sin esperar al cron ni a una migración.
 *
 * Un día sin foto de indicadores NO se toca: no hay con qué puntuarlo, y
 * escribirle un número sería inventarlo.
 */

/** Filas por página: el techo que PostgREST aplica por defecto a cada respuesta. */
const PAGINA = 1000;
/** Techo de páginas: ~30 indicadores por día durante un año entran holgados. */
const MAX_PAGINAS = 15;
/** Techo de briefings corregidos por llamada, para que una cuenta vieja no demore la respuesta. */
const MAX_CORRECCIONES = 400;

export type SeriesDeScore = { negocio: PuntoScoreDiario[]; personal: PuntoScoreDiario[] };

/**
 * Por qué una cuenta tiene (o no tiene) score, en datos.
 *
 * Existe porque "sigue en 0" no dice nada: puede faltar el módulo, la
 * Constitución Financiera, datos que puntuar, o puede haber fallado algo. La
 * pantalla lo traduce a una frase y así la persona —y quien la ayuda— ve la
 * causa real en vez de adivinarla.
 */
export type DiagnosticoScore = {
  foto_hoy: "ya_estaba" | "sacada" | "no_se_pudo";
  filas_historia: number;
  negocio: { habilitado: boolean; dias: number; errores: string[] };
  personal: { habilitado: boolean; dias: number; errores: string[] };
  errores: string[];
};

const IDS = [...DIMENSIONES, ...DIMENSIONES_PERSONALES].flatMap((d) => d.indicadores);

/**
 * El score del negocio y el personal de cada día desde `desde`.
 *
 * Se lee con el cliente admin, así que el `.eq("usuario_id")` es el candado:
 * service_role no pasa por RLS.
 */
export async function leerSeriesDeScore(
  admin: ClienteSinTipos,
  usuarioId: string,
  desde: string,
): Promise<SeriesDeScore & { filas: number }> {
  const filas: FilaHistoriaScore[] = [];

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const { data, error } = await admin
      .from("eos_kpi_historia_v105")
      .select("indicador,moneda,fecha,estado,confianza")
      .eq("usuario_id", usuarioId)
      .in("indicador", IDS)
      .gte("fecha", desde)
      .order("fecha", { ascending: true })
      .order("indicador", { ascending: true })
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);

    if (error) throw error;

    const lote = (data ?? []) as Record<string, unknown>[];
    for (const f of lote) {
      filas.push({
        indicador: String(f.indicador),
        moneda: String(f.moneda),
        fecha: String(f.fecha),
        estado: (f.estado as FilaHistoriaScore["estado"]) ?? null,
        confianza: f.confianza === null || f.confianza === undefined ? null : Number(f.confianza),
      });
    }
    if (lote.length < PAGINA) break;
  }

  return {
    negocio: scoresPorDia(filas, DIMENSIONES, CON_UMBRALES),
    personal: scoresPorDia(filas, DIMENSIONES_PERSONALES, CON_UMBRALES_PERSONALES),
    filas: filas.length,
  };
}

/**
 * Saca la foto de hoy de UNA cuenta si todavía no existe.
 *
 * El cron la saca a la hora del briefing para todos; esto cubre a quien abre
 * EOS antes, a la cuenta nueva que el cron todavía no vio y a cualquier día en
 * que el cron falló. Es el mismo código del cron acotado a una persona, así que
 * la foto es idéntica a la que habría sacado él (y el `upsert` del cron la pisa
 * sin conflicto si corre después).
 *
 * Devuelve, además, qué tiene habilitado la cuenta y qué falló: es la materia
 * prima del diagnóstico que se muestra cuando no hay score.
 */
export async function asegurarFotoDeHoy(
  admin: ClienteSinTipos,
  usuarioId: string,
  hoy: string,
): Promise<Omit<DiagnosticoScore, "filas_historia">> {
  const diag: Omit<DiagnosticoScore, "filas_historia"> = {
    foto_hoy: "ya_estaba",
    negocio: { habilitado: false, dias: 0, errores: [] },
    personal: { habilitado: false, dias: 0, errores: [] },
    errores: [],
  };

  const [modulos, politica, deHoy] = await Promise.all([
    admin
      .from("eos_usuario_modulos")
      .select("modulo_codigo")
      .eq("usuario_id", usuarioId)
      .in("modulo_codigo", ["erp", "crm"])
      .eq("estado", "activo")
      .limit(1),
    admin.from("eos_finanzas_politica").select("usuario_id").eq("usuario_id", usuarioId).limit(1),
    admin.from("eos_kpi_historia_v105").select("indicador").eq("usuario_id", usuarioId).eq("fecha", hoy).limit(1),
  ]);

  for (const r of [modulos, politica, deHoy]) if (r.error) diag.errores.push(motivo(r.error));
  diag.negocio.habilitado = (modulos.data ?? []).length > 0;
  diag.personal.habilitado = (politica.data ?? []).length > 0;

  if ((deHoy.data ?? []).length > 0) return diag;

  const [negocio, personal] = await Promise.allSettled([
    capturarIndicadores(admin, { hoy, usuarioId }),
    capturarPulsoPersonal(admin, { hoy, usuarioId }),
  ]);

  if (negocio.status === "rejected") diag.negocio.errores.push(motivo(negocio.reason));
  else diag.negocio.errores.push(...negocio.value.errores);
  if (personal.status === "rejected") diag.personal.errores.push(motivo(personal.reason));
  else diag.personal.errores.push(...personal.value.errores);

  const fallo = diag.negocio.errores.length + diag.personal.errores.length > 0;
  diag.foto_hoy = fallo ? "no_se_pudo" : "sacada";
  return diag;
}

/**
 * Escribe el EOS Score en los briefings de la cuenta cuyo día tiene foto.
 *
 * Solo toca los que difieren. Devuelve el score de cada fecha para que quien
 * llama pueda responder con los valores ya corregidos sin volver a leer.
 */
export async function sincronizarScoreDeBriefings(
  admin: ClienteSinTipos,
  usuarioId: string,
  series: SeriesDeScore,
): Promise<Map<string, number>> {
  const eos = scoresEOSPorDia(series);
  if (eos.size === 0) return eos;

  const fechas = [...eos.keys()].sort();
  const { data, error } = await admin
    .from("eos_daily_briefings")
    .select("id,briefing_date,score")
    .eq("usuario_id", usuarioId)
    .gte("briefing_date", fechas[0])
    .lte("briefing_date", fechas[fechas.length - 1]);

  if (error) throw error;

  const aCorregir = ((data ?? []) as { id: string; briefing_date: string; score: number | null }[])
    .filter((b) => eos.has(b.briefing_date) && b.score !== eos.get(b.briefing_date))
    .slice(0, MAX_CORRECCIONES);

  for (const b of aCorregir) {
    const { error: errorEscribir } = await admin
      .from("eos_daily_briefings")
      .update({ score: eos.get(b.briefing_date) })
      .eq("id", b.id)
      .eq("usuario_id", usuarioId);
    if (errorEscribir) throw errorEscribir;
  }

  return eos;
}

/**
 * La pasada del cron: el score de hoy en el briefing de hoy de cada cuenta.
 *
 * Corre después de las dos fotos del día. Una cuenta que falla no frena a las
 * demás, igual que el resto de los recorridos de ese cron.
 */
export async function puntuarBriefingsDeHoy(
  admin: ClienteSinTipos,
  hoy: string,
): Promise<{ cuentas: number; fallidas: number }> {
  const resumen = { cuentas: 0, fallidas: 0 };

  const { data, error } = await admin
    .from("eos_daily_briefings")
    .select("usuario_id")
    .eq("briefing_date", hoy);

  if (error) {
    console.error("Score: no se pudo listar los briefings de hoy:", error);
    return resumen;
  }

  const usuarios = [...new Set(((data ?? []) as { usuario_id: string }[]).map((f) => f.usuario_id))];

  for (const usuarioId of usuarios) {
    try {
      const series = await leerSeriesDeScore(admin, usuarioId, sumarDias(hoy, -1));
      await sincronizarScoreDeBriefings(admin, usuarioId, series);
      resumen.cuentas++;
    } catch (e) {
      console.error(`Score: falló el score del briefing de ${usuarioId}:`, e);
      resumen.fallidas++;
    }
  }

  return resumen;
}
