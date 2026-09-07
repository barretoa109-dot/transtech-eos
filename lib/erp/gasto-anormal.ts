/**
 * El gasto que no se parece a nada de lo que venís gastando.
 *
 * ============================================================
 * POR QUÉ ESTO NO EXISTÍA HASTA AHORA
 * ============================================================
 *
 * El punto 20 de la lista de lanzamiento pide avisar de "gastos anormales", y
 * `riesgos-negocio.ts` lo dejó explícitamente afuera con este motivo:
 *
 *   "Detectarlo bien exige saber qué es normal para ESTE usuario, y con pocos
 *    meses de historial cualquier regla razonable —el doble de la mediana,
 *    tres desvíos— marca como anormal la compra anual del seguro."
 *
 * El motivo era bueno y el problema es real: el seguro anual es, por
 * definición, el gasto más grande de su categoría y no se parece a ningún
 * otro. Cualquier detector estadístico lo levanta.
 *
 * Lo que faltaba no era una fórmula mejor. Era darse cuenta de que "raro" y
 * "problema" no son lo mismo, y que lo que distingue a uno del otro no está en
 * el monto: está en si YA PASÓ ANTES y en si el usuario YA LO SABÍA.
 *
 * ============================================================
 * LAS CINCO CONDICIONES, Y CUÁL DESACTIVA EL SEGURO
 * ============================================================
 *
 * Un gasto se avisa solo si pasa las cinco. Cada una descarta un tipo distinto
 * de falsa alarma:
 *
 * 1. HAY CON QUÉ COMPARAR. Su categoría necesita al menos tres meses distintos
 *    con movimientos y seis gastos. Con menos que eso no hay un "normal" del
 *    que separarse, y decir que algo es raro sin saber qué es lo común es
 *    inventar. Descarta al usuario nuevo, que si no recibiría un aviso por
 *    cada gasto de su primera semana.
 *
 * 2. ES GRANDE DE VERDAD, contra su propia categoría. Cuatro veces la mediana
 *    de esa categoría, no del total: un alquiler de tres millones no es raro,
 *    tres millones en insumos que promedian doscientos mil sí. La mediana y no
 *    el promedio, porque el promedio ya lo arrastra el gasto que estamos
 *    tratando de detectar.
 *
 * 3. NO ESTABA DECLARADO. Si el usuario ya lo cargó como gasto fijo, o el
 *    movimiento viene marcado como recurrente, no es una sorpresa: es algo que
 *    él mismo anotó que iba a pasar.
 *
 * 4. NO TIENE PRECEDENTE. Ningún gasto anterior de esa categoría llegó ni a la
 *    mitad. **Esta es la que apaga el seguro anual a partir del segundo año**:
 *    el pago del año pasado es el precedente, y con precedente esto ya no es
 *    una noticia sino un patrón.
 *
 * 5. MUEVE LA AGUJA DEL MES. Al menos el 15% de todo lo gastado ese mes. Un
 *    número enorme dentro de una categoría diminuta no le cambia nada a nadie,
 *    y avisarlo es gastar la atención del usuario en algo que no va a hacer.
 *
 * ============================================================
 * LO QUE ESTE DETECTOR NO PUEDE, DICHO SIN ADORNOS
 * ============================================================
 *
 * El PRIMER pago de un gasto verdaderamente anual —el seguro del primer año—
 * se va a avisar. No hay forma de distinguirlo de un gasto anormal sin haberlo
 * visto nunca antes: los dos son grandes, los dos no tienen precedente y los
 * dos son la primera vez. Cualquier detector que diga lo contrario está
 * adivinando.
 *
 * Lo que sí se puede es que cueste UN aviso y nunca más:
 *
 *   · La clave del riesgo es el id del movimiento, así que el mismo gasto no se
 *     avisa dos veces aunque el usuario no haga nada.
 *   · El año siguiente, la condición 4 lo apaga sola.
 *   · Si el usuario lo carga como gasto fijo, la 3 lo apaga desde el próximo.
 *
 * Y el aviso está escrito para eso: dice contra qué se comparó —cuántos gastos,
 * en cuántos meses, cuál era el mayor hasta ahora— para que quien lo lea pueda
 * decidir en dos segundos si es un error de carga, una compra que ya sabía, o
 * algo que hay que mirar. Un aviso que solo dice "gasto anormal detectado"
 * obliga a ir a buscar todo eso a mano.
 */

import { monedaConocida } from "../finanzas/monedas.ts";

export type GastoHistorico = {
  id: string;
  fecha: string;
  monto: number;
  moneda: string | null;
  categoria: string | null;
  descripcion: string | null;
  /** Lo que el usuario marcó como que se repite. */
  recurrente?: boolean | null;
};

/** Un gasto fijo declarado por el usuario, para no avisar lo que ya sabe. */
export type FijoDeclarado = {
  categoria: string | null;
  descripcion: string | null;
};

export type GastoAnormal = {
  tipo: "gasto_anormal";
  /** El id del movimiento: el mismo gasto no se avisa dos veces. */
  clave: string;
  moneda: string;
  categoria: string;
  descripcion: string;
  monto: number;
  /** Con qué se comparó, para que el aviso pueda mostrarlo. */
  habitual: number;
  mayor_anterior: number;
  gastos_comparados: number;
  meses_comparados: number;
  /** Qué porcentaje del mes se llevó, redondeado. */
  parte_del_mes: number;
};

export const REGLAS = {
  /** Meses distintos con gastos en la categoría antes de opinar. */
  mesesMinimos: 3,
  /** Gastos en la categoría antes de opinar. */
  gastosMinimos: 6,
  /** Cuántas veces la mediana de su categoría tiene que ser. */
  factor: 4,
  /**
   * Con qué precedente deja de ser noticia. La MITAD y no el monto exacto:
   * el seguro de este año casi nunca cuesta lo mismo que el del año pasado, y
   * exigir igualdad haría que el precedente no sirva de nada.
   */
  precedente: 0.5,
  /** Parte del gasto del mes, de 0 a 1. */
  parteDelMes: 0.15,
} as const;

const SIN_CATEGORIA = "sin categoría";

function normalizar(texto: string | null | undefined): string {
  return (texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;

  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);

  return orden.length % 2 === 1 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
}

/** "2026-09-14" → "2026-09". El mes calendario, sin husos ni sorpresas. */
function mesDe(fecha: string): string {
  return fecha.slice(0, 7);
}

/**
 * Los gastos que no se parecen a nada de su categoría.
 *
 * `gastos` es el historial COMPLETO que se quiera considerar; la función usa
 * cada gasto como candidato y todos los anteriores como referencia. Devuelve
 * la lista vacía la enorme mayoría de las veces, que es el resultado bueno.
 */
export function detectarGastosAnormales(datos: {
  gastos: GastoHistorico[];
  fijos?: FijoDeclarado[];
  /** Solo se avisan los gastos de estos últimos días. El resto es referencia. */
  ventanaDias?: number;
  hoy: string;
}): GastoAnormal[] {
  const ventana = datos.ventanaDias ?? 30;
  const desde = new Date(Date.parse(`${datos.hoy}T00:00:00Z`) - ventana * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // Lo que el usuario ya declaró que se repite, por categoría y por texto.
  const declarados = new Set<string>();
  for (const fijo of datos.fijos ?? []) {
    if (normalizar(fijo.categoria)) declarados.add(`c:${normalizar(fijo.categoria)}`);
    if (normalizar(fijo.descripcion)) declarados.add(`d:${normalizar(fijo.descripcion)}`);
  }

  const ordenados = [...datos.gastos]
    .filter((g) => Number(g.monto) > 0)
    .sort((a, b) => (a.fecha === b.fecha ? a.id.localeCompare(b.id) : a.fecha.localeCompare(b.fecha)));

  // Lo gastado por mes y moneda, para la condición 5.
  const totalPorMes = new Map<string, number>();
  for (const g of ordenados) {
    const k = `${monedaConocida(g.moneda)}|${mesDe(g.fecha)}`;
    totalPorMes.set(k, (totalPorMes.get(k) ?? 0) + Number(g.monto));
  }

  const hallazgos: GastoAnormal[] = [];

  for (let i = 0; i < ordenados.length; i += 1) {
    const gasto = ordenados[i];
    if (gasto.fecha < desde) continue;

    const moneda = monedaConocida(gasto.moneda);
    const categoria = normalizar(gasto.categoria) || SIN_CATEGORIA;
    const monto = Number(gasto.monto);

    // 3 — Ya declarado. Se mira antes que nada porque es la más barata y la
    // que más falsas alarmas evita: el alquiler, el seguro cargado, el sueldo.
    if (gasto.recurrente === true) continue;
    if (declarados.has(`c:${categoria}`)) continue;
    if (declarados.has(`d:${normalizar(gasto.descripcion)}`)) continue;

    /*
     * La referencia son los gastos ANTERIORES de la misma categoría y moneda.
     * Anteriores y no todos: usar los posteriores le daría al detector
     * información que no existía el día del gasto, y el mismo historial
     * respondería distinto según cuándo se lo mire.
     */
    const previos = ordenados
      .slice(0, i)
      .filter((g) => monedaConocida(g.moneda) === moneda && (normalizar(g.categoria) || SIN_CATEGORIA) === categoria);

    // 1 — Hay con qué comparar.
    if (previos.length < REGLAS.gastosMinimos) continue;

    const meses = new Set(previos.map((g) => mesDe(g.fecha)));
    if (meses.size < REGLAS.mesesMinimos) continue;

    const montosPrevios = previos.map((g) => Number(g.monto));
    const habitual = mediana(montosPrevios);
    const mayorAnterior = Math.max(...montosPrevios);

    // 2 — Grande contra su propia categoría.
    if (habitual <= 0 || monto < habitual * REGLAS.factor) continue;

    // 4 — Sin precedente. La que apaga el seguro anual del segundo año.
    if (mayorAnterior >= monto * REGLAS.precedente) continue;

    // 5 — Mueve la aguja del mes.
    const totalMes = totalPorMes.get(`${moneda}|${mesDe(gasto.fecha)}`) ?? 0;
    if (totalMes <= 0 || monto / totalMes < REGLAS.parteDelMes) continue;

    hallazgos.push({
      tipo: "gasto_anormal",
      clave: gasto.id,
      moneda,
      categoria: gasto.categoria?.trim() || SIN_CATEGORIA,
      descripcion: gasto.descripcion?.trim() || "",
      monto,
      habitual,
      mayor_anterior: mayorAnterior,
      gastos_comparados: previos.length,
      meses_comparados: meses.size,
      parte_del_mes: Math.round((monto / totalMes) * 100),
    });
  }

  return hallazgos;
}

/**
 * El texto del aviso.
 *
 * Dice contra qué se comparó, no solo que algo es raro. Es lo que le permite a
 * quien lo lee resolverlo en dos segundos —un cero de más al cargar, una
 * compra que ya sabía, o algo que hay que mirar— sin ir a buscar el historial.
 */
export function redactarGastoAnormal(
  hallazgo: GastoAnormal,
  formatear: (monto: number, moneda: string) => string,
): string {
  const que = hallazgo.descripcion
    ? `${formatear(hallazgo.monto, hallazgo.moneda)} en ${hallazgo.descripcion}`
    : formatear(hallazgo.monto, hallazgo.moneda);

  return (
    `Gastaste ${que}, dentro de ${hallazgo.categoria}. ` +
    `Ahí lo habitual es ${formatear(hallazgo.habitual, hallazgo.moneda)} ` +
    `—${hallazgo.gastos_comparados} gastos en ${hallazgo.meses_comparados} meses— ` +
    `y el mayor hasta ahora había sido ${formatear(hallazgo.mayor_anterior, hallazgo.moneda)}. ` +
    `Se llevó el ${hallazgo.parte_del_mes}% de lo que gastaste este mes. ` +
    `Si era esperado, cargalo como gasto fijo y no te lo vuelvo a mencionar.`
  );
}
