/**
 * Las fechas de las respuestas del worker, escritas como las diría una persona.
 *
 * ============================================================
 * EL DEFECTO
 * ============================================================
 *
 * Al anular una compra, EOS contestaba "Anulé la compra del 2026-09-18: …". Lo
 * mismo pasaba con "Anulé la venta del …", "Corregí … del 2026-09-10" y "Moví …
 * del 2026-09-10 al 2026-09-12": la fecha ISO tal cual salió de la base. Es un
 * dato correcto y una frase que nadie diría en voz alta.
 *
 * ============================================================
 * QUÉ CAMBIA
 * ============================================================
 *
 * Un helper `fechaLarga` ("18 de septiembre") y las cinco frases que imprimían la
 * fecha cruda lo usan. El año se agrega SOLO cuando no es el actual: "18 de
 * septiembre" el mismo año, "18 de septiembre de 2025" si no, que es cuando la
 * ambigüedad sí importa.
 *
 * Lo demás no se toca: `diaMes` ("18/09") sigue sirviendo a las frases de
 * cartera, que hablan de facturas de esta semana y donde el corto alcanza.
 *
 * Solo el worker: el prompt y el gateway no cambian.
 */

const HELPER = [
  "/*",
  "  La fecha como la diría una persona: \"18 de septiembre\". El año va solo si no es",
  "  el actual (hora de Paraguay, UTC-3). Sin una fecha ISO legible devuelve el",
  "  respaldo o el texto tal cual: nunca inventa un día.",
  "*/",
  "const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];",
  "",
  "function fechaLarga(iso, respaldo) {",
  "  const texto = typeof iso === 'string' ? iso : '';",
  "  const m = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);",
  "",
  "  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {",
  "    return respaldo !== undefined ? respaldo : String(iso || '');",
  "  }",
  "",
  "  const anioActual = new Date(Date.now() - 3 * 3600000).getUTCFullYear();",
  "  const anio = Number(m[1]);",
  "",
  "  return Number(m[3]) + ' de ' + MESES_LARGOS[Number(m[2]) - 1] + (anio !== anioActual ? ' de ' + anio : '');",
  "}",
  "",
  "function fraseDeCartera(result) {",
].join("\n");

export const CAMBIOS = [
  {
    donde: "el helper fechaLarga",
    viejo: "function fraseDeCartera(result) {",
    nuevo: HELPER,
  },
  {
    donde: "anular una venta",
    viejo: "'Anulé la venta del ' + (r.fecha || 'día')",
    nuevo: "'Anulé la venta del ' + fechaLarga(r.fecha, 'día')",
  },
  {
    donde: "anular una compra",
    viejo: "'Anulé la compra del ' + (r.fecha || 'día')",
    nuevo: "'Anulé la compra del ' + fechaLarga(r.fecha, 'día')",
  },
  {
    donde: "corregir un movimiento (monto)",
    viejo: "'Corregí ' + que + ' del ' + antes.fecha",
    nuevo: "'Corregí ' + que + ' del ' + fechaLarga(antes.fecha)",
  },
  {
    donde: "mover un movimiento de fecha",
    viejo: "'Moví ' + que + ' del ' + antes.fecha + ' al ' + despues.fecha",
    nuevo: "'Moví ' + que + ' del ' + fechaLarga(antes.fecha) + ' al ' + fechaLarga(despues.fecha)",
  },
  {
    donde: "corregir un movimiento (descripción)",
    viejo: "'Corregí el movimiento del ' + antes.fecha",
    nuevo: "'Corregí el movimiento del ' + fechaLarga(antes.fecha)",
  },
];

export function aplicar(codigo, etiqueta = "worker") {
  if (codigo.includes("function fechaLarga")) {
    throw new Error(`[${etiqueta}] ya tiene fechaLarga. No se escribió nada.`);
  }

  let salida = codigo;

  for (const c of CAMBIOS) {
    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(`[${etiqueta}] "${c.donde}": aparece ${partes.length - 1} veces, no 1. No se escribió nada.`);
    }
    salida = partes.join(c.nuevo);
  }

  return salida;
}
