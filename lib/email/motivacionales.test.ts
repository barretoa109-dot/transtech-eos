import assert from "node:assert/strict";
import { test } from "node:test";

import { crearTokenBaja, tokenDeBajaValido } from "./baja.ts";
import {
  cicloDe,
  enviarMotivacionales,
  MENSAJES,
  mensajeDelCiclo,
  MOTIVO_BAJA,
  redactarMotivacional,
  urlDeBaja,
  type CorreoMotivacional,
} from "./motivacionales.ts";

test("a lo largo de un mes el ciclo avanza de a uno cada 3 días", () => {
  let previo = cicloDe("2026-09-01");
  let cambios = 0;

  for (let dia = 2; dia <= 30; dia += 1) {
    const ciclo = cicloDe(`2026-09-${String(dia).padStart(2, "0")}`);
    assert.ok(ciclo - previo === 0 || ciclo - previo === 1);
    if (ciclo !== previo) cambios += 1;
    previo = ciclo;
  }

  // 29 pasos de un día = 9 o 10 cruces de ciclo según dónde caiga el corte.
  assert.ok(cambios === 9 || cambios === 10);
});

test("tres días seguidos comparten ciclo y el cuarto arranca otro", () => {
  // 1970-01-01 es el día 0: los días 0, 1 y 2 son el ciclo 0.
  assert.equal(cicloDe("1970-01-01"), 0);
  assert.equal(cicloDe("1970-01-03"), 0);
  assert.equal(cicloDe("1970-01-04"), 1);
});

test("el mensaje rota por ciclo y da la vuelta al terminar el pool", () => {
  const n = MENSAJES.length;
  assert.equal(mensajeDelCiclo(0).indice, 0);
  assert.equal(mensajeDelCiclo(1).indice, 1);
  assert.equal(mensajeDelCiclo(n).indice, 0);
  assert.equal(mensajeDelCiclo(n + 3).indice, 3);
});

test("todos los mensajes están completos y ninguno se repite", () => {
  const asuntos = new Set<string>();
  for (const m of MENSAJES) {
    assert.ok(m.asunto && m.titulo && m.ctaTexto);
    assert.ok(m.parrafos.length >= 2);
    asuntos.add(m.asunto);
  }
  assert.equal(asuntos.size, MENSAJES.length);
});

test("el token de baja sirve para su usuario y para nadie más", () => {
  const token = crearTokenBaja("u-1", MOTIVO_BAJA, "secreto");

  assert.equal(tokenDeBajaValido("u-1", MOTIVO_BAJA, token, "secreto"), true);
  assert.equal(tokenDeBajaValido("u-2", MOTIVO_BAJA, token, "secreto"), false);
  assert.equal(tokenDeBajaValido("u-1", "otro-motivo", token, "secreto"), false);
  assert.equal(tokenDeBajaValido("u-1", MOTIVO_BAJA, token, "otro-secreto"), false);
  assert.equal(tokenDeBajaValido("u-1", MOTIVO_BAJA, "", "secreto"), false);
  assert.equal(tokenDeBajaValido("u-1", MOTIVO_BAJA, token.slice(1), "secreto"), false);
});

test("el correo lleva saludo, botón al chat y enlace de baja, y escapa el nombre", () => {
  const { html, texto, asunto } = redactarMotivacional({
    mensaje: MENSAJES[0],
    nombre: "<b>Marta</b> Gómez",
    appUrl: "https://app.test",
    urlBaja: "https://app.test/api/correos/baja?u=1&t=abc",
  });

  assert.equal(asunto, MENSAJES[0].asunto);
  assert.match(html, /https:\/\/app\.test\/eos\/chat/);
  assert.match(html, /darte de baja/);
  assert.match(html, /correos\/baja\?u=1&t=abc/);
  assert.doesNotMatch(html, /<b>Marta/);
  assert.match(texto, /baja acá: https:\/\/app\.test\/api\/correos\/baja/);
});

/* ------------------------------------------------------------------------ */
/* El orquestador, contra un cliente falso.                                  */
/* ------------------------------------------------------------------------ */

type Estado = {
  usuarios: { id: string; nombre: string | null; email: string | null }[];
  reclamados: { usuario_id: string; ciclo: number }[];
  bajas: string[];
  fallaReclamo?: string;
};

function clienteFalso(estado: Estado) {
  return {
    from(tabla: string) {
      const filtros: Record<string, unknown> = {};
      let op: "select" | "insert" | "delete" = "select";
      let fila: Record<string, unknown> = {};
      let rango: [number, number] | null = null;

      const q: Record<string, unknown> = {
        select: () => q,
        not: () => q,
        lte: () => q,
        order: () => q,
        range: (a: number, b: number) => {
          rango = [a, b];
          return q;
        },
        eq: (col: string, valor: unknown) => {
          filtros[col] = valor;
          return q;
        },
        insert: (f: Record<string, unknown>) => {
          op = "insert";
          fila = f;
          return q;
        },
        delete: () => {
          op = "delete";
          return q;
        },
        then: (ok: (r: unknown) => unknown) => {
          let resultado: { data?: unknown; error: unknown } = { data: [], error: null };

          if (tabla === "eos_emails_motivacionales_v188") {
            if (op === "insert") {
              const repetido = estado.reclamados.some(
                (r) => r.usuario_id === fila.usuario_id && r.ciclo === fila.ciclo,
              );
              resultado = repetido
                ? { error: { code: "23505" } }
                : estado.fallaReclamo
                  ? { error: { code: estado.fallaReclamo } }
                  : (estado.reclamados.push({
                      usuario_id: fila.usuario_id as string,
                      ciclo: fila.ciclo as number,
                    }),
                    { error: null });
            } else if (op === "delete") {
              estado.reclamados = estado.reclamados.filter(
                (r) => !(r.usuario_id === filtros.usuario_id && r.ciclo === filtros.ciclo),
              );
              resultado = { error: null };
            } else {
              resultado = {
                data: estado.reclamados.filter((r) => r.ciclo === filtros.ciclo),
                error: null,
              };
            }
          } else if (tabla === "eos_followup_preferences") {
            resultado = { data: estado.bajas.map((usuario_id) => ({ usuario_id })), error: null };
          } else if (tabla === "usuarios") {
            const [a, b] = rango ?? [0, 999];
            resultado = { data: estado.usuarios.slice(a, b + 1), error: null };
          }

          return Promise.resolve(resultado).then(ok);
        },
      };
      return q;
    },
  };
}

function armar(estado: Partial<Estado> = {}) {
  const completo: Estado = {
    usuarios: [
      { id: "u1", nombre: "Ana Paz", email: "ana@test.py" },
      { id: "u2", nombre: null, email: "dos@test.py" },
      { id: "u3", nombre: "Sin Correo", email: null },
    ],
    reclamados: [],
    bajas: [],
    ...estado,
  };
  const enviados: CorreoMotivacional[] = [];
  const opciones = {
    hoy: "2026-09-20",
    appUrl: "https://app.test",
    secreto: "secreto",
    enviar: async (c: CorreoMotivacional) => {
      enviados.push(c);
    },
  };
  return { completo, enviados, opciones, cliente: clienteFalso(completo) as never };
}

test("manda a quien tiene correo y no a quien no", async () => {
  const { cliente, opciones, enviados } = armar();
  const r = await enviarMotivacionales(cliente, opciones);

  assert.equal(r.enviados, 2);
  assert.deepEqual(enviados.map((e) => e.para).sort(), ["ana@test.py", "dos@test.py"]);
  assert.match(enviados[0].urlBaja, /\/api\/correos\/baja\?u=u1&t=/);
});

test("llamarlo dos veces en el mismo ciclo no manda dos correos", async () => {
  const { cliente, opciones, enviados } = armar();

  await enviarMotivacionales(cliente, opciones);
  const segunda = await enviarMotivacionales(cliente, { ...opciones, hoy: "2026-09-21" });

  const mismoCiclo = cicloDe("2026-09-20") === cicloDe("2026-09-21");
  if (mismoCiclo) {
    assert.equal(segunda.enviados, 0);
    assert.equal(enviados.length, 2);
  } else {
    assert.equal(enviados.length, 4);
  }
});

test("un ciclo nuevo vuelve a mandar", async () => {
  const { cliente, opciones, enviados } = armar();

  await enviarMotivacionales(cliente, opciones);
  await enviarMotivacionales(cliente, { ...opciones, hoy: "2026-09-30" });

  assert.equal(enviados.length, 4);
});

test("quien se dio de baja no recibe nada", async () => {
  const { cliente, opciones, enviados } = armar({ bajas: ["u1"] });
  await enviarMotivacionales(cliente, opciones);

  assert.deepEqual(enviados.map((e) => e.para), ["dos@test.py"]);
});

test("si el envío falla se suelta el reclamo para reintentar y no frena al resto", async () => {
  const { cliente, opciones, completo } = armar();
  const intentos: string[] = [];

  const r = await enviarMotivacionales(cliente, {
    ...opciones,
    enviar: async (c) => {
      intentos.push(c.para);
      if (c.para === "ana@test.py") throw new Error("Resend caído");
    },
  });

  assert.equal(r.fallidos, 1);
  assert.equal(r.enviados, 1);
  assert.deepEqual(intentos.sort(), ["ana@test.py", "dos@test.py"]);
  // Solo queda reclamado el que salió: Ana puede reintentarse mañana.
  assert.deepEqual(completo.reclamados.map((x) => x.usuario_id), ["u2"]);
});

test("respeta el tope por ejecución y avisa que quedaron pendientes", async () => {
  const { cliente, opciones, enviados } = armar();
  const r = await enviarMotivacionales(cliente, { ...opciones, max: 1 });

  assert.equal(enviados.length, 1);
  assert.equal(r.pendientes, true);
});

test("un error al reclamar que no es duplicado no manda nada", async () => {
  const { cliente, opciones, enviados } = armar({ fallaReclamo: "42P01" });
  const r = await enviarMotivacionales(cliente, opciones);

  assert.equal(enviados.length, 0);
  assert.equal(r.enviados, 0);
});

test("la URL de baja lleva el token del usuario", () => {
  const url = urlDeBaja("https://app.test", "u-9", "secreto");
  const token = new URL(url).searchParams.get("t") ?? "";

  assert.equal(tokenDeBajaValido("u-9", MOTIVO_BAJA, token, "secreto"), true);
});
