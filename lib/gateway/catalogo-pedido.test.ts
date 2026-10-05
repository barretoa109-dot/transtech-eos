import assert from "node:assert/strict";
import test from "node:test";

import { mensajeConCitaDeWhatsapp } from "../whatsapp/cita.ts";
import { avisoDeCatalogoSinPedido, loQueEscribio, pideCambiarProducto, ultimaPreguntaDeEos } from "./catalogo-pedido.ts";
import type { Job } from "./jobs.ts";
import type { ResultadoWorker } from "./resultados.ts";
import { ejecutarJobs, type Anotada } from "./worker.ts";

const SIN_ANOTADAS = { anotadas: async (): Promise<Anotada[]> => [] };

const PREGUNTA_CHALECO = "Me falta el monto de venta del chaleco de encaje. ¿A cuánto lo cobraste?";
const GORRA_29_09 =
  "[de hace 3 días] Corrijo la venta de Sheyla: la Paleta Makeup by Mario queda con costo ₲382.662, sin el envío. " +
  "El envío de ₲41.241 corresponde a la Gorra lacoste sobrepedido; decime el costo base de la gorra y te calculo el costo final para cargarlo.";

function job(tipo: string, datos: Record<string, unknown>, mensaje: string, historial: unknown[]): Job {
  return {
    request_id: "11111111-1111-4111-8111-111111111111",
    usuario_id: "22222222-2222-4222-8222-222222222222",
    accion: { tipo, datos },
    mensaje,
    historial,
    worker_path: "eos-worker-rc1-internal",
  } as unknown as Job;
}

function workerQueAnota() {
  const llamadas: Job[] = [];
  const ejecutar = async (j: Job): Promise<ResultadoWorker> => {
    llamadas.push(j);
    return { ok: true, executed: true, accion: j.accion.tipo, estado: "completada", respuesta: "La acción quedó completada." };
  };
  return { ejecutar, llamadas };
}

test("el caso del 01/10: '155.000gs' contestando '¿a cuánto lo cobraste?' NO cambia el catálogo", async () => {
  const { ejecutar, llamadas } = workerQueAnota();
  const historial = [{ rol: "eos", texto: PREGUNTA_CHALECO }];
  const resultados = await ejecutarJobs(
    [job("ACTUALIZAR_PRODUCTO", { productos: [{ nombre: "Gorra lacoste sobrepedido", costo: 196241 }] }, "155.000gs", historial)],
    null,
    ejecutar,
    SIN_ANOTADAS,
  );
  assert.equal(llamadas.length, 0, "se mandó el cambio de catálogo igual");
  assert.equal(resultados[0].ok, false);
  assert.equal(resultados[0].codigo, "EOS_ACCION_CATALOGO_SIN_PEDIDO");
  assert.match(String(resultados[0].respuesta), /No cambié nada del catálogo de "Gorra lacoste sobrepedido"/);
});

test("el mismo caso con el historial roto: la pregunta de la gorra era de hace 3 días y no cuenta", () => {
  const mensaje = mensajeConCitaDeWhatsapp("155.000gs", "no-encontrado");
  assert.equal(ultimaPreguntaDeEos([{ rol: "eos", texto: GORRA_29_09 }]), "");
  assert.equal(pideCambiarProducto(mensaje, [{ rol: "eos", texto: GORRA_29_09 }]), false);
});

test("con la venta en el mismo pedido, la venta va y el cambio de catálogo no", async () => {
  const { ejecutar, llamadas } = workerQueAnota();
  const mensaje = "Vendi a 160.000gs \nEra un sobrepedido de gladys velilla";
  const resultados = await ejecutarJobs(
    [
      job("REGISTRAR_VENTA", { items: [{ producto: "Zapatos marrón mocha", cantidad: 1, precio_unitario: 160000 }] }, mensaje, []),
      job("ACTUALIZAR_PRODUCTO", { productos: [{ nombre: "Zapatos marrón mocha", precio_venta: 160000 }] }, mensaje, []),
    ],
    null,
    ejecutar,
    SIN_ANOTADAS,
  );
  assert.deepEqual(llamadas.map((j) => j.accion.tipo), ["REGISTRAR_VENTA"]);
  assert.equal(resultados.length, 2);
  assert.equal(resultados[1].codigo, "EOS_ACCION_CATALOGO_SIN_PEDIDO");
});

test("'No es la gorra, es el chaleco' corrige a EOS: el mensaje corregido no autoriza tocar el catálogo", () => {
  const equivocado =
    "Para la Gorra lacoste sobrepedido, ₲155.000 de costo base más ₲41.241 de envío dan un costo final de ₲196.241. Voy a actualizar ese costo en el catálogo.";
  const historial = [{ rol: "eos", texto: equivocado }];
  assert.equal(pideCambiarProducto("No es la gorra, es el chaleco de encaje", historial), false);
  assert.equal(pideCambiarProducto("no, era el otro", historial), false);
  assert.equal(pideCambiarProducto("te equivocaste de producto", historial), false);
  // Si en la corrección pide el cambio, va.
  assert.equal(pideCambiarProducto("No, el costo del chaleco es 119.471", historial), true);
  assert.equal(pideCambiarProducto("No, de la gorra lacoste es el envio que te mostre", historial), true);
});

test("citar el costo para pedir la venta no es pedir que se cambie el costo", () => {
  const mensaje = mensajeConCitaDeWhatsapp("Registra la venta de esto", {
    rol: "eos",
    texto: "Costo final del zapato marrón mocha: ₲125.245,4. Sale de ₲89.742 de costo base + ₲35.503,4 de envío.",
  });
  assert.equal(loQueEscribio(mensaje), "Registra la venta de esto");
  assert.equal(pideCambiarProducto(mensaje, []), false);
});

/**
 * Los ACTUALIZAR_PRODUCTO reales al 05/10/2026 que SÍ eran pedidos (19 de 20),
 * con el mensaje de EOS anterior cuando importa. Ninguno se puede frenar.
 */
const PEDIDOS_REALES: Array<[string, string]> = [
  ["Todo lo que vendo es exenta, te pido que quites el iva de todos y marques como exenta", ""],
  ["Set cosmina azul marino \nAgregale al costo el envio por kg \n45.805gs \nLo vendi ayer a 165.000gs", ""],
  ["Sumale el Envio 41.241gs", "Voy a agendar a Sheyla como clienta."],
  ["89.742gs costo del zapato marron mocha", ""],
  ["Porque decis que no tenes el costo, si es que vos mismo me escribiste el costo ahi en el mensaje", ""],
  ["Ahi te puse el costo \nEs 207.052gs", ""],
  ["384.657gs", "Costo ₲83.276 y venta ₲138.000: ganancia ₲54.724."],
  ["El costo de la bolsa de balanceado subió a 72.000", ""],
  ["101.200", "En mi vista actual me aparece el Cjto Celeste jeans con precio de venta ₲140.000, pero no me aparece el costo exacto."],
  ["Costo de jeans celeste 74.087", ""],
  ["Conjunto marrón 143.281", "Costo a actualizar para conjunto cosmina: ₲115.443,5."],
  ["El pan de leche me cuesta 2.800", ""],
  ["Subime el pan de leche a 7.000 y el chipa a 6.500", ""],
  ["El chipa me cuesta 2.500 y el pan casero 3.200 con el envío incluido. Guardame esos costos.", ""],
  ["el azul lo vendo a 168.000", ""],
  ["180.000", "¿A cuánto lo vendés?"],
  ["102.974", "¿Cuánto te costó el chaleco antes del envío?"],
];

for (const [mensaje, previa] of PEDIDOS_REALES) {
  test(`pedido real: "${mensaje.slice(0, 40).replace(/\n/g, " ")}" sí cambia el catálogo`, () => {
    assert.equal(pideCambiarProducto(mensaje, previa ? [{ rol: "eos", texto: previa }] : []), true);
  });
}

test("la última pregunta de EOS es la última de EOS, no la de la persona", () => {
  const historial = [
    { rol: "eos", texto: "¿Cuánto te costó?" },
    { rol: "usuario", texto: "no sé" },
    { rol: "eos", texto: PREGUNTA_CHALECO },
  ];
  assert.equal(ultimaPreguntaDeEos(historial), PREGUNTA_CHALECO);
});

test("el aviso nombra el producto y dice cómo pedirlo", () => {
  assert.match(avisoDeCatalogoSinPedido(["Gorra lacoste sobrepedido"]), /de "Gorra lacoste sobrepedido"[\s\S]*decímelo/);
  assert.match(avisoDeCatalogoSinPedido([]), /^No cambié nada del catálogo: /);
});
