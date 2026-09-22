import { evaluarObjetivo, type EstadoObjetivo, type ObjetivoFinanciero } from "../finanzas/objetivos.ts";
import { formatearMonto } from "../finanzas/formato.ts";
import { codigoMoneda } from "../finanzas/monedas.ts";
import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";

/**
 * La línea personal del correo motivacional: cómo va su objetivo, o un consejo
 * financiero si todavía no tiene uno con plata de por medio.
 *
 * ============================================================
 * POR QUÉ HOY CASI SIEMPRE ES EL CONSEJO GENÉRICO
 * ============================================================
 *
 * Medido el 21 de septiembre de 2026: **0 de 6 cuentas reales tienen un
 * objetivo monetario activo**, y solo 1 tiene su Constitución Financiera
 * configurada. "Decirles cómo van de su objetivo" no tiene de qué hablar
 * todavía para casi nadie. Este módulo no lo inventa: si no hay un objetivo
 * con plata, cae al consejo financiero general, y el día que la persona cree
 * uno, el correo empieza a hablar de él solo, sin tocar código de nuevo.
 *
 * ============================================================
 * MISMA CUENTA QUE LA PANTALLA DE OBJETIVOS, A PROPÓSITO
 * ============================================================
 *
 * Reutiliza `evaluarObjetivo` (`lib/finanzas/objetivos.ts`), la misma función
 * que arma `/api/finanzas/objetivos`. Si un correo y la pantalla calcularan el
 * progreso cada uno por su lado, el día que se desincronizaran ninguno de los
 * dos sería obviamente el que miente — ya le pasó a este proyecto con el
 * panorama financiero (ver el comentario de `leerTarjetas.ts`).
 *
 * No se resuelve `cuenta_nombre` contra el saldo de una cuenta (sí lo hace la
 * pantalla): acá alcanza con lo que la persona declaró para el objetivo. Un
 * correo automático no es el lugar para una consulta más por usuario y por
 * día; quien quiera el número exacto lo tiene en la pantalla.
 */

type FilaObjetivo = {
  id: string;
  titulo: string;
  clase: string | null;
  moneda: string | null;
  prioridad: number | null;
  valor_objetivo: number | null;
  valor_inicial: number | null;
  valor_actual: number | null;
  fecha_inicio: string;
  fecha_limite: string | null;
  ultima_actualizacion_at: string | null;
};

function num(valor: unknown): number {
  const n = typeof valor === "string" ? Number(valor) : Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** El objetivo monetario activo de mayor prioridad, ya evaluado. `null` si no tiene ninguno. */
export async function objetivoPrincipal(
  admin: ClienteSinTipos,
  usuarioId: string,
  hoy: string,
): Promise<EstadoObjetivo | null> {
  const { data, error } = await admin
    .from("eos_goals")
    .select(
      "id,titulo,clase,moneda,prioridad,valor_objetivo,valor_inicial,valor_actual,fecha_inicio,fecha_limite,ultima_actualizacion_at",
    )
    .eq("usuario_id", usuarioId)
    .eq("ambito", "personal")
    .eq("estado", "activo")
    .eq("tipo_medicion", "monetario")
    .order("prioridad", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  // Sin dato no se inventa nada: se cae al consejo genérico, no a un error.
  if (error || !data) return null;

  const f = data as FilaObjetivo;
  if (num(f.valor_objetivo) <= 0) return null;

  const moneda = codigoMoneda(f.moneda, "PYG");

  const objetivo: ObjetivoFinanciero = {
    id: f.id,
    titulo: f.titulo,
    clase: f.clase === "fondo_emergencia" ? "fondo_emergencia" : "general",
    moneda,
    prioridad: f.prioridad ?? 3,
    objetivo: num(f.valor_objetivo),
    inicial: num(f.valor_inicial),
    actual: num(f.valor_actual),
    origen: "declarado",
    actual_al: (f.ultima_actualizacion_at ?? "").slice(0, 10) || null,
    desde: f.fecha_inicio,
    hasta: f.fecha_limite,
  };

  return evaluarObjetivo(objetivo, hoy);
}

/** Una o dos frases sobre cómo va el objetivo, con números reales. */
export function lineaDeObjetivo(e: EstadoObjetivo): string {
  const monto = (v: number) => formatearMonto(v, e.moneda);

  switch (e.estado) {
    case "cumplido":
      return `Ya llegaste a tu objetivo "${e.titulo}": juntaste ${monto(e.actual)}. Buen momento para ponerte una meta nueva.`;

    case "atrasado":
      return e.aporte_necesario !== null && e.aporte_real !== null
        ? `Vas al ${e.progreso}% de "${e.titulo}", pero al ritmo de estos días no llegás: para cumplir necesitás apartar ${monto(e.aporte_necesario)} por mes y venís apartando ${monto(e.aporte_real)}. Todavía hay tiempo para ajustarlo.`
        : `Vas al ${e.progreso}% de "${e.titulo}", y el ritmo se atrasó respecto de cuando lo armaste. Vale la pena revisarlo.`;

    case "en_ritmo":
      return e.aporte_necesario !== null
        ? `Vas al ${e.progreso}% de "${e.titulo}", en ritmo. Para llegar a tiempo alcanza con seguir apartando ${monto(e.aporte_necesario)} por mes.`
        : `Vas al ${e.progreso}% de "${e.titulo}", en ritmo. Seguí así.`;

    case "vencido":
      return `"${e.titulo}" llegó a su fecha con ${e.progreso}% cumplido (${monto(e.actual)} de ${monto(e.objetivo)}). No se perdió nada de lo ahorrado: puede que solo haga falta una fecha nueva.`;

    case "sin_fecha":
      return `Llevás ${monto(e.actual)} de los ${monto(e.objetivo)} de "${e.titulo}" (${e.progreso}%). Ponerle una fecha lo convierte en un plan y no solo en una idea.`;

    default:
      return `Vas al ${e.progreso}% de "${e.titulo}".`;
  }
}

/**
 * Consejos financieros concretos, para quien todavía no tiene un objetivo con
 * plata cargado en EOS. Rotan por el mismo ciclo que el mensaje motivacional,
 * así que cada envío trae uno distinto.
 */
export const CONSEJOS_FINANCIEROS: string[] = [
  "Un consejo con números: si separás el 10% de cada venta o cada sueldo apenas entra, antes de gastar nada, en un año tenés un mes entero de respaldo sin haberlo sentido.",
  "Antes de una compra grande, esperá 48 horas. Lo que sigue pareciendo necesario dos días después probablemente lo sea; lo que dejó de importarte, te ahorró esa plata.",
  "Una deuda con más interés que las otras es la que hay que pagar primero, no la más chica ni la más vieja. Es la que más te cuesta cada mes que sigue viva.",
  "Guardar un fondo de emergencia de un mes de gastos, aunque sea de a poco, es lo que separa un imprevisto de una crisis.",
  "Si no sabés en qué se te va la plata, esa es la primera pregunta que conviene contestar, antes que cualquier plan de ahorro.",
  "Renegociar una tasa suele valer más que buscar un ingreso extra: bajar lo que pagás de más todos los meses es plata que no tenés que volver a ganar.",
];

export function lineaDeConsejoFinanciero(ciclo: number): string {
  const indice = ((ciclo % CONSEJOS_FINANCIEROS.length) + CONSEJOS_FINANCIEROS.length) % CONSEJOS_FINANCIEROS.length;
  return CONSEJOS_FINANCIEROS[indice];
}

/** La línea personal del correo: el objetivo si tiene uno, si no el consejo del ciclo. */
export async function lineaPersonal(
  admin: ClienteSinTipos,
  usuarioId: string,
  hoy: string,
  ciclo: number,
): Promise<string> {
  const estado = await objetivoPrincipal(admin, usuarioId, hoy);
  return estado ? lineaDeObjetivo(estado) : lineaDeConsejoFinanciero(ciclo);
}
