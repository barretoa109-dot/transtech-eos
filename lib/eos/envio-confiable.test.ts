import assert from "node:assert/strict";
import test from "node:test";

import {
  ESPERA_TOTAL_MS,
  MAX_ENVIOS,
  enviarHastaQueLlegue,
  type ConsultaBuzon,
  type Dependencias,
  type RespuestaCruda,
} from "./envio-confiable.ts";

/**
 * Un servidor de mentira con reloj propio: `dormir` adelanta el reloj en vez
 * de esperar, así cinco minutos de reintentos corren en milisegundos.
 */
function escenario(p: {
  envios: Array<RespuestaCruda | "corte">;
  consultas?: Array<ConsultaBuzon | "corte" | null>;
  consultaPorDefecto?: ConsultaBuzon;
}) {
  let reloj = 0;
  let enviados = 0;
  let consultados = 0;

  const dep: Dependencias = {
    enviar: async () => {
      const r = p.envios[Math.min(enviados, p.envios.length - 1)];
      enviados += 1;
      if (r === "corte") throw new TypeError("Load failed");
      return r;
    },
    consultar: async () => {
      const c =
        p.consultas && consultados < p.consultas.length
          ? p.consultas[consultados]
          : (p.consultaPorDefecto ?? { listo: false, recibido: false });
      consultados += 1;
      if (c === "corte") throw new TypeError("Load failed");
      return c;
    },
    dormir: async (ms) => {
      reloj += ms;
    },
    ahora: () => reloj,
  };

  return { dep, enviados: () => enviados, reloj: () => reloj };
}

const OK: RespuestaCruda = { estado: 200, texto: JSON.stringify({ respuesta: "Registrado." }) };

test("sin cortes, se manda una vez y se devuelve lo que contestó", async () => {
  const e = escenario({ envios: [OK] });
  const llegada = await enviarHastaQueLlegue(e.dep);

  assert.deepEqual(llegada, { origen: "directo", estado: 200, texto: OK.texto });
  assert.equal(e.enviados(), 1);
});

test("el caso del 27/09: el pedido no llegó, se reenvía solo y la respuesta aparece", async () => {
  const e = escenario({ envios: ["corte", OK] });
  const llegada = await enviarHastaQueLlegue(e.dep);

  assert.equal(llegada?.origen, "directo");
  assert.equal(e.enviados(), 2);
});

test("si el servidor SÍ lo recibió, no se reenvía: se espera el buzón", async () => {
  const e = escenario({
    envios: ["corte"],
    consultas: [
      { listo: false, recibido: true },
      { listo: false, recibido: true },
      { listo: false, recibido: true },
      { listo: false, recibido: true },
      { listo: true, recibido: true, estado_http: 200, cuerpo: { respuesta: "Registrado." } },
    ],
  });
  const llegada = await enviarHastaQueLlegue(e.dep);

  assert.deepEqual(llegada, { origen: "buzon", estado: 200, cuerpo: { respuesta: "Registrado." } });
  assert.equal(e.enviados(), 1, "reenviar algo en curso podía cargar dos veces una venta");
});

test("una consulta sin red no cuenta como 'no lo recibió'", async () => {
  const e = escenario({
    envios: ["corte", OK],
    consultas: ["corte", "corte", "corte", "corte", { listo: false, recibido: false }],
  });
  await enviarHastaQueLlegue(e.dep);

  // Cuatro consultas sin red + una que dice "no" no alcanzan para reenviar;
  // hacen falta tres "no" de verdad.
  assert.equal(e.enviados(), 2);
});

test("un reenvío que el servidor ya tiene en curso (202) pasa a esperar el buzón", async () => {
  const e = escenario({
    envios: ["corte", { estado: 202, texto: JSON.stringify({ en_proceso: true }) }],
    consultas: [
      { listo: false, recibido: false },
      { listo: false, recibido: false },
      { listo: false, recibido: false },
      { listo: true, recibido: true, estado_http: 200, cuerpo: { respuesta: "Listo." } },
    ],
  });
  const llegada = await enviarHastaQueLlegue(e.dep);

  assert.equal(llegada?.origen, "buzon");
  assert.equal(e.enviados(), 2);
});

test("una página de error de la plataforma (502 en HTML) se trata como corte", async () => {
  const e = escenario({ envios: [{ estado: 502, texto: "<html>Bad Gateway</html>" }, OK] });
  const llegada = await enviarHastaQueLlegue(e.dep);

  assert.equal(llegada?.origen, "directo");
  assert.equal(llegada?.estado, 200);
});

test("un error que escribió EOS (JSON) se devuelve tal cual, sin reintentar", async () => {
  const limite = { estado: 429, texto: JSON.stringify({ respuesta: "Esperá un minuto." }) };
  const e = escenario({ envios: [limite] });
  const llegada = await enviarHastaQueLlegue(e.dep);

  assert.deepEqual(llegada, { origen: "directo", ...limite });
  assert.equal(e.enviados(), 1);
});

test("sin red nunca, se rinde con un tope de envíos y de tiempo", async () => {
  const e = escenario({ envios: ["corte"] });
  const llegada = await enviarHastaQueLlegue(e.dep);

  assert.equal(llegada, null);
  assert.ok(e.enviados() <= MAX_ENVIOS);
  assert.ok(e.reloj() <= ESPERA_TOTAL_MS + 10_000);
});

test("con la sesión vencida no se queda esperando", async () => {
  const e = escenario({ envios: ["corte"], consultas: [null] });
  assert.equal(await enviarHastaQueLlegue(e.dep), null);
  assert.equal(e.enviados(), 1);
});
