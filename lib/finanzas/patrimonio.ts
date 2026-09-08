/**
 * Patrimonio: lo que tiene menos lo que debe.
 *
 * ============================================================
 * POR QUÉ ESTE MÓDULO SE NIEGA A DAR UN NÚMERO
 * ============================================================
 *
 * Sumar los saldos de las cuentas y llamar a eso "patrimonio neto" es la forma
 * más común de mentir en una app de finanzas. Un neto es ACTIVOS − PASIVOS, y
 * quien lee la palabra "neto" entiende que las dos partes están adentro.
 *
 * Alguien con 12.000.000 en el banco y 40.000.000 de préstamo no tiene un
 * patrimonio de 12.000.000: lo tiene negativo. Mostrarle el primer número con
 * ese nombre le dice exactamente lo contrario de su situación, en el indicador
 * que más pesa.
 *
 * Por eso `neto` es `null` mientras falte una de las dos mitades, y `falta`
 * dice cuál. Un renglón que dice "todavía no puedo calcularlo porque no sé si
 * debés algo" es información; un número tranquilizador construido sobre la
 * mitad de los datos, no.
 *
 * ============================================================
 * TODO ACÁ ES DECLARADO, Y CADA COSA CON SU FECHA
 * ============================================================
 *
 * EOS no ve el saldo bancario de nadie ni tasa autos. Cada línea es lo que la
 * persona dijo el día que lo dijo, y eso viaja pegado al número: un patrimonio
 * armado con un saldo de marzo y una deuda de ayer no es de hoy, es una mezcla
 * de dos momentos.
 *
 * `neto` es lo único CALCULADO. La distinción entre declarado y calculado no es
 * decorativa: es lo que permite que la pantalla no presente una cosa como la
 * otra.
 *
 * ============================================================
 * UNA MONEDA A LA VEZ
 * ============================================================
 *
 * No se convierte ni se suma entre monedas, por lo mismo que el resto del
 * panel. Los dólares se comparan con los dólares.
 *
 * Es puro: recibe filas ya leídas y no toca la base.
 */

export type LineaPatrimonio = {
  nombre: string;
  /** Qué clase de cosa es. */
  tipo: string;
  monto: number;
  /** Cuándo la declaró la persona. `null` si nunca puso fecha. */
  declarado_el: string | null;
};

export type Patrimonio = {
  moneda: string;

  /** Lo que tiene: cuentas más bienes declarados. */
  activos: number;
  detalle_activos: LineaPatrimonio[];
  /** Lo que debe. */
  pasivos: number;
  detalle_pasivos: LineaPatrimonio[];

  /**
   * ACTIVOS − PASIVOS. `null` cuando no se puede afirmar, que es la mayoría de
   * las veces al principio.
   */
  neto: number | null;
  /** Qué falta para poder calcularlo. `null` cuando ya se pudo. */
  falta: string | null;

  /** La fecha del dato MÁS VIEJO que lo compone. */
  desde_cuando: string | null;
  /** Cuántos días tiene ese dato. */
  antiguedad_dias: number | null;

  confianza: { nivel: number; motivos: string[] };
};

/**
 * A partir de cuántos días un patrimonio deja de describir el presente.
 *
 * Noventa: un trimestre es el ritmo natural con el que alguien revisa cuánto
 * tiene. Más que eso y el número habla de otra época.
 */
const DIAS_HASTA_QUE_ENVEJECE = 90;

export const FALTAN_ACTIVOS =
  "Todavía no sé qué tenés. Cargá tus cuentas y, si querés, tus bienes: sin eso el patrimonio sería solo tus deudas en negativo.";

export const FALTAN_PASIVOS =
  "Todavía no sé si debés algo. Sumar tus saldos sin restar deudas no es patrimonio neto, y llamarlo así diría lo contrario de tu situación.";

export function armarPatrimonio(datos: {
  moneda: string;
  hoy: string;
  /** Saldos de cuentas declarados, de esta moneda. */
  cuentas: { nombre: string; tipo: string; saldo: number | null; declarado_el: string | null }[];
  /** Bienes declarados: un inmueble, un vehículo, una inversión. */
  bienes: { nombre: string; tipo: string; valor: number; declarado_el: string | null }[];
  /** Deudas declaradas, de esta moneda. */
  deudas: { acreedor: string; tipo: string; saldo: number; declarado_el: string | null }[];
  /**
   * Si ya se le preguntó a la persona por sus deudas.
   *
   * Sin esto, una lista vacía de deudas es ambigua: puede significar "no debo
   * nada" o "todavía no lo cargué", y las dos dan un patrimonio muy distinto.
   */
  pasivosConfirmados: boolean;
}): Patrimonio {
  const { moneda, hoy, pasivosConfirmados } = datos;

  /*
   * Una cuenta sin saldo declarado NO entra como cero. Cero dice "no hay
   * plata"; lo que pasa es que no sabemos cuánta hay, y son cosas distintas.
   */
  const detalleActivos: LineaPatrimonio[] = [
    ...datos.cuentas
      .filter((c) => c.saldo !== null)
      .map((c) => ({
        nombre: c.nombre,
        tipo: c.tipo,
        monto: c.saldo as number,
        declarado_el: c.declarado_el,
      })),
    ...datos.bienes.map((b) => ({
      nombre: b.nombre,
      tipo: b.tipo,
      monto: b.valor,
      declarado_el: b.declarado_el,
    })),
  ].sort((a, b) => b.monto - a.monto);

  const detallePasivos: LineaPatrimonio[] = datos.deudas
    .map((d) => ({ nombre: d.acreedor, tipo: d.tipo, monto: d.saldo, declarado_el: d.declarado_el }))
    .sort((a, b) => b.monto - a.monto);

  const activos = redondear(detalleActivos.reduce((t, l) => t + l.monto, 0));
  const pasivos = redondear(detallePasivos.reduce((t, l) => t + l.monto, 0));

  const hayActivos = detalleActivos.length > 0;
  const sabemosLosPasivos = pasivosConfirmados || detallePasivos.length > 0;

  const falta = !hayActivos ? FALTAN_ACTIVOS : !sabemosLosPasivos ? FALTAN_PASIVOS : null;

  const fechas = [...detalleActivos, ...detallePasivos]
    .map((l) => l.declarado_el)
    .filter((f): f is string => f !== null)
    .sort();

  const desdeCuando = fechas[0] ?? null;
  const antiguedad = desdeCuando === null ? null : diasEntre(desdeCuando, hoy);

  return {
    moneda,
    activos,
    detalle_activos: detalleActivos,
    pasivos,
    detalle_pasivos: detallePasivos,
    neto: falta === null ? redondear(activos - pasivos) : null,
    falta,
    desde_cuando: desdeCuando,
    antiguedad_dias: antiguedad,
    confianza: confianzaDe({
      cuentasSinSaldo: datos.cuentas.filter((c) => c.saldo === null).length,
      sinFecha: [...detalleActivos, ...detallePasivos].filter((l) => l.declarado_el === null).length,
      antiguedad,
      desdeCuando,
      hayBienes: datos.bienes.length > 0,
    }),
  };
}

function confianzaDe(datos: {
  cuentasSinSaldo: number;
  sinFecha: number;
  antiguedad: number | null;
  desdeCuando: string | null;
  hayBienes: boolean;
}): { nivel: number; motivos: string[] } {
  const motivos: string[] = [];
  let nivel = 1;

  if (datos.cuentasSinSaldo > 0) {
    nivel -= 0.2;
    motivos.push(
      datos.cuentasSinSaldo === 1
        ? "hay una cuenta sin saldo declarado, y no la conté como cero"
        : `hay ${datos.cuentasSinSaldo} cuentas sin saldo declarado, y no las conté como cero`,
    );
  }

  if (datos.antiguedad !== null && datos.antiguedad > DIAS_HASTA_QUE_ENVEJECE) {
    nivel -= 0.3;
    motivos.push(`el dato más viejo es del ${datos.desdeCuando}, así que esto describe ese momento y no hoy`);
  }

  if (datos.sinFecha > 0) {
    nivel -= 0.1;
    motivos.push("hay valores sin fecha, así que no sé de cuándo son");
  }

  if (!datos.hayBienes) {
    nivel -= 0.1;
    motivos.push("solo estoy contando plata: si tenés casa, auto o inversiones, cargalos y el número cambia");
  }

  return { nivel: Math.max(0, redondear(nivel)), motivos };
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((enUTC(hasta) - enUTC(desde)) / 86_400_000);
}

function enUTC(iso: string): number {
  const [anio, mes, dia] = iso.split("-").map(Number);
  return Date.UTC(anio, mes - 1, dia);
}

function redondear(valor: number): number {
  return Number.isFinite(valor) ? Math.round(valor * 100) / 100 : 0;
}
