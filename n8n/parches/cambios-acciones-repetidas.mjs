/**
 * Dos acciones del mismo tipo en un mensaje ya no chocan en el Worker Gate.
 *
 * ============================================================
 * EL DEFECTO (24 de septiembre de 2026, usando EOS de verdad)
 * ============================================================
 *
 * El gate identifica cada orden por (usuario, request_id, acción). Cuando el
 * modelo pidió dos acciones del mismo tipo en un mensaje —dos memorias, dos
 * tarjetas— la segunda llegó con la misma identidad y otro contenido, y el
 * gate la rechazó: `409 EOS_COMMAND_PAYLOAD_MISMATCH`, que además se vio
 * crudo en el chat.
 *
 * ============================================================
 * QUÉ CAMBIA EN `06 GW Preparar Jobs Worker`
 * ============================================================
 *
 * 1. Las acciones IDÉNTICAS (mismo tipo y mismos datos ya canonicalizados) se
 *    dejan una sola vez.
 * 2. La primera de cada tipo conserva el `request_id` del mensaje; de la
 *    segunda en adelante se deriva uno determinístico con `requestIdDeAccion`,
 *    el MISMO cálculo que `lib/gateway/jobs.ts` (un test lo verifica).
 *
 * El Worker no cambia: usa el `request_id` que le llega en el job para todo lo
 * que sigue (autorizar, ejecutar, cerrar), así que queda consistente solo.
 */

const HELPER = [
  "/* =========================================================",
  "   ACCIONES REPETIDAS (24/09/2026)",
  "",
  "   El gate identifica la orden por (usuario, request_id, accion): dos",
  "   acciones del mismo tipo en un mensaje chocaban con 409",
  "   EOS_COMMAND_PAYLOAD_MISMATCH. La primera de cada tipo conserva el",
  "   request_id; las siguientes usan uno derivado y deterministico. Mismo",
  "   calculo que lib/gateway/jobs.ts.",
  "========================================================= */",
  "",
  "function requestIdDeAccion(requestId, ordinal) {",
  "  if (!ordinal) return requestId;",
  "  const id = String(requestId).toLowerCase();",
  "  const nodo = parseInt(id.slice(-12), 16);",
  "  const derivado = (nodo + ordinal * 0x9e3779b1) % 0x1000000000000;",
  "  return id.slice(0, -12) + derivado.toString(16).padStart(12, '0');",
  "}",
  "",
  "function claveDeAccion(tipo, datos) {",
  "  const ordenar = (v) => {",
  "    if (Array.isArray(v)) return v.map(ordenar);",
  "    if (!v || typeof v !== 'object') return v;",
  "    return Object.keys(v).sort().reduce((acc, k) => { acc[k] = ordenar(v[k]); return acc; }, {});",
  "  };",
  "  return tipo + '|' + JSON.stringify(ordenar(datos));",
  "}",
  "",
  "const _vistas = new Set();",
  "const accionesUnicas = acciones.filter((accion) => {",
  "  const tipo = String(accion?.tipo || 'RESPONDER').trim().toUpperCase();",
  "  const clave = claveDeAccion(tipo, normalizarDatos(tipo, accion?.datos));",
  "  if (_vistas.has(clave)) return false;",
  "  _vistas.add(clave);",
  "  return true;",
  "});",
  "",
  "const _porTipo = new Map();",
  "",
  "/* =========================================================",
  "   CREAR JOBS PARA EL WORKER",
  "========================================================= */",
  "",
  "return accionesUnicas.map((accion, index) => {",
].join("\n");

export const CAMBIOS = [
  {
    donde: "el helper y la deduplicación antes de armar los jobs",
    viejo: [
      "/* =========================================================",
      "   CREAR JOBS PARA EL WORKER",
      "========================================================= */",
      "",
      "return acciones.map((accion, index) => {",
    ].join("\n"),
    nuevo: HELPER,
  },
  {
    donde: "el ordinal por tipo",
    viejo: [
      "  const worker_path =",
      "    paths[tipo];",
    ].join("\n"),
    nuevo: [
      "  const worker_path =",
      "    paths[tipo];",
      "",
      "  const ordinal = _porTipo.get(tipo) || 0;",
      "  _porTipo.set(tipo, ordinal + 1);",
    ].join("\n"),
  },
  {
    donde: "el request_id derivado",
    viejo: [
      "      request_id:",
      "        i.request_id,",
    ].join("\n"),
    nuevo: [
      "      request_id:",
      "        requestIdDeAccion(i.request_id, ordinal),",
    ].join("\n"),
  },
  {
    donde: "la cantidad de acciones",
    viejo: [
      "      action_count:",
      "        acciones.length,",
    ].join("\n"),
    nuevo: [
      "      action_count:",
      "        accionesUnicas.length,",
    ].join("\n"),
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
