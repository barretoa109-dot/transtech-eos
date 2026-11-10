import assert from "node:assert/strict";
import test from "node:test";

import { enviarMotivacionalesPush } from "./motivacionales.ts";

const HOY = "2026-11-10";
const VIEJA = "2026-01-01T00:00:00Z";
const RECIEN_NACIDA = new Date().toISOString();

/** Un cliente de servicio de mentira, con lo justo para este módulo. */
function admin(opciones: {
  dispositivos?: string[];
  apagados?: string[];
  reclamados?: { usuario_id: string; fecha: string; franja: string }[];
  creadaEn?: Record<string, string>;
  sinAccionDesde?: Record<string, string | null>;
  registro?: { insertados: unknown[] };
}) {
  const registro = opciones.registro ?? { insertados: [] };
  const reclamados = opciones.reclamados ?? [];

  return {
    from(tabla: string) {
      const cadena: Record<string, unknown> = {};
      let uid = "";

      for (const m of ["select", "not", "or", "limit", "order", "neq"]) cadena[m] = () => cadena;
      cadena.eq = (col: string, valor: string) => {
        if (col === "usuario_id" || col === "id") uid = valor;
        return cadena;
      };
      cadena.maybeSingle = () => {
        if (tabla === "eos_followup_preferences") {
          return Promise.resolve({
            data: { avisos_motivacionales_push: !(opciones.apagados ?? []).includes(uid) },
            error: null,
          });
        }
        if (tabla === "usuarios") {
          return Promise.resolve({ data: { created_at: (opciones.creadaEn ?? {})[uid] ?? VIEJA }, error: null });
        }
        if (tabla === "eos_action_commands") {
          const fecha = (opciones.sinAccionDesde ?? {})[uid];
          return Promise.resolve({ data: fecha ? { created_at: `${fecha}T12:00:00Z` } : null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };
      cadena.insert = (fila: { usuario_id: string; fecha: string; franja: string }) => {
        const yaEsta = reclamados.some(
          (r) => r.usuario_id === fila.usuario_id && r.fecha === fila.fecha && r.franja === fila.franja,
        );
        if (yaEsta) return Promise.resolve({ error: { code: "23505" } });
        reclamados.push(fila);
        registro.insertados.push(fila);
        return Promise.resolve({ error: null });
      };
      cadena.then = (resolver: (r: unknown) => unknown) => {
        const ids = (opciones.dispositivos ?? []).map((usuario_id) => ({ usuario_id }));
        return Promise.resolve({ data: tabla === "dispositivos_push" ? ids : [], error: null }).then(resolver);
      };
      return cadena;
    },
  };
}

test("manda a quien tiene un dispositivo nativo y no apagó el aviso", async () => {
  const mandados: string[] = [];

  const r = await enviarMotivacionalesPush(
    admin({ dispositivos: ["u1"] }) as never,
    "noche",
    { hoy: HOY, enviar: async (_a, uid) => { mandados.push(uid); return { enviados: 1 }; } },
  );

  assert.deepEqual(mandados, ["u1"]);
  assert.equal(r.enviados, 1);
  assert.equal(r.evaluados, 1);
});

test("quien apagó el aviso no recibe nada", async () => {
  const mandados: string[] = [];

  const r = await enviarMotivacionalesPush(
    admin({ dispositivos: ["u1"], apagados: ["u1"] }) as never,
    "manana",
    { hoy: HOY, enviar: async (_a, uid) => { mandados.push(uid); return { enviados: 1 }; } },
  );

  assert.deepEqual(mandados, []);
  assert.equal(r.apagados, 1);
  assert.equal(r.enviados, 0);
});

test("una cuenta recién nacida no recibe nada todavía", async () => {
  const mandados: string[] = [];

  const r = await enviarMotivacionalesPush(
    admin({ dispositivos: ["u1"], creadaEn: { u1: RECIEN_NACIDA } }) as never,
    "mediodia",
    { hoy: HOY, enviar: async (_a, uid) => { mandados.push(uid); return { enviados: 1 }; } },
  );

  assert.deepEqual(mandados, []);
  assert.equal(r.evaluados, 1);
  assert.equal(r.enviados, 0);
});

test("la misma franja el mismo día no se repite", async () => {
  const mandados: string[] = [];
  const registro = { insertados: [] as unknown[] };

  const r = await enviarMotivacionalesPush(
    admin({ dispositivos: ["u1"], reclamados: [{ usuario_id: "u1", fecha: HOY, franja: "manana" }], registro }) as never,
    "manana",
    { hoy: HOY, enviar: async (_a, uid) => { mandados.push(uid); return { enviados: 1 }; } },
  );

  assert.deepEqual(mandados, []);
  assert.equal(r.enviados, 0);
  assert.equal(registro.insertados.length, 0);
});

test("otra franja el mismo día sí manda", async () => {
  const mandados: string[] = [];

  const r = await enviarMotivacionalesPush(
    admin({ dispositivos: ["u1"], reclamados: [{ usuario_id: "u1", fecha: HOY, franja: "manana" }] }) as never,
    "noche",
    { hoy: HOY, enviar: async (_a, uid) => { mandados.push(uid); return { enviados: 1 }; } },
  );

  assert.deepEqual(mandados, ["u1"]);
  assert.equal(r.enviados, 1);
});

test("sin dispositivo registrado, nadie se evalúa", async () => {
  const r = await enviarMotivacionalesPush(admin({ dispositivos: [] }) as never, "manana", { hoy: HOY });
  assert.equal(r.evaluados, 0);
  assert.equal(r.enviados, 0);
});

test("mediodía: sin ninguna acción nunca, el texto invita a arrancar", async () => {
  const capturado: { aviso?: { titulo: string; cuerpo: string } } = {};

  await enviarMotivacionalesPush(
    admin({ dispositivos: ["u1"] }) as never,
    "mediodia",
    { hoy: HOY, enviar: async (_a, _uid, aviso) => { capturado.aviso = aviso; return { enviados: 1 }; } },
  );

  assert.equal(capturado.aviso?.titulo, "Arrancá con lo de hoy");
});

test("mediodía: con una acción hoy mismo, el texto refuerza en vez de retar", async () => {
  const capturado: { aviso?: { titulo: string; cuerpo: string } } = {};

  await enviarMotivacionalesPush(
    admin({ dispositivos: ["u1"], sinAccionDesde: { u1: HOY } }) as never,
    "mediodia",
    { hoy: HOY, enviar: async (_a, _uid, aviso) => { capturado.aviso = aviso; return { enviados: 1 }; } },
  );

  assert.equal(capturado.aviso?.titulo, "Vas bien hoy");
});

test("mediodía: con varios días sin nada, el texto lo dice en números", async () => {
  const capturado: { aviso?: { titulo: string; cuerpo: string } } = {};

  await enviarMotivacionalesPush(
    admin({ dispositivos: ["u1"], sinAccionDesde: { u1: "2026-11-05" } }) as never,
    "mediodia",
    { hoy: HOY, enviar: async (_a, _uid, aviso) => { capturado.aviso = aviso; return { enviados: 1 }; } },
  );

  assert.equal(capturado.aviso?.titulo, "Retomá con EOS");
  assert.match(capturado.aviso!.cuerpo, /Hace 5 días/);
});

test("noche: el mismo día siempre da el mismo mensaje del pool", async () => {
  const vistos: string[] = [];

  for (let i = 0; i < 3; i += 1) {
    await enviarMotivacionalesPush(
      admin({ dispositivos: ["u1"] }) as never,
      "noche",
      { hoy: HOY, enviar: async (_a, _uid, aviso) => { vistos.push(aviso.titulo); return { enviados: 1 }; } },
    );
  }

  assert.equal(vistos[0], vistos[1]);
  assert.equal(vistos[1], vistos[2]);
});
