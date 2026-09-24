/**
 * Un ACTUALIZAR_PRODUCTO que solo pone costo va después de lo que crea el
 * producto (24/09/2026). Mismo cálculo que `costoDespuesDeCrear` en
 * `lib/gateway/jobs.ts`; un test exige que den el mismo orden.
 *
 * Caso real: "Registrá esta venta: Campera, 230.000, costo 207.052". Si el
 * costo corriera antes que la venta, el producto no existiría todavía y el
 * costo se perdería. Solo se mueve el que pone costo sin precio: un cambio de
 * precio antes de una venta puede ser a propósito.
 *
 * Se aplica sobre el nodo 06 que ya tiene el parche de acciones repetidas.
 */

const HELPER = [
  "/* =========================================================",
  "   COSTO DESPUES DE CREAR (24/09/2026)",
  "",
  "   Un ACTUALIZAR_PRODUCTO que solo pone costo va despues de la venta,",
  "   compra o alta que crea el producto. Mismo calculo que",
  "   costoDespuesDeCrear en lib/gateway/jobs.ts.",
  "========================================================= */",
  "",
  "function costoDespuesDeCrear(lista) {",
  "  const CREAN = new Set(['REGISTRAR_VENTA', 'REGISTRAR_COMPRA', 'CREAR_PRODUCTO']);",
  "  const tipoDe = (a) => String(a?.tipo || '').trim().toUpperCase();",
  "  let ultimoCreador = -1;",
  "  lista.forEach((a, i) => { if (CREAN.has(tipoDe(a))) ultimoCreador = i; });",
  "  if (ultimoCreador < 0) return lista;",
  "  const soloCosto = (a) => {",
  "    if (tipoDe(a) !== 'ACTUALIZAR_PRODUCTO') return false;",
  "    const productos = normalizarDatos('ACTUALIZAR_PRODUCTO', a?.datos).productos;",
  "    return Array.isArray(productos) && productos.length > 0 && productos.every((p) => {",
  "      const r = p || {};",
  "      const precio = r.precio_venta ?? r.precio;",
  "      return r.costo !== undefined && r.costo !== null && (precio === undefined || precio === null);",
  "    });",
  "  };",
  "  const diferidas = lista.filter((a, i) => i < ultimoCreador && soloCosto(a));",
  "  if (diferidas.length === 0) return lista;",
  "  const resto = lista.filter((a) => !diferidas.includes(a));",
  "  const corte = resto.indexOf(lista[ultimoCreador]) + 1;",
  "  return [...resto.slice(0, corte), ...diferidas, ...resto.slice(corte)];",
  "}",
  "",
].join("\n");

export const CAMBIOS = [
  {
    donde: "la lista deduplicada pasa a llamarse _unicas",
    viejo: "const accionesUnicas = acciones.filter((accion) => {",
    nuevo: HELPER + "const _unicas = acciones.filter((accion) => {",
  },
  {
    donde: "accionesUnicas queda ordenada",
    viejo: "const _porTipo = new Map();",
    nuevo: "const accionesUnicas = costoDespuesDeCrear(_unicas);\n\nconst _porTipo = new Map();",
  },
];

export function aplicar(texto, etiqueta) {
  let salida = texto;
  for (const c of CAMBIOS) {
    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(
        `[${etiqueta}] "${c.donde}": el texto aparece ${partes.length - 1} veces, no 1. No se escribió nada.`,
      );
    }
    salida = partes.join(c.nuevo);
  }
  return salida;
}
