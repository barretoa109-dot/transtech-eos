/**
 * Comprensión con lenguaje real (01/10/2026): cómo escribe la gente de verdad.
 *
 * Mensajes cortos, coloquiales, con errores, incompletos, con varios temas y
 * varios montos, seguimientos, referencias ("esa cuota", "el otro") y
 * correcciones. Cada caso dice qué tiene que HACER EOS (verbos) y, cuando la
 * calidad de la respuesta importa, qué tiene que decir o no decir.
 *
 * El criterio es el de un buen asistente (ChatGPT, Claude): entender lo que se
 * quiso decir, actuar cuando está claro, y preguntar UNA cosa concreta cuando
 * falta un dato esencial, sin inventarlo. "No inventar" no alcanza: también
 * tiene que entender y actuar.
 */
import { textoContexto, type ContextoNegocio } from "../../lib/eos/contexto-negocio.ts";
import { CONTEXTO_GREEN, CONTEXTO_NEGOCIO, type Turno } from "../bateria/frases.ts";
import type { CasoQA } from "./casos.ts";

type Natural = {
  id: string;
  grupo: string;
  mensaje: string;
  historial?: Turno[];
  contexto?: string;
  /** Combinaciones de verbos aceptadas. `[[]]` = ninguna acción. */
  esperado: string[][];
  prohibido?: string[];
  /** Tiene que aparecer en la respuesta (regex, sin mayúsculas). */
  debeDecir?: string[];
  /** No puede aparecer en la respuesta (regex, sin mayúsculas). */
  noDebeDecir?: string[];
  critico?: boolean;
  porque: string;
};

const NADA = [[]];
const V = [["REGISTRAR_VENTA"]];

const TRAS_VENTA: Turno[] = [
  { rol: "usuario", texto: "vendí 3 bolsas de balanceado a 180 mil a Juan" },
  { rol: "eos", texto: "Listo: registré la venta de 3 Balanceado a Juan Pérez por ₲ 540.000. La ves en Negocio > Ventas." },
];
const TRAS_COMPRA: Turno[] = [
  { rol: "usuario", texto: "compré 20 bolsas de balanceado a 140 mil a Agro Sur" },
  { rol: "eos", texto: "Registré la compra de 20 Balanceado a Agro Sur por ₲ 2.800.000." },
];

const PERSONAL = textoContexto({
  personal: [{ ingresos_mes: 3000000, gastos_mes: 1200000, neto_mes: 1800000, moneda: "PYG" }],
  posicion: {
    deudas: [
      { acreedor: "Préstamo del celular", saldo: 2400000, cuota: 400000, dia: 5, moneda: "PYG" },
      { acreedor: "Préstamo de la moto", saldo: 6000000, cuota: 650000, dia: 10, moneda: "PYG" },
    ],
  },
} as ContextoNegocio);

const DOS_TARJETAS = JSON.stringify({
  posicion: {
    tarjetas: [
      { moneda: "PYG", nombre: "Visa Itaú", minimo: 250000, cierra: 20 },
      { moneda: "PYG", nombre: "Green ****7450", minimo: 188000, cierra: 15 },
    ],
  },
});

const CALZADOS = [
  "Negocio: venta de calzados en Capiatá.",
  "Productos: Zapato Bristol negro (₲ 250.000, costo ₲ 160.000, stock 12), Sandalia Tupí (₲ 120.000, costo ₲ 70.000, stock 20), Zapatilla urbana (₲ 210.000, sin costo, stock 9).",
  "Clientes: Doña Elsa, Marcos Giménez.",
].join("\n");

const REGISTRADO = "registr[eéó]|anot[eéó]|qued[oó] (anotad|registrad|guardad)|cargu[eé]";

const NATURALES: Natural[] = [
  // Contar, pedir consejo o pedir que registre
  { id: "nat-solo-cuenta", grupo: "intencion", mensaje: "hoy fue un día re flojo, casi no vendí nada", esperado: NADA, noDebeDecir: [REGISTRADO], porque: "Cuenta cómo le fue; no hay nada que registrar." },
  { id: "nat-consejo-precio", grupo: "intencion", mensaje: "che te parece que le suba el precio al balanceado?", esperado: NADA, prohibido: ["ACTUALIZAR_PRODUCTO"], debeDecir: ["140\\.000|margen|40\\.000"], porque: "Pide opinión: razonar con el costo y el margen, sin cambiar el precio." },
  { id: "nat-hipotetico", grupo: "intencion", mensaje: "si mañana vendo 10 bolsas de balanceado cuánto me queda de ganancia?", esperado: NADA, debeDecir: ["400\\.000"], noDebeDecir: [REGISTRADO], porque: "Hipotético: (180.000 − 140.000) × 10 = 400.000, sin registrar nada." },
  { id: "nat-pensando-comprar", grupo: "intencion", mensaje: "estoy pensando en traer unas 20 bolsas más de agro sur", esperado: [[], ["CREAR_TAREA"]], prohibido: ["REGISTRAR_COMPRA"], porque: "Todavía no compró." },
  { id: "nat-venta-nomas", grupo: "intencion", mensaje: "salieron 2 balanceados nomás hoy", esperado: V, porque: "Venta dicha al pasar, pero es una venta." },

  // Errores de tipeo y abreviaturas
  { id: "nat-typo-venta", grupo: "tipeo", mensaje: "bendi 3 arinas a 60 c/u a la ña rosa", esperado: V, porque: "Faltas de ortografía: entender 'vendí 3 harinas a 60.000'." },
  { id: "nat-typo-compra", grupo: "tipeo", mensaje: "compre 10 bols de balanseado a 140 al agro sur", esperado: [["REGISTRAR_COMPRA"]], porque: "Compra con errores." },
  { id: "nat-sin-tildes-cobro", grupo: "tipeo", mensaje: "juan me paso 300 de lo q me debia", esperado: [["REGISTRAR_COBRO"]], porque: "'Me pasó 300' de lo que debe: un cobro de 300.000." },

  // Varios temas, varios montos
  { id: "nat-venta-y-cobro", grupo: "varios", mensaje: "le vendí 3 balanceados a 180 a juan y de paso me pagó 200 mil de lo que me debía", esperado: [["REGISTRAR_VENTA", "REGISTRAR_COBRO"]], critico: true, porque: "Dos operaciones distintas, cada una con su monto." },
  { id: "nat-tres-cosas", grupo: "varios", mensaje: "hoy compré 5 harinas a 45 a agro sur, pagué 320 de luz del local y vendí 2 remeras a 85", esperado: [["REGISTRAR_COMPRA", "REGISTRAR_VENTA"], ["REGISTRAR_COMPRA", "REGISTRAR_GASTO_FIJO", "REGISTRAR_VENTA"]], critico: true, porque: "Tres operaciones; la luz es un gasto del negocio (compra sin catálogo o fijo)." },
  { id: "nat-venta-y-recordatorio", grupo: "varios", mensaje: "anotá la venta de 3 harinas a rossana y recordame cobrarle el viernes", esperado: [["REGISTRAR_VENTA", "CREAR_TAREA"]], porque: "Venta + tarea con fecha." },
  { id: "nat-producto-y-venta", grupo: "varios", mensaje: "cargá alfajor a 5 mil, me cuesta 3 mil, y vendí 10 a ña rosa", esperado: [["CREAR_PRODUCTO", "REGISTRAR_VENTA"]], porque: "Producto nuevo y su primera venta." },

  // Seguimientos y referencias
  { id: "nat-otras-iguales", grupo: "referencia", mensaje: "y otras 2 iguales a rossana", historial: TRAS_VENTA, esperado: V, prohibido: ["CORREGIR_VENTA"], porque: "'Iguales' = mismo producto y precio que la venta anterior." },
  { id: "nat-esa-cuota", grupo: "referencia", contexto: PERSONAL, historial: [
    { rol: "usuario", texto: "cuánto es la cuota del préstamo del celular?" },
    { rol: "eos", texto: "La cuota del préstamo del celular es ₲ 400.000 y vence el 5." },
  ], mensaje: "esa cuota ya la pagué hoy", esperado: [["REGISTRAR_PAGO_DEUDA"]], critico: true, porque: "'Esa cuota' es la del celular de la que se acaba de hablar." },
  { id: "nat-el-otro", grupo: "referencia", contexto: PERSONAL, historial: [
    { rol: "usuario", texto: "pagué la cuota del préstamo del celular, 400 mil" },
    { rol: "eos", texto: "Anoté el pago de ₲ 400.000 al Préstamo del celular." },
  ], mensaje: "y el otro préstamo también", esperado: [["REGISTRAR_PAGO_DEUDA"]], critico: true, noDebeDecir: ["celular.{0,40}(otra vez|de nuevo)"], porque: "'El otro préstamo' es el de la moto, con su cuota de 650.000." },
  { id: "nat-lo-que-te-dije", grupo: "referencia", contexto: `${PERSONAL}\n\nLo que te contó y quedó guardado:\n- Prioridad: los préstamos del celular y de la moto van primero.`, mensaje: "acordate lo que te dije de los préstamos, armame el mes con eso", esperado: [[], ["GUARDAR_MEMORIA"]], debeDecir: ["pr[eé]stamo|cuota"], noDebeDecir: ["qu[eé] me dijiste|no recuerdo|no tengo (esa|ese) (info|dato)|cu[aá]l es tu prioridad"], porque: "Usa la memoria guardada; no vuelve a preguntar." },

  // Correcciones
  { id: "nat-corrige-cliente", grupo: "correccion", mensaje: "pará, no era juan, era rossana", historial: TRAS_VENTA, esperado: [["ANULAR_VENTA", "REGISTRAR_VENTA"]], prohibido: ["CORREGIR_VENTA"], critico: true, porque: "Otro cliente es la venta entera: anular y volver a registrar (CORREGIR_VENTA cambia solo cantidad o precio); el ejecutor no registra la nueva si la anulación falla (#193)." },
  { id: "nat-corrige-compra", grupo: "correccion", mensaje: "uy no, eran 2 bolsas no 20", historial: TRAS_COMPRA, esperado: [["CORREGIR_COMPRA"]], prohibido: ["REGISTRAR_COMPRA"], critico: true, porque: "Corrección de cantidad de una compra." },
  { id: "nat-corrige-y-agrega", grupo: "correccion", mensaje: "no, eran 5 bolsas, y aparte vendí 1 harina", historial: TRAS_VENTA, esperado: [["CORREGIR_VENTA", "REGISTRAR_VENTA"]], prohibido: ["ANULAR_VENTA"], porque: "Corrige la anterior y agrega otra." },

  // Ambiguo o dudoso: preguntar UNA cosa concreta, no inventar
  { id: "nat-audio-zapatos", grupo: "ambiguo", contexto: CALZADOS, mensaje: "[Audio]: este vendí tres pares de los bristo y dos de los tupi a la de siempre ya te paso después", esperado: NADA, critico: true, debeDecir: ["\\?"], noDebeDecir: [REGISTRADO], porque: "Transcripción dudosa: confirmar productos y clienta antes de registrar, sin adivinar." },
  { id: "nat-sin-producto", grupo: "ambiguo", mensaje: "vendí a 180", esperado: NADA, debeDecir: ["\\?"], porque: "No dice qué ni cuántos." },
  { id: "nat-venta-o-compra", grupo: "ambiguo", mensaje: "anotá 3 bolsas de balanceado", esperado: NADA, debeDecir: ["vend|compr"], porque: "¿Vendió o compró? Una sola pregunta." },
  { id: "nat-me-pagaron", grupo: "ambiguo", mensaje: "me pagaron", esperado: NADA, debeDecir: ["\\?"], noDebeDecir: [REGISTRADO], porque: "Quién y cuánto." },
  { id: "nat-tarjeta-cual", grupo: "ambiguo", contexto: DOS_TARJETAS, mensaje: "compré con la tarjeta 46 mil en la farmacia", esperado: NADA, debeDecir: ["visa|green|cu[aá]l"], porque: "Hay dos tarjetas: preguntar cuál, no elegir una." },
  { id: "nat-monto-raro", grupo: "ambiguo", mensaje: "vendí 2 balanceados a 18", esperado: [[], ["REGISTRAR_VENTA"]], noDebeDecir: ["₲ ?(18|36)(?![.\\d])"], porque: "'18' en guaraníes no tiene sentido: 18.000 o 180.000 (catálogo), y si duda pregunta; nunca ₲ 18." },

  // Finanzas
  { id: "nat-pago-decimales", grupo: "finanzas", contexto: CONTEXTO_GREEN, mensaje: "pagué 150.500,50 de la green", esperado: [["REGISTRAR_PAGO_DEUDA"]], porque: "Monto con decimales al estilo local." },
  { id: "nat-sueldo", grupo: "finanzas", contexto: PERSONAL, mensaje: "me depositaron el sueldo, 3.200.000", esperado: [["REGISTRAR_MOVIMIENTO_PERSONAL"]], porque: "Ingreso personal." },
  { id: "nat-captura-no-es-nueva", grupo: "finanzas", contexto: CONTEXTO_GREEN, mensaje: "[El usuario mandó una captura de la pantalla Tarjetas de EOS donde se ve Punto Farma ₲ 46.000 en la Green] fijate, ahí está duplicado?", esperado: NADA, prohibido: ["REGISTRAR_COMPRA_TARJETA"], porque: "Una captura de EOS no es una operación nueva." },

  // WhatsApp a clientes (INC-24)
  { id: "nat-wa-dictado", grupo: "whatsapp", mensaje: "mandale a Juan que ya llegó su pedido", esperado: [["ENVIAR_WHATSAPP_CLIENTE"]], critico: true, porque: "Dice a quién y qué: es un pedido de mandar, con el contenido dictado." },
  { id: "nat-wa-sin-texto", grupo: "whatsapp", mensaje: "escribile a rossana", esperado: NADA, debeDecir: ["\\?"], porque: "No dice qué: proponer el texto y preguntar." },
];

function evaluarNatural(n: Natural) {
  return (verbos: string[], texto: string) => {
    const conjunto = [...new Set(verbos.filter((v) => v !== "RESPONDER" && v !== "GUARDAR_MEMORIA"))].sort().join("+");
    const aceptados = n.esperado.map((e) => [...e].filter((v) => v !== "GUARDAR_MEMORIA").sort().join("+"));
    const fallas: string[] = [];
    if (!aceptados.includes(conjunto)) fallas.push(`esperaba ${aceptados.map((a) => a || "nada").join(" o ")}, vino ${conjunto || "nada"}`);
    for (const p of n.prohibido ?? []) if (verbos.includes(p)) fallas.push(`prohibido: ${p}`);
    for (const r of n.debeDecir ?? []) if (!new RegExp(r, "i").test(texto)) fallas.push(`no dice /${r}/`);
    for (const r of n.noDebeDecir ?? []) if (new RegExp(r, "i").test(texto)) fallas.push(`dice /${r}/`);
    return { ok: fallas.length === 0, motivo: fallas.join("; ") };
  };
}

export const CASOS_NATURALES: CasoQA[] = NATURALES.map((n) => ({
  id: n.id,
  critico: n.critico === true,
  mensaje: n.mensaje,
  historial: n.historial,
  contexto: n.contexto ?? CONTEXTO_NEGOCIO,
  evaluar: evaluarNatural(n),
}));
