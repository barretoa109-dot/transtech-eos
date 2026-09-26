/**
 * Combinaciones ya armadas, como atajo hacia el armador (punto 9 del plan de
 * fortalecimiento, docs/estrategia/simplificacion-precios-diseno.md).
 *
 * ============================================================
 * NO SON PLANES
 * ============================================================
 *
 * La decisión del usuario fue que no haya paquetes cerrados: cada uno arma su
 * EOS y paga la suma (ver `armado.ts`). Esto no la deshace. Un preset es una
 * lista de códigos de módulo que PRE-LLENA la misma selección del armador y
 * deja todo editable; el precio sale del mismo `calcularArmado` y el que cobra
 * sigue siendo `eos_precio_armado` en la base. No hay catálogo paralelo que se
 * pueda desincronizar.
 *
 * Lo que resuelve: la primera pantalla le pedía a alguien que todavía no
 * conoce EOS que arme su combo antes de entender qué compra. Tres puntos de
 * partida, pensados para el ICP validado (dueño de pyme que carga ventas,
 * compras y stock hablando), bajan esa carga sin quitarle la libertad.
 *
 * Arranca APAGADO: se ve solo con `NEXT_PUBLIC_EOS_PRESETS_PLANES=1`, porque
 * contradice a la letra el comentario "ninguna combinación sugerida" de
 * `app/planes/page.tsx` y esa es una decisión que toma el usuario, no una
 * sesión de Code.
 */

import { calcularArmado, type ModuloCatalogo, type Periodicidad } from "./armado.ts";

export type CodigoPreset = "empezar" | "negocio" | "negocio_completo";

export type Preset = {
  codigo: CodigoPreset;
  nombre: string;
  /** A quién le habla, en una línea. */
  para: string;
  modulos: readonly string[];
};

export const PRESETS: readonly Preset[] = [
  {
    codigo: "empezar",
    nombre: "Empezar",
    para: "Para hablar con EOS todos los días. El panel financiero ya es gratis.",
    modulos: ["conversaciones_full"],
  },
  {
    codigo: "negocio",
    nombre: "Negocio",
    para: "Cargá ventas, compras y stock hablando, y mirá cómo va tu negocio.",
    modulos: ["conversaciones_full", "dashboard", "erp"],
  },
  {
    codigo: "negocio_completo",
    nombre: "Negocio completo",
    para: "Todo lo de Negocio, más clientes, el resumen diario y comprobantes.",
    modulos: ["conversaciones_full", "dashboard", "erp", "crm", "briefing", "facturacion"],
  },
];

export function esCodigoPreset(valor: unknown): valor is CodigoPreset {
  return typeof valor === "string" && PRESETS.some((p) => p.codigo === valor);
}

export type PresetCalculado = Preset & {
  /** Los módulos que quedan de verdad, ya resueltos contra el catálogo vigente. */
  seleccion: string[];
  total: number;
};

/**
 * Los presets que se pueden mostrar HOY, con su precio.
 *
 * Un preset al que le falta un módulo en el catálogo (se desactivó, cambió de
 * código) no se muestra: venderle a alguien "Negocio" sin el ERP adentro sería
 * peor que no ofrecer el atajo. Tampoco se muestra uno cuyo total sea igual al
 * de otro anterior (no aportaría nada distinto).
 */
export function presetsDisponibles(
  catalogo: ModuloCatalogo[],
  periodicidad: Periodicidad = "mensual",
): PresetCalculado[] {
  const codigos = new Set(catalogo.map((m) => m.codigo));
  const salida: PresetCalculado[] = [];

  for (const preset of PRESETS) {
    if (!preset.modulos.every((c) => codigos.has(c))) continue;

    const armado = calcularArmado([...preset.modulos], catalogo, periodicidad);
    if (armado.modulos.length === 0) continue;
    if (salida.some((p) => p.total === armado.total)) continue;

    salida.push({ ...preset, seleccion: armado.modulos, total: armado.total });
  }

  return salida;
}

/**
 * ¿La selección actual sigue siendo exactamente la del preset?
 *
 * Sirve para registrar si la persona se quedó con el atajo tal cual o lo
 * editó: las dos respuestas dicen algo distinto sobre si los presets ayudan.
 */
export function seleccionIgualAPreset(
  seleccion: string[],
  preset: CodigoPreset,
  catalogo: ModuloCatalogo[],
): boolean {
  const def = PRESETS.find((p) => p.codigo === preset);
  if (!def) return false;

  const actual = calcularArmado(seleccion, catalogo).modulos;
  const delPreset = calcularArmado([...def.modulos], catalogo).modulos;

  return actual.length === delPreset.length && actual.every((c, i) => c === delPreset[i]);
}

/** La bandera. Cualquier valor distinto de "1" la deja apagada. */
export function presetsVisibles(valor: string | undefined): boolean {
  return String(valor ?? "").trim() === "1";
}
