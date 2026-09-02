import { filaDesdeResultado, type FilaHistoria } from "./historia.ts";
import { leerHechos } from "./leer.ts";
import { calcular } from "./motor.ts";
import { periodoAnterior } from "./periodo.ts";
import { CATALOGO, CON_UMBRALES } from "./registro.ts";
import { detectarAnomalias } from "./anomalias.ts";
import { armarTwin, convieneEscribir, scorePrincipal } from "./twin.ts";
import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";

/**
 * La foto diaria de los indicadores de cada negocio.
 *
 * ============================================================
 * POR QUÉ CUELGA DEL CRON QUE YA EXISTE
 * ============================================================
 *
 * El plan de Vercel permite DOS cron jobs y los dos están usados (renovaciones
 * de Bancard y briefing diario). Así que esto no estrena un cron: se engancha
 * al del briefing, igual que ya lo hacen `avisarRiesgos`, `avisarRiesgosNegocio`
 * y el barrido de límites.
 *
 * La consecuencia es que la foto se saca a la hora del briefing y no a
 * medianoche. Para una serie diaria da igual mientras sea siempre la misma
 * hora — lo que arruinaría la comparación es que un día se capture a las 8 y
 * otro a las 20.
 *
 * ============================================================
 * A QUIÉN SE LE SACA LA FOTO
 * ============================================================
 *
 * A quien tenga ERP o CRM activo. Es una decisión de alcance, no un descuido:
 * los indicadores de este catálogo son de negocio, y quien solo lleva sus
 * finanzas personales ya tiene su propia historia en el panel financiero.
 *
 * ============================================================
 * UN USUARIO QUE FALLA NO FRENA A LOS DEMÁS
 * ============================================================
 *
 * Es la misma regla del briefing. Se procesa de a uno, cada uno en su try, y
 * al final se devuelve el conteo. Un error se registra y se sigue: perder la
 * foto de hoy de una persona es un hueco en su serie; abortar el recorrido es
 * un hueco en la de todos.
 */

/** El techo por corrida, igual que el del briefing. */
const MAX_POR_EJECUCION = 200;

export type ResumenCaptura = {
  usuarios: number;
  filas: number;
  fallidos: number;
  /** Gemelos escritos. Menos que `usuarios` es lo normal: los sin cambios se saltean. */
  gemelos: number;
};

export async function capturarIndicadores(
  admin: ClienteSinTipos,
  opciones: { hoy: string },
): Promise<ResumenCaptura> {
  const resumen: ResumenCaptura = { usuarios: 0, filas: 0, fallidos: 0, gemelos: 0 };

  const { data: activos, error } = await admin
    .from("eos_usuario_modulos")
    .select("usuario_id,modulo_codigo")
    .in("modulo_codigo", ["erp", "crm"])
    .eq("estado", "activo");

  if (error) {
    console.error("KPI: no se pudo listar a quién capturar:", error);
    return resumen;
  }

  // Un usuario puede tener los dos módulos: se agrupa para no leerlo dos veces.
  const porUsuario = new Map<string, { erp: boolean; crm: boolean }>();
  for (const fila of (activos ?? []) as { usuario_id: string; modulo_codigo: string }[]) {
    const previo = porUsuario.get(fila.usuario_id) ?? { erp: false, crm: false };
    if (fila.modulo_codigo === "erp") previo.erp = true;
    if (fila.modulo_codigo === "crm") previo.crm = true;
    porUsuario.set(fila.usuario_id, previo);
  }

  /*
   * El período es el mes corrido, el MISMO que usa `GET /api/kpi`.
   *
   * Es deliberado que la foto guarde el acumulado del mes y no el día suelto:
   * lo que la pantalla muestra es el mes, y la historia tiene que ser
   * comparable con lo que la persona vio. Una serie de "ventas del mes hasta
   * hoy" sube durante el mes y arranca de nuevo el día 1, y eso se lee bien;
   * una serie de días sueltos sería otro indicador con el mismo nombre.
   */
  const periodo = { desde: `${opciones.hoy.slice(0, 7)}-01`, hasta: opciones.hoy };
  const rango = { desde: periodoAnterior(periodo).desde, hasta: periodo.hasta };

  for (const [usuarioId, modulos] of [...porUsuario].slice(0, MAX_POR_EJECUCION)) {
    try {
      const hechos = await leerHechos(admin, usuarioId, rango, modulos);
      const resultados = calcular(CATALOGO, hechos, periodo);

      if (resultados.length === 0) continue;

      const filas: FilaHistoria[] = resultados.map((r) =>
        filaDesdeResultado(usuarioId, opciones.hoy, r),
      );

      // `upsert` y no `insert`: correr dos veces el mismo día tiene que dejar
      // el mismo resultado, y si entre las dos corridas la persona cargó los
      // costos que faltaban, la segunda CORRIGE a la primera en vez de fallar.
      const { error: errorGuardar } = await admin
        .from("eos_kpi_historia_v105")
        .upsert(filas, { onConflict: "usuario_id,indicador,moneda,fecha" });

      if (errorGuardar) {
        console.error(`KPI: no se pudo guardar la historia de ${usuarioId}:`, errorGuardar);
        resumen.fallidos++;
        continue;
      }

      resumen.usuarios++;
      resumen.filas += filas.length;

      /*
       * Y el gemelo del negocio, en la misma pasada.
       *
       * Va acá y no en su propio recorrido porque necesita exactamente los
       * mismos `resultados` que se acaban de guardar: si se recalculara
       * aparte, el gemelo podría contar una foto distinta de la que quedó en
       * la historia, y nadie sabría cuál de las dos mirar.
       *
       * Un fallo del gemelo NO cuenta como fallo de la captura: la historia
       * ya quedó guardada, que es lo que no se puede reconstruir después.
       */
      try {
        const score = scorePrincipal(resultados, CON_UMBRALES);
        if (score) {
          const anomalias = detectarAnomalias(resultados.map((r) => ({ resultado: r })));
          const fila = armarTwin({
            usuarioId,
            resultados,
            anomalias,
            score,
            generadoEn: new Date().toISOString(),
          });

          const { data: previo } = await admin
            .from("eos_business_twins_v14")
            .select("source_fingerprint")
            .eq("usuario_id", usuarioId)
            .maybeSingle();

          if (convieneEscribir(fila, previo?.source_fingerprint ?? null)) {
            const { error: errorTwin } = await admin
              .from("eos_business_twins_v14")
              .upsert(fila, { onConflict: "usuario_id" });

            if (errorTwin) console.error(`KPI: no se pudo guardar el gemelo de ${usuarioId}:`, errorTwin);
            else resumen.gemelos++;
          }
        }
      } catch (e) {
        console.error(`KPI: falló el gemelo de ${usuarioId}:`, e);
      }
    } catch (e) {
      console.error(`KPI: falló la captura de ${usuarioId}:`, e);
      resumen.fallidos++;
    }
  }

  return resumen;
}
