import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_INTENTOS,
  TEXTO_EN_ESPERA,
  esCaidaDeIA,
  ponerEnEspera,
  puedeEsperar,
  reintentarEnEspera,
  textoDeEntrega,
  textoDeVencido,
  type Dependencias,
  type FilaEnEspera,
} from "./en-espera.ts";

/*
 * Una base en memoria que entiende solo las cadenas que usa en-espera.ts.
 * Alcanza para probar el recorrido: tomar, reintentar, entregar, cerrar.
 */
type Fila = FilaEnEspera & { proximo_intento_at: string; motivo?: string; procesado_at?: string };

function baseFalsa(filas: Fila[], mensajes: { conversacion_id: string; usuario_id: string; rol: string; texto: string; created_at: string }[] = []) {
  const coincide = (f: Record<string, unknown>, filtros: [string, unknown][]) => filtros.every(([c, v]) => f[c] === v);

  const admin = {
    from(tabla: string) {
      if (tabla === "mensajes") {
        const filtros: [string, unknown][] = [];
        let antesDe = "";
        const q = {
          select: () => q,
          eq: (c: string, v: unknown) => (filtros.push([c, v]), q),
          lt: (_c: string, v: string) => ((antesDe = v), q),
          order: () => q,
          limit: async (n: number) => ({
            data: mensajes
              .filter((m) => coincide(m, filtros) && m.created_at < antesDe)
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .slice(0, n),
            error: null,
          }),
        };
        return q;
      }

      return {
        insert: (fila: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const nueva = { id: `f${filas.length + 1}`, estado: "esperando", intentos: 0, ...fila } as unknown as Fila;
              filas.push(nueva);
              return { data: { id: nueva.id }, error: null };
            },
          }),
        }),
        select: () => {
          let estados: string[] = [];
          let hasta = "";
          const q = {
            in: (_c: string, v: string[]) => ((estados = v), q),
            lte: (_c: string, v: string) => ((hasta = v), q),
            order: () => q,
            limit: async (n: number) => ({
              data: filas.filter((f) => estados.includes(f.estado) && f.proximo_intento_at <= hasta).slice(0, n),
              error: null,
            }),
          };
          return q;
        },
        update: (valores: Record<string, unknown>) => {
          const filtros: [string, unknown][] = [];
          const aplicar = () => {
            const tocadas = filas.filter((f) => coincide(f as unknown as Record<string, unknown>, filtros));
            for (const f of tocadas) Object.assign(f, valores);
            return tocadas;
          };
          const q = {
            eq: (c: string, v: unknown) => (filtros.push([c, v]), q),
            select: async () => ({ data: aplicar().map((f) => ({ id: f.id })), error: null }),
            then: (ok: (r: { error: null }) => unknown) => (aplicar(), Promise.resolve({ error: null }).then(ok)),
          };
          return q;
        },
      };
    },
  };
  return admin as never;
}

const AHORA = new Date("2026-10-01T15:00:00Z");

function fila(extra: Partial<Fila> = {}): Fila {
  return {
    id: "f1",
    usuario_id: "u1",
    conversacion_id: "c1",
    origen: "whatsapp",
    mensaje: "vendí 3 bolsas de balanceado a 180 mil",
    app_nativa: false,
    estado: "esperando",
    intentos: 0,
    created_at: "2026-10-01T14:32:00Z",
    proximo_intento_at: "2026-10-01T14:33:00Z",
    ...extra,
  };
}

function deps(respuestas: Array<{ status: number; body: Record<string, unknown> }>) {
  const entregados: string[] = [];
  const pedidos: Array<Record<string, unknown>> = [];
  const d: Dependencias = {
    procesar: async (_u, entrada) => {
      pedidos.push(entrada);
      return respuestas.shift() ?? { status: 503, body: {} };
    },
    entregar: async (_f, texto) => {
      entregados.push(texto);
      return true;
    },
    idDelIntento: (semilla) => `id:${semilla}`,
    ahora: () => AHORA,
  };
  return { d, entregados, pedidos };
}

test("solo se espera una caída de verdad: timeout, red, 429 o 5xx", () => {
  assert.equal(esCaidaDeIA({ motivo: "timeout" }), true);
  assert.equal(esCaidaDeIA({ motivo: "red" }), true);
  assert.equal(esCaidaDeIA({ motivo: "http", status: 429 }), true);
  assert.equal(esCaidaDeIA({ motivo: "http", status: 503 }), true);
  assert.equal(esCaidaDeIA({ motivo: "http", status: 401 }), false, "una clave mala no se arregla esperando");
  assert.equal(esCaidaDeIA({ motivo: "http", status: 400 }), false);
});

test("solo texto, y un reintento no vuelve a quedar en espera", () => {
  assert.equal(puedeEsperar({ mensaje: "vendí 3", archivos: [] }), true);
  assert.equal(puedeEsperar({ mensaje: "  ", archivos: [] }), false);
  assert.equal(puedeEsperar({ mensaje: "mirá", archivos: [{}] }), false);
  assert.equal(puedeEsperar({ mensaje: "vendí 3", archivos: [], reintentoDe: "f1" }), false);
});

test("el aviso de espera no promete lo que no sabe", () => {
  assert.match(TEXTO_EN_ESPERA, /No se perdió/);
  assert.doesNotMatch(TEXTO_EN_ESPERA, /anotado|registrado|quedó/i);
});

test("ponerEnEspera guarda el mensaje y dice si pudo", async () => {
  const filas: Fila[] = [];
  const ok = await ponerEnEspera(baseFalsa(filas), {
    usuarioId: "u1",
    conversacionId: "",
    origen: "eos-web",
    mensaje: "x".repeat(5000),
    appNativa: false,
    motivo: "ia_timeout",
  });
  assert.equal(ok, true);
  assert.equal(filas[0].mensaje.length, 4000);
  assert.equal(filas[0].conversacion_id, null);
});

test("cuando vuelve la IA, se procesa con el historial de ANTES y se entrega", async () => {
  const filas = [fila()];
  const mensajes = [
    { conversacion_id: "c1", usuario_id: "u1", rol: "usuario", texto: "hola", created_at: "2026-10-01T14:00:00" },
    { conversacion_id: "c1", usuario_id: "u1", rol: "eos", texto: "Hola, ¿qué anotamos?", created_at: "2026-10-01T14:00:05" },
    // Guardados después de que el mensaje quedó en espera: no son contexto.
    { conversacion_id: "c1", usuario_id: "u1", rol: "usuario", texto: "vendí 3 bolsas", created_at: "2026-10-01T14:32:30" },
    { conversacion_id: "c1", usuario_id: "u1", rol: "eos", texto: TEXTO_EN_ESPERA, created_at: "2026-10-01T14:32:31" },
  ];
  const { d, entregados, pedidos } = deps([{ status: 200, body: { respuesta: "Anoté 3 bolsas a ₲180.000." } }]);

  const resumen = await reintentarEnEspera(baseFalsa(filas, mensajes), d);

  assert.deepEqual(resumen, { procesados: 1, siguen: 0, vencidos: 0 });
  assert.equal(filas[0].estado, "procesado");
  assert.equal(pedidos[0].reintentoDe, "f1");
  assert.equal(pedidos[0].requestId, "id:en-espera:f1:1");
  assert.deepEqual(
    (pedidos[0].historial as { texto: string }[]).map((m) => m.texto),
    ["hola", "Hola, ¿qué anotamos?"],
  );
  assert.equal(entregados.length, 1);
  assert.match(entregados[0], /^Ya pude procesar tu mensaje de las 11:32 \(«vendí 3 bolsas de balanceado a 180 mil»\):/);
  assert.match(entregados[0], /Anoté 3 bolsas/);
});

test("si la IA sigue caída, vuelve a esperar 5 minutos sin avisar nada", async () => {
  const filas = [fila()];
  const { d, entregados } = deps([{ status: 200, body: { respuesta: TEXTO_EN_ESPERA, code: "EOS_EN_ESPERA" } }]);
  const resumen = await reintentarEnEspera(baseFalsa(filas), d);
  assert.deepEqual(resumen, { procesados: 0, siguen: 1, vencidos: 0 });
  assert.equal(filas[0].estado, "esperando");
  assert.equal(filas[0].intentos, 1);
  assert.equal(filas[0].proximo_intento_at, "2026-10-01T15:05:00.000Z");
  assert.equal(entregados.length, 0);
});

test("al último intento le avisa que lo reenvíe: nada se pierde en silencio", async () => {
  const filas = [fila({ intentos: MAX_INTENTOS - 1 })];
  const { d, entregados } = deps([{ status: 503, body: {} }]);
  const resumen = await reintentarEnEspera(baseFalsa(filas), d);
  assert.deepEqual(resumen, { procesados: 0, siguen: 0, vencidos: 1 });
  assert.equal(filas[0].estado, "vencido");
  assert.equal(entregados[0], textoDeVencido(filas[0]));
  assert.match(entregados[0], /mandámelo de nuevo/);
});

test("un 409 es un intento que ya se procesó: se cierra sin mandar nada otra vez", async () => {
  const filas = [fila({ estado: "procesando", intentos: 2 })];
  const { d, entregados } = deps([{ status: 409, body: {} }]);
  const resumen = await reintentarEnEspera(baseFalsa(filas), d);
  assert.deepEqual(resumen, { procesados: 1, siguen: 0, vencidos: 0 });
  assert.equal(entregados.length, 0);
});

test("lo que todavía no toca no se toca", async () => {
  const filas = [fila({ proximo_intento_at: "2026-10-01T15:10:00Z" }), fila({ id: "f2", estado: "procesado" })];
  const { d, pedidos } = deps([]);
  const resumen = await reintentarEnEspera(baseFalsa(filas), d);
  assert.deepEqual(resumen, { procesados: 0, siguen: 0, vencidos: 0 });
  assert.equal(pedidos.length, 0);
});

test("el texto de entrega cita el mensaje corto", () => {
  const largo = fila({ mensaje: "a".repeat(100) });
  assert.match(textoDeEntrega(largo, "ok"), /«a{57}…»/);
});
