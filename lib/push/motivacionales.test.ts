import assert from "node:assert/strict";
import test from "node:test";

import { avisoDeObjetivo, CONSEJOS_PUSH, enviarMotivacionalesPush } from "./motivacionales.ts";

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
  /** Días (AAAA-MM-DD) con actividad, para rachas y resumen semanal. */
  diasActivos?: Record<string, string[]>;
  registro?: { insertados: unknown[]; devueltos?: number };
}) {
  const registro: { insertados: unknown[]; devueltos?: number } = opciones.registro ?? { insertados: [] };
  const reclamados = opciones.reclamados ?? [];

  return {
    from(tabla: string) {
      const cadena: Record<string, unknown> = {};
      let uid = "";

      for (const m of ["select", "not", "or", "limit", "order", "neq", "gte"]) cadena[m] = () => cadena;
      cadena.delete = () => {
        registro.devueltos = (registro.devueltos ?? 0) + 1;
        return cadena;
      };
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
        if (tabla === "eos_action_commands") {
          const filas = ((opciones.diasActivos ?? {})[uid] ?? []).map((d) => ({ created_at: `${d}T15:00:00Z` }));
          return Promise.resolve({ data: filas, error: null }).then(resolver);
        }
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

test("si el servicio de push lo rechaza, se cuenta como fallido, se dice por qué y se devuelve el reclamo", async () => {
  const registro = { insertados: [] as unknown[], devueltos: 0 };

  const r = await enviarMotivacionalesPush(
    admin({ dispositivos: ["u1", "u2"], registro }) as never,
    "manana",
    {
      hoy: HOY,
      enviar: async () => ({
        enviados: 0,
        fallidos: 2,
        razones: ["HTTP 403 InvalidProviderToken · ...2F0FD6", "HTTP 403 InvalidProviderToken · ...153E82"],
      }),
    },
  );

  assert.equal(r.enviados, 0);
  assert.equal(r.fallidos, 2);
  assert.equal(r.sin_dispositivo, 0);
  // Dos personas, cuatro rechazos, una sola razón: la misma, sin el token.
  assert.deepEqual(r.razones, ["HTTP 403 InvalidProviderToken"]);
  assert.equal(registro.devueltos, 2);
});

test("sin fallos y sin envíos, es que no había a dónde mandar", async () => {
  const r = await enviarMotivacionalesPush(
    admin({ dispositivos: ["u1"] }) as never,
    "noche",
    { hoy: HOY, enviar: async () => ({ enviados: 0, fallidos: 0, razones: ["esta cuenta no tiene ningún dispositivo registrado"] }) },
  );

  assert.equal(r.sin_dispositivo, 1);
  assert.equal(r.fallidos, 0);
});

test("todo texto de la mañana entra entero en una notificación", () => {
  const largo = "Juntar para la camioneta nueva del reparto antes de que termine el año que viene sin falta";
  const avisos = [
    ...CONSEJOS_PUSH,
    ...["cumplido", "atrasado", "en_ritmo", "vencido", "sin_fecha", "otro"].map((estado) =>
      avisoDeObjetivo({ estado, titulo: largo, progreso: 100 }),
    ),
  ];

  for (const aviso of avisos) {
    assert.ok(aviso.titulo.length <= 45, `título largo: ${aviso.titulo}`);
    assert.ok(aviso.cuerpo.length <= 150, `cuerpo largo (${aviso.cuerpo.length}): ${aviso.cuerpo}`);
    // Se lee con el teléfono bloqueado: nunca un monto.
    assert.doesNotMatch(aviso.cuerpo, /Gs\.|₲|USD|\$/);
  }
});

const capturar = async (franja: "manana" | "mediodia" | "noche", hoy: string, opciones: Parameters<typeof admin>[0]) => {
  const capturado: { aviso?: { titulo: string; cuerpo: string } } = {};
  await enviarMotivacionalesPush(admin({ dispositivos: ["u1"], ...opciones }) as never, franja, {
    hoy,
    enviar: async (_a, _uid, aviso) => { capturado.aviso = aviso; return { enviados: 1 }; },
  });
  return capturado.aviso;
};

test("mediodía: al llegar a 3 días seguidos se festeja la racha", async () => {
  const aviso = await capturar("mediodia", HOY, {
    sinAccionDesde: { u1: HOY },
    diasActivos: { u1: ["2026-11-10", "2026-11-09", "2026-11-08"] },
  });
  assert.equal(aviso?.titulo, "Tres días seguidos");
});

test("mediodía: una racha que no es hito no interrumpe el texto de siempre", async () => {
  const aviso = await capturar("mediodia", HOY, {
    sinAccionDesde: { u1: HOY },
    diasActivos: { u1: ["2026-11-10", "2026-11-09", "2026-11-08", "2026-11-07"] },
  });
  assert.equal(aviso?.titulo, "Vas bien hoy");
});

test("noche: con racha y sin nada anotado hoy, avisa antes de que se corte", async () => {
  const aviso = await capturar("noche", HOY, { diasActivos: { u1: ["2026-11-09", "2026-11-08", "2026-11-07"] } });
  assert.equal(aviso?.titulo, "Llevás 3 días seguidos");
});

test("lunes a la mañana: el resumen de la semana, no el consejo", async () => {
  const aviso = await capturar("manana", "2026-11-16", { diasActivos: { u1: ["2026-11-15", "2026-11-13", "2026-11-12"] } });
  assert.equal(aviso?.titulo, "Tu semana con EOS");
  assert.match(aviso!.cuerpo, /3 de los últimos 7 días/);
});
