/**
 * El fondo de emergencia, construido con los números de esta persona.
 *
 * ============================================================
 * NADA DE "TRES A SEIS MESES"
 * ============================================================
 *
 * Es la recomendación más repetida de la educación financiera y viene de
 * economías con seguro de desempleo. En Paraguay, alguien que factura por su
 * cuenta y cobra distinto todos los meses no está en la misma situación que un
 * empleado con sueldo fijo, y la misma cifra no los cubre igual.
 *
 * Acá EOS no elige por la persona. Calcula lo que cuesta CADA opción con su
 * propio gasto esencial —tres meses son tanto, seis son tanto, doce son
 * tanto—, dice cuánto habría que apartar por mes para llegar en un año, y
 * espera que elija. La elección queda guardada en `meses_cobertura`.
 *
 * Puede haber una sugerencia, pero solo con su motivo al lado y solo cuando el
 * motivo sale de un dato: "tus ingresos varían bastante de un mes a otro" es
 * un hecho medible; "los expertos recomiendan seis meses" no es un hecho sobre
 * esta persona.
 *
 * ============================================================
 * QUÉ ES UN GASTO ESENCIAL
 * ============================================================
 *
 * Lo que se sigue pagando cuando se corta el ingreso: el techo, la luz, la
 * comida, la salud, el transporte, el colegio, las cuotas y los impuestos.
 * Queda afuera lo que se recorta el primer mes: la comida fuera de casa y las
 * suscripciones.
 *
 * Los gastos que EOS no supo clasificar TAMPOCO entran, pero se informan
 * aparte: asumirlos esenciales infla el fondo, e ignorarlos en silencio lo
 * desinfla. Que la persona sepa cuánto quedó sin mirar es la única salida
 * honesta.
 *
 * ============================================================
 * DOS FUENTES Y SE TOMA LA MAYOR
 * ============================================================
 *
 * El gasto esencial se puede mirar por lo que EOS VIO SALIR (la mediana de los
 * meses anteriores) o por lo que la persona DECLARÓ como fijo más sus cuotas.
 * Ninguna de las dos está completa: la primera no ve el efectivo, la segunda no
 * cubre el supermercado.
 *
 * Se toma la mayor. En un fondo de emergencia, quedarse corto es el error caro:
 * el número existe justamente para el mes en que no entra plata.
 */

export type PartidaEsencial = {
  etiqueta: string;
  monto: number;
  fuente: "observado" | "declarado";
};

/** Los destinos que se siguen pagando cuando se corta el ingreso. */
export const DESTINOS_ESENCIALES = [
  "vivienda",
  "servicios",
  "salud",
  "mercado",
  "transporte",
  "educacion",
  "deudas",
  "impuestos",
] as const;

/** Las opciones que se le ofrecen, con su número. Ninguna es la correcta. */
const MESES_OFRECIDOS = [3, 6, 12];

/** En cuántos meses se plantea llegar a la meta, para poder decir el aporte. */
const MESES_PARA_ARMARLO = 12;

export type OpcionFondo = {
  meses: number;
  meta: number;
  falta: number;
  /** Cuánto habría que apartar por mes para llegar en un año. */
  aporte_mensual: number;
};

export type Fondo = {
  /** Lo que cuesta un mes de vida, sin lo prescindible. */
  gasto_esencial: number;
  /** De dónde salió ese número. */
  base: "observado" | "declarado";
  detalle: PartidaEsencial[];
  /** Lo que EOS vio salir y no supo clasificar, por mes. */
  sin_reconocer: number;

  /** Lo que ya tiene apartado. */
  fondo_actual: number;
  /** Cuántos meses aguanta hoy. `null` sin gasto esencial conocido. */
  meses_cubiertos: number | null;

  /** Lo que la persona eligió cubrir. `null` mientras no elija. */
  meses_elegidos: number | null;
  meta: number | null;
  falta: number | null;
  /** Lo que hay que apartar por mes para llegar en un año. */
  aporte_mensual: number | null;

  opciones: OpcionFondo[];
  /** Una sugerencia solo cuando hay un dato que la sostenga. */
  sugerencia: { meses: number; porque: string } | null;

  confianza: { nivel: number; motivos: string[] };
};

export function armarFondo(datos: {
  /**
   * Total gastado por mes en destinos esenciales, en meses anteriores
   * completos, del más viejo al más nuevo.
   */
  esencialPorMes: number[];
  /** Lo que quedó sin clasificar por mes, para poder informarlo. */
  sinReconocerPorMes: number[];
  /** Fijos de gasto declarados, ya mensualizados. */
  fijos: { descripcion: string; monto: number }[];
  /** Cuotas de deuda que salen todos los meses. */
  cuotas: { descripcion: string; monto: number }[];
  /** Lo que ya tiene apartado para esto. */
  fondoActual: number;
  /** Los meses que eligió cubrir, si eligió. */
  mesesElegidos: number | null;
  /**
   * Si EOS detectó un ingreso que llega parejo todos los meses. `null` cuando
   * todavía no tiene con qué saberlo.
   */
  ingresoRegular: boolean | null;
}): Fondo {
  const { esencialPorMes, sinReconocerPorMes, fijos, cuotas, fondoActual, mesesElegidos } = datos;

  const observado = esencialPorMes.length > 0 ? redondear(mediana(esencialPorMes)) : 0;
  const declarado = redondear(
    fijos.reduce((t, f) => t + f.monto, 0) + cuotas.reduce((t, c) => t + c.monto, 0),
  );

  const base: Fondo["base"] = declarado > observado ? "declarado" : "observado";
  const esencial = Math.max(observado, declarado);

  const detalle: PartidaEsencial[] =
    base === "declarado"
      ? [
          ...fijos.map((f) => ({ etiqueta: f.descripcion, monto: f.monto, fuente: "declarado" as const })),
          ...cuotas.map((c) => ({ etiqueta: c.descripcion, monto: c.monto, fuente: "declarado" as const })),
        ].sort((a, b) => b.monto - a.monto)
      : observado > 0
        ? [{ etiqueta: "Lo que se te va por mes en lo esencial", monto: observado, fuente: "observado" }]
        : [];

  const sinReconocer =
    sinReconocerPorMes.length > 0 ? redondear(mediana(sinReconocerPorMes)) : 0;

  const fondo = redondear(Math.max(0, fondoActual));
  const mesesCubiertos = esencial > 0 ? redondear(fondo / esencial) : null;

  const opciones: OpcionFondo[] = esencial > 0
    ? MESES_OFRECIDOS.map((meses) => {
        const meta = redondear(esencial * meses);
        const falta = redondear(Math.max(0, meta - fondo));
        return { meses, meta, falta, aporte_mensual: redondear(falta / MESES_PARA_ARMARLO) };
      })
    : [];

  const elegida = mesesElegidos === null ? null : (opciones.find((o) => o.meses === mesesElegidos) ??
    (esencial > 0
      ? {
          meses: mesesElegidos,
          meta: redondear(esencial * mesesElegidos),
          falta: redondear(Math.max(0, esencial * mesesElegidos - fondo)),
          aporte_mensual: redondear(
            Math.max(0, esencial * mesesElegidos - fondo) / MESES_PARA_ARMARLO,
          ),
        }
      : null));

  return {
    gasto_esencial: redondear(esencial),
    base,
    detalle,
    sin_reconocer: sinReconocer,
    fondo_actual: fondo,
    meses_cubiertos: mesesCubiertos,
    meses_elegidos: mesesElegidos,
    meta: elegida?.meta ?? null,
    falta: elegida?.falta ?? null,
    aporte_mensual: elegida?.aporte_mensual ?? null,
    opciones,
    sugerencia: sugerir(datos.ingresoRegular),
    confianza: confianzaDe({
      esencial,
      mesesDeHistoria: esencialPorMes.length,
      sinReconocer,
      base,
    }),
  };
}

/**
 * La sugerencia, y solo si hay un dato que la sostenga.
 *
 * Un ingreso que llega parejo todos los meses y uno que varía no necesitan el
 * mismo colchón, y eso EOS lo puede medir. Lo que no puede es decir "los
 * expertos recomiendan seis meses": eso no es un hecho sobre esta persona.
 */
function sugerir(ingresoRegular: boolean | null): Fondo["sugerencia"] {
  if (ingresoRegular === null) return null;

  return ingresoRegular
    ? { meses: 3, porque: "tu ingreso llega parejo todos los meses, así que un corte se ve venir con tiempo" }
    : { meses: 6, porque: "tus ingresos varían bastante de un mes a otro, y eso pide más colchón" };
}

function confianzaDe(datos: {
  esencial: number;
  mesesDeHistoria: number;
  sinReconocer: number;
  base: Fondo["base"];
}): { nivel: number; motivos: string[] } {
  const motivos: string[] = [];
  let nivel = 1;

  if (datos.esencial === 0) {
    return {
      nivel: 0,
      motivos: ["todavía no sé cuánto te cuesta un mes de vida, así que no puedo decirte cuánto fondo te hace falta"],
    };
  }

  if (datos.mesesDeHistoria === 0) {
    nivel -= 0.3;
    motivos.push("todavía no tengo un mes completo de gastos, así que esto sale solo de lo que declaraste");
  } else if (datos.mesesDeHistoria < 3) {
    nivel -= 0.15;
    motivos.push(`tengo ${datos.mesesDeHistoria === 1 ? "un mes" : `${datos.mesesDeHistoria} meses`} de historia, y con más se afina`);
  }

  /*
   * Lo sin clasificar importa cuando pesa. Un 20% del gasto esencial sin
   * reconocer puede cambiar la meta en un mes entero de cobertura, y esa es la
   * diferencia entre llegar y no llegar.
   */
  if (datos.sinReconocer > datos.esencial * 0.2) {
    nivel -= 0.2;
    motivos.push("hay una parte de tus gastos que todavía no supe clasificar, así que puede faltar");
  }

  return { nivel: Math.max(0, redondear(nivel)), motivos };
}

function mediana(valores: number[]): number {
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);

  return orden.length % 2 === 1 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
}

function redondear(valor: number): number {
  return Number.isFinite(valor) ? Math.round(valor * 100) / 100 : 0;
}
