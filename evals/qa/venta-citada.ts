/**
 * Los dos casos de Sofía del 01/10/2026 (WhatsApp), contra el modelo.
 *
 *     node --experimental-strip-types evals/qa/qa-con-tope.mts --conjunto citas --ruteo --tope 0.3
 *
 * Los mensajes llegan con la MISMA forma que les da el webhook: la cita con
 * `mensajeConCitaDeWhatsapp` y lo de otra sesión con `marcaDeAntiguedad`.
 * No ejecuta nada: mira qué acciones pide el modelo y qué dice.
 */
import { mensajeConCitaDeWhatsapp } from "../../lib/whatsapp/cita.ts";
import type { Turno } from "../bateria/frases.ts";
import type { CasoQA } from "./casos.ts";

const TIENDA = [
  "Negocio: tienda de ropa, calzado y maquillaje por encargo (sobrepedidos).",
  "Productos: Zapatos marrón mocha (₲ 160.000, costo ₲ 125.245,4, stock 1), chaleco de encaje negro M (₲ 155.000, costo ₲ 119.471, stock 1), chaleco de encaje negro S (₲ 155.000, costo ₲ 119.471, stock 1), Gorra lacoste sobrepedido (₲ 475.000, costo ₲ 384.657, stock 1), Paleta Makeup by Mario (₲ 465.000, costo ₲ 382.662, stock 0).",
  "Clientes: Gladys Velilla, Sheyla.",
].join("\n");

const ZAPATO = "Costo final del zapato marrón mocha: ₲125.245,4. Sale de ₲89.742 de costo base + ₲35.503,4 de envío.";

const GORRA_VIEJA: Turno = {
  rol: "eos",
  texto:
    "[de hace 3 días] Corrijo la venta de Sheyla: la Paleta Makeup by Mario queda con costo ₲382.662, sin el envío. El envío de ₲41.241 corresponde a la Gorra lacoste sobrepedido; decime el costo base de la gorra y te calculo el costo final para cargarlo.",
};

type Accion = { tipo: string; datos: Record<string, unknown> };

const plano = (v: unknown) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function ventas(acciones: Accion[] = []) {
  return acciones.filter((a) => String(a.tipo).toUpperCase() === "REGISTRAR_VENTA");
}

function items(a: Accion): Array<Record<string, unknown>> {
  return Array.isArray(a.datos?.items) ? (a.datos.items as Array<Record<string, unknown>>) : [];
}

function monto(v: unknown): number {
  if (typeof v === "number") return v;
  const t = String(v ?? "").replace(/[^\d.,]/g, "");
  return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/\./g, ""));
}

function resultado(fallas: string[]) {
  return { ok: fallas.length === 0, motivo: fallas.join("; ") };
}

/** Lo común: nunca tocar el catálogo, nunca la gorra, nunca "no tengo el mensaje". */
function sinDanos(verbos: string[], texto: string, acciones: Accion[] = []): string[] {
  const f: string[] = [];
  if (verbos.includes("ACTUALIZAR_PRODUCTO")) f.push("pidió ACTUALIZAR_PRODUCTO sin que se lo pidan");
  if (acciones.some((a) => plano(JSON.stringify(a.datos)).includes("gorra"))) f.push("metió la gorra en una acción");
  if (/no tengo el mensaje|no me lleg[oó]/i.test(texto)) f.push("dijo que no tiene el mensaje");
  if (/la acci[oó]n qued[oó] completada/i.test(texto)) f.push("anunció una acción completada");
  return f;
}

/** Una venta del producto pedido, con el precio dicho, o una pregunta de UN dato sobre ese producto. */
function ventaOPreguntaDe(
  producto: RegExp,
  precio: number | null,
  { clienta, nota, exigirVenta = false }: { clienta?: RegExp; nota?: RegExp; exigirVenta?: boolean } = {},
) {
  return (verbos: string[], texto: string, acciones: Accion[] = []) => {
    const f = sinDanos(verbos, texto, acciones);
    const vs = ventas(acciones);

    if (vs.length > 1) f.push(`${vs.length} ventas en vez de una`);

    if (vs.length === 1) {
      const it = items(vs[0]);
      if (it.length !== 1) f.push(`${it.length} ítems en la venta`);
      const i = it[0] ?? {};
      if (!producto.test(plano(i.producto))) f.push(`producto equivocado: ${String(i.producto)}`);
      if (precio !== null && monto(i.precio_unitario) !== precio) f.push(`precio ${String(i.precio_unitario)} en vez de ${precio}`);
      if (i.cantidad !== undefined && Number(i.cantidad) !== 1) f.push(`cantidad inventada: ${String(i.cantidad)}`);
      if (clienta && !clienta.test(plano(vs[0].datos.contacto))) f.push(`clienta: ${String(vs[0].datos.contacto)}`);
      if (nota && !nota.test(plano(vs[0].datos.nota))) f.push(`sin la nota (nota=${String(vs[0].datos.nota)})`);
    } else {
      if (exigirVenta) f.push("no registró la venta con todos los datos a la vista");
      // Si pregunta, que sea por el dato que falta y nombrando el producto, no "¿qué producto?".
      if (!/\?/.test(texto)) f.push("ni registró ni preguntó");
      if (/qu[eé] producto|cu[aá]l producto|qu[eé] vendiste\b/i.test(texto)) f.push("volvió a preguntar el producto");
      if (!producto.test(plano(texto))) f.push("la pregunta no dice de qué producto habla");
    }
    return resultado(f);
  };
}

export const CASOS_CITAS: CasoQA[] = [
  {
    id: "citas-registra-esto",
    critico: true,
    contexto: TIENDA,
    mensaje: mensajeConCitaDeWhatsapp("Registra la venta de esto", { rol: "eos", texto: ZAPATO }),
    evaluar: ventaOPreguntaDe(/zapato/, null),
  },
  {
    id: "citas-aclaracion-zapato",
    critico: true,
    contexto: TIENDA,
    historial: [
      { rol: "usuario", texto: mensajeConCitaDeWhatsapp("Registra la venta de esto", { rol: "eos", texto: ZAPATO }) },
      { rol: "eos", texto: "Es el zapato marrón mocha, con costo ₲125.245,4. ¿A cuánto lo vendiste y a quién?" },
    ],
    mensaje: "Vendi a 160.000gs \nEra un sobrepedido de gladys velilla",
    evaluar: ventaOPreguntaDe(/zapato/, 160000, { clienta: /gladys/, nota: /sobrepedido/, exigirVenta: true }),
  },
  {
    id: "citas-no-encontrada",
    critico: true,
    contexto: TIENDA,
    historial: [
      { rol: "usuario", texto: "89.742gs costo del zapato marron mocha" },
      { rol: "eos", texto: ZAPATO },
    ],
    mensaje: mensajeConCitaDeWhatsapp("Registra la venta de esto", "no-encontrado"),
    evaluar: ventaOPreguntaDe(/zapato/, null),
  },
  {
    id: "citas-chaleco-155",
    critico: true,
    contexto: TIENDA,
    historial: [
      GORRA_VIEJA,
      { rol: "usuario", texto: "Registrá la venta del chaleco de encaje negro M a Gladys Velilla" },
      { rol: "eos", texto: "Me falta el monto de venta del chaleco de encaje. ¿A cuánto lo cobraste?" },
    ],
    mensaje: "155.000gs",
    evaluar: ventaOPreguntaDe(/chaleco/, 155000, { clienta: /gladys/ }),
  },
  {
    id: "citas-correccion-chaleco",
    critico: true,
    contexto: TIENDA,
    historial: [
      { rol: "usuario", texto: "Registrá la venta del chaleco de encaje negro M a Gladys Velilla" },
      { rol: "eos", texto: "Me falta el monto de venta del chaleco de encaje. ¿A cuánto lo cobraste?" },
      { rol: "usuario", texto: "155.000gs" },
      {
        rol: "eos",
        texto:
          "Para la Gorra lacoste sobrepedido, ₲155.000 de costo base más ₲41.241 de envío dan un costo final de ₲196.241. Voy a actualizar ese costo en el catálogo.",
      },
    ],
    mensaje: "No es la gorra, es el chaleco de encaje",
    evaluar(verbos, texto, acciones) {
      const base = ventaOPreguntaDe(/chaleco/, 155000, { clienta: /gladys/ })(verbos, texto, acciones);
      const f = base.ok ? [] : [base.motivo];
      // El costo del chaleco está en el catálogo: no se vuelve a preguntar.
      if (/cu[aá]nto te cost[oó]|costo base del chaleco|antes del env[ií]o/i.test(texto)) f.push("preguntó un costo que ya está");
      return resultado(f);
    },
  },
  {
    id: "citas-instruccion-completa",
    critico: true,
    contexto: TIENDA,
    mensaje:
      "Voy a registrar el chaleco de encaje negro M para Gladys Velilla: 1 unidad a ₲155.000, con costo unitario ₲119.471. Ganancia estimada: ₲35.529; margen aprox. 22,9%.\n\nEsto es lo que quiero que registres",
    evaluar: ventaOPreguntaDe(/chaleco/, 155000, { clienta: /gladys/, exigirVenta: true }),
  },
  {
    id: "citas-en-dos-mensajes",
    critico: false,
    contexto: TIENDA,
    historial: [
      { rol: "usuario", texto: "vendí el chaleco de encaje negro S" },
      { rol: "eos", texto: "¿A cuánto lo vendiste y a quién?" },
    ],
    mensaje: "a sheyla, 150 mil",
    evaluar: ventaOPreguntaDe(/chaleco.*\bs\b/, 150000, { clienta: /sheyla/, exigirVenta: true }),
  },
];
