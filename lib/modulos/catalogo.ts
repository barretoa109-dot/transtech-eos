/**
 * Los anexos de EOS.
 *
 * Un módulo es una funcionalidad que se contrata SUELTA y viene ya conectada
 * a EOS: el usuario no compra "otro producto", le agrega una parte al que ya
 * usa. Por eso no son planes — ver el comentario largo de la migración
 * `20260825210000_eos_modulos_anexos_v63.sql` para por qué modelarlos como
 * planes se vuelve inmanejable a partir del segundo módulo.
 *
 * Esta lista existe en TypeScript además de en la tabla `eos_modulos` por una
 * sola razón: para que `tieneModulo("erp")` sea un error de compilación si
 * alguien escribe `"eerp"`. La AUTORIDAD sobre qué módulos existen, cuánto
 * cuestan y si están activos es la tabla; esto es solo el juego de llaves.
 */

export const MODULOS = {
  erp: {
    nombre: "ERP",
    /** Lo que el usuario contrata, en una línea. */
    resumen: "Operaciones, inventario y compras, sobre lo que EOS ya sabe del negocio.",
  },
  crm: {
    nombre: "CRM",
    resumen: "Clientes, oportunidades y seguimiento comercial, con el mismo contexto.",
  },
} as const;

export type CodigoModulo = keyof typeof MODULOS;

export function esCodigoModulo(valor: string): valor is CodigoModulo {
  return Object.prototype.hasOwnProperty.call(MODULOS, valor);
}

export function nombreModulo(codigo: string): string {
  return esCodigoModulo(codigo) ? MODULOS[codigo].nombre : codigo.toUpperCase();
}

export type ModuloActivo = {
  codigo: string;
  nombre: string;
  estado: string;
  /** ISO, o `null` cuando no vence (cortesía o uso interno). */
  vencimiento: string | null;
  origen: string;
};

/**
 * ¿Le queda poco a este módulo?
 *
 * Se avisa con anticipación en la interfaz por el mismo motivo por el que EOS
 * avisa de un aprieto de plata antes de que ocurra: enterarse de que se venció
 * el ERP cuando ya no abre es enterarse tarde. Diez días alcanzan para
 * renovar sin apuro y no son tantos como para volverse ruido de fondo.
 */
export const DIAS_AVISO_VENCIMIENTO = 10;

export function porVencer(
  modulo: Pick<ModuloActivo, "vencimiento">,
  ahora: Date = new Date(),
): boolean {
  if (!modulo.vencimiento) return false;

  const falta = Date.parse(modulo.vencimiento) - ahora.getTime();
  return falta > 0 && falta <= DIAS_AVISO_VENCIMIENTO * 86_400_000;
}

/** Días que faltan, redondeados hacia arriba. `null` si no vence. */
export function diasRestantes(
  modulo: Pick<ModuloActivo, "vencimiento">,
  ahora: Date = new Date(),
): number | null {
  if (!modulo.vencimiento) return null;
  return Math.ceil((Date.parse(modulo.vencimiento) - ahora.getTime()) / 86_400_000);
}
