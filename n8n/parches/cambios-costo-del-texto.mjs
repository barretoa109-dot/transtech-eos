/**
 * El costo que el modelo ESCRIBIÓ en la respuesta viaja con la venta
 * (25/09/2026). Mismo cálculo que `costoDesdeLaRespuesta` en
 * `lib/gateway/jobs.ts`; un test exige que den lo mismo.
 *
 * Caso real: Sofía. El texto decía "Zapatos Mary Jane: venta ₲180.000, costo
 * ₲146.473,876" y la venta salió sin costo, así que el worker le contestó
 * "no sé el costo". El prompt ya pide `costo_unitario` (ver
 * `cambios-venta-con-costo.mjs`); esto es la red para cuando el modelo lo
 * escribe y se olvida de mandarlo.
 *
 * Se aplica sobre el nodo 06 que ya tiene el parche de orden del costo.
 */

const HELPER = [
  "/* =========================================================",
  "   COSTO DESDE LA RESPUESTA (25/09/2026)",
  "",
  "   Si el texto le muestra a la persona el costo de un producto de la",
  "   venta y el item no lo trae, se copia al item. Solo completa, nunca",
  "   pisa. Mismo calculo que costoDesdeLaRespuesta en lib/gateway/jobs.ts.",
  "========================================================= */",
  "",
  "function costoDesdeLaRespuesta(lista, respuesta) {",
  "  const plano = (t) => String(t == null ? '' : t).normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/\\s+/g, ' ').trim();",
  "  const lineas = String(respuesta == null ? '' : respuesta).split('\\n').map(plano);",
  "  if (!lineas.some((l) => l.includes('costo'))) return lista;",
  "  const leer = (t) => {",
  "    const limpio = t.replace(/[.,]+$/, '');",
  "    let n;",
  "    if (limpio.includes(',')) n = Number(limpio.replace(/\\./g, '').replace(',', '.'));",
  "    else if (/^\\d{1,3}(\\.\\d{3})+$/.test(limpio)) n = Number(limpio.replace(/\\./g, ''));",
  "    else n = Number(limpio);",
  "    return Number.isFinite(n) && n > 0 ? n : null;",
  "  };",
  "  const costoDe = (producto) => {",
  "    const nombre = plano(producto);",
  "    if (nombre.length < 3) return null;",
  "    for (const linea of lineas) {",
  "      const desde = linea.indexOf(nombre);",
  "      if (desde < 0) continue;",
  "      const m = linea.slice(desde + nombre.length).match(/\\bcosto(?: unitario)?:? (?:de )?(?:(?:\\u20B2|gs\\.?) ?)?(\\d[\\d.,]*)/);",
  "      if (m) return leer(m[1]);",
  "    }",
  "    return null;",
  "  };",
  "  return lista.map((a) => {",
  "    if (String(a?.tipo || '').trim().toUpperCase() !== 'REGISTRAR_VENTA') return a;",
  "    const datos = a?.datos && typeof a.datos === 'object' ? a.datos : {};",
  "    if (!Array.isArray(datos.items)) return a;",
  "    let cambio = false;",
  "    const items = datos.items.map((item) => {",
  "      if (!item || typeof item !== 'object') return item;",
  "      if (item.costo_unitario != null || item.costo != null) return item;",
  "      const costo = costoDe(String(item.producto ?? item.nombre ?? item.descripcion ?? ''));",
  "      if (costo === null) return item;",
  "      cambio = true;",
  "      return { ...item, costo_unitario: costo };",
  "    });",
  "    return cambio ? { ...a, datos: { ...datos, items } } : a;",
  "  });",
  "}",
  "",
].join("\n");

export const CAMBIOS = [
  {
    donde: "accionesUnicas lleva el costo del texto",
    viejo: "const accionesUnicas = costoDespuesDeCrear(_unicas);",
    nuevo: HELPER + "const accionesUnicas = costoDesdeLaRespuesta(costoDespuesDeCrear(_unicas), i.respuesta);",
  },
];

export function aplicar(texto, etiqueta) {
  if (texto.includes("function costoDesdeLaRespuesta")) {
    throw new Error(`[${etiqueta}] el nodo ya copia el costo del texto. No se escribió nada.`);
  }
  let salida = texto;
  for (const c of CAMBIOS) {
    if (c.nuevo.includes("`")) throw new Error(`[${etiqueta}] comilla invertida en "${c.donde}"`);
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
