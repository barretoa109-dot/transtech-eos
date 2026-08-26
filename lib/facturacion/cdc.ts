/**
 * El CDC: el código de control de 44 dígitos que identifica una factura
 * electrónica ante la SET.
 *
 * ============================================================
 * CÓMO ESTÁ ARMADO
 * ============================================================
 *
 *   posición  largo  qué es
 *   --------  -----  ----------------------------------------------
 *    1 -  2      2   tipo de documento (01 factura, 05 nota crédito…)
 *    3 - 10      8   RUC del emisor, sin el dígito verificador
 *   11 - 11      1   dígito verificador del RUC
 *   12 - 14      3   establecimiento
 *   15 - 17      3   punto de expedición
 *   18 - 24      7   número del documento
 *   25 - 25      1   tipo de contribuyente (1 física, 2 jurídica)
 *   26 - 33      8   fecha de emisión, AAAAMMDD
 *   34 - 34      1   tipo de emisión (1 normal, 2 contingencia)
 *   35 - 43      9   código de seguridad aleatorio
 *   44 - 44      1   dígito verificador del CDC
 *
 * ============================================================
 * LO QUE HAY QUE VERIFICAR ANTES DE EMITIR DE VERDAD
 * ============================================================
 *
 * El algoritmo del dígito verificador —módulo 11 con pesos de 2 a 11— es el
 * que la SET publica y el mismo que valida un RUC paraguayo. Está implementado
 * acá con sus tests, pero **antes de emitir en producción hay que contrastar
 * al menos un CDC contra el ambiente de prueba de SIFEN**. Un dígito mal
 * calculado no se descubre facturando: se descubre cuando SIFEN rechaza el
 * lote entero, y para entonces ya se le entregó el comprobante al cliente.
 *
 * El código de seguridad es aleatorio y **tiene que serlo**: es lo que impide
 * que alguien de afuera adivine el CDC de una factura que todavía no se emitió
 * y consulte los datos de otro contribuyente. Por eso sale de
 * `crypto.getRandomValues` y no de `Math.random`.
 */

export type TipoDocumento = 1 | 4 | 5 | 6 | 7;

export type DatosCdc = {
  tipoDocumento: TipoDocumento;
  /** RUC sin dígito verificador, hasta 8 dígitos. */
  ruc: string;
  rucDv: number;
  establecimiento: string;
  puntoExpedicion: string;
  numero: number;
  /** 1 persona física, 2 persona jurídica. */
  tipoContribuyente: 1 | 2;
  /** `YYYY-MM-DD`. */
  fechaEmision: string;
  /** 1 normal, 2 contingencia. */
  tipoEmision?: 1 | 2;
  /** Nueve dígitos. Si falta, se genera uno aleatorio. */
  codigoSeguridad?: string;
};

/**
 * Dígito verificador módulo 11, el mismo que valida un RUC paraguayo.
 *
 * Los pesos van de 2 a 11 de derecha a izquierda y vuelven a empezar. Si el
 * resto es 0 o 1 el dígito es 0; si no, es 11 menos el resto.
 */
export function digitoVerificador(numero: string, base = 11): number {
  const soloDigitos = numero.replace(/\D/g, "");

  let total = 0;
  let peso = 2;

  for (let i = soloDigitos.length - 1; i >= 0; i -= 1) {
    if (peso > base) peso = 2;
    total += Number(soloDigitos[i]) * peso;
    peso += 1;
  }

  const resto = total % 11;
  return resto > 1 ? 11 - resto : 0;
}

/** ¿El dígito que declaró el usuario es el que le corresponde a ese RUC? */
export function rucValido(ruc: string, dv: number): boolean {
  const limpio = ruc.replace(/\D/g, "");
  if (!limpio || limpio.length > 8) return false;

  return digitoVerificador(limpio) === dv;
}

/**
 * Nueve dígitos aleatorios de verdad.
 *
 * `Math.random` no sirve: es predecible, y este número es lo único que impide
 * que alguien arme el CDC de una factura ajena a partir de datos públicos —el
 * RUC y la numeración lo son— y consulte lo que no es suyo.
 */
export function codigoDeSeguridad(): string {
  const bytes = new Uint32Array(3);
  crypto.getRandomValues(bytes);

  const crudo = Array.from(bytes)
    .map((n) => String(n).padStart(9, "0"))
    .join("");

  return crudo.slice(0, 9);
}

function rellenar(valor: string | number, largo: number): string {
  return String(valor).replace(/\D/g, "").padStart(largo, "0").slice(-largo);
}

export type Cdc = {
  /** Los 44 dígitos. */
  valor: string;
  /** El código de seguridad usado, para poder guardarlo junto al documento. */
  codigoSeguridad: string;
};

export function generarCdc(datos: DatosCdc): Cdc {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fechaEmision)) {
    throw new Error("EOS_FE_FECHA_INVALIDA");
  }

  if (!rucValido(datos.ruc, datos.rucDv)) {
    throw new Error("EOS_FE_RUC_INVALIDO");
  }

  if (datos.numero < 1 || datos.numero > 9_999_999) {
    throw new Error("EOS_FE_NUMERO_INVALIDO");
  }

  const codigoSeguridad = datos.codigoSeguridad
    ? rellenar(datos.codigoSeguridad, 9)
    : codigoDeSeguridad();

  const cuerpo = [
    rellenar(datos.tipoDocumento, 2),
    rellenar(datos.ruc, 8),
    rellenar(datos.rucDv, 1),
    rellenar(datos.establecimiento, 3),
    rellenar(datos.puntoExpedicion, 3),
    rellenar(datos.numero, 7),
    rellenar(datos.tipoContribuyente, 1),
    datos.fechaEmision.replace(/-/g, ""),
    rellenar(datos.tipoEmision ?? 1, 1),
    codigoSeguridad,
  ].join("");

  if (cuerpo.length !== 43) {
    throw new Error(`EOS_FE_CDC_LARGO_INVALIDO: ${cuerpo.length}`);
  }

  return { valor: cuerpo + digitoVerificador(cuerpo), codigoSeguridad };
}

/** ¿Este CDC es coherente consigo mismo? Sirve para validar lo que llega. */
export function cdcValido(cdc: string): boolean {
  if (!/^\d{44}$/.test(cdc)) return false;
  return digitoVerificador(cdc.slice(0, 43)) === Number(cdc.slice(43));
}

/** Los pedazos del CDC, para poder mostrarlos o auditarlos. */
export function leerCdc(cdc: string) {
  if (!cdcValido(cdc)) return null;

  return {
    tipoDocumento: Number(cdc.slice(0, 2)),
    ruc: cdc.slice(2, 10),
    rucDv: Number(cdc.slice(10, 11)),
    establecimiento: cdc.slice(11, 14),
    puntoExpedicion: cdc.slice(14, 17),
    numero: Number(cdc.slice(17, 24)),
    tipoContribuyente: Number(cdc.slice(24, 25)),
    fechaEmision: `${cdc.slice(25, 29)}-${cdc.slice(29, 31)}-${cdc.slice(31, 33)}`,
    tipoEmision: Number(cdc.slice(33, 34)),
    codigoSeguridad: cdc.slice(34, 43),
    dv: Number(cdc.slice(43)),
  };
}

/** "001-001-0000123", que es como se lee un número de factura acá. */
export function numeroFormateado(
  establecimiento: string,
  punto: string,
  numero: number,
): string {
  return `${rellenar(establecimiento, 3)}-${rellenar(punto, 3)}-${rellenar(numero, 7)}`;
}
