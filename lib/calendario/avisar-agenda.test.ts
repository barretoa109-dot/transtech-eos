import assert from "node:assert/strict";
import test from "node:test";

import { avisarAgenda, redactarAvisoAgenda, repartir } from "./avisar-agenda.ts";
import type { EventoAgenda } from "./agenda.ts";

const HOY = "2026-09-25";

function evento(parcial: Partial<EventoAgenda> & { id: string; fecha: string }): EventoAgenda {
  return {
    origen: "propio",
    categoria: "recordatorio",
    titulo: parcial.id,
    detalle: null,
    hora: null,
    hora_fin: null,
    estado: "pendiente",
    contacto: null,
    monto: null,
    moneda: null,
    editable: true,
    completable: true,
    repite: null,
    ocurrencia: null,
    serie_desde: null,
    serie_hasta: null,
    ...parcial,
  };
}

// ------------------------------------------------------------------ el texto

test("reparte lo pendiente en hoy, mañana y atrasado, y deja afuera lo demás", () => {
  const dia = repartir(
    [
      evento({ id: "hoy", fecha: HOY }),
      evento({ id: "manana", fecha: "2026-09-26" }),
      evento({ id: "ayer", fecha: "2026-09-24" }),
      evento({ id: "hace-8", fecha: "2026-09-17" }), // más viejo que la ventana: ya es una deuda
      evento({ id: "pasado", fecha: "2026-09-27" }), // todavía no toca
      evento({ id: "hecho", fecha: HOY, estado: "hecho" }),
      evento({ id: "cancelado", fecha: HOY, estado: "cancelado" }),
    ],
    HOY,
  );

  assert.deepEqual(dia.hoy.map((e) => e.id), ["hoy"]);
  assert.deepEqual(dia.manana.map((e) => e.id), ["manana"]);
  assert.deepEqual(dia.atrasados.map((e) => e.id), ["ayer"]);
});

test("el mismo evento por dos listas no se cuenta dos veces", () => {
  const e = evento({ id: "repetido", fecha: HOY });
  assert.equal(repartir([e, e], HOY).hoy.length, 1);
});

test("el aviso dice hoy, mañana y atrasado, con la hora de lo que la tiene", () => {
  const dia = repartir(
    [
      evento({ id: "a", titulo: "Pagar los salarios", fecha: HOY }),
      evento({ id: "b", titulo: "Reunión con el contador", fecha: HOY, hora: "10:00" }),
      evento({ id: "c", titulo: "Llamar al proveedor", fecha: "2026-09-26" }),
      evento({ id: "d", titulo: "Renovar el seguro", fecha: "2026-09-22" }),
    ],
    HOY,
  );

  const aviso = redactarAvisoAgenda(dia)!;

  assert.equal(aviso.titulo, "Tu agenda de hoy");
  assert.equal(
    aviso.texto,
    "Hoy: Pagar los salarios, Reunión con el contador (10:00). Mañana: Llamar al proveedor. Atrasado: Renovar el seguro.",
  );
});

test("nombra hasta tres y dice cuántos más hay", () => {
  const dia = repartir(
    ["uno", "dos", "tres", "cuatro", "cinco"].map((t, i) => evento({ id: `e${i}`, titulo: t, fecha: HOY })),
    HOY,
  );

  assert.equal(redactarAvisoAgenda(dia)!.texto, "Hoy: uno, dos, tres y 2 más.");
});

test("con varios atrasados dice cuántos", () => {
  const dia = repartir(
    [evento({ id: "a", titulo: "A", fecha: "2026-09-23" }), evento({ id: "b", titulo: "B", fecha: "2026-09-22" })],
    HOY,
  );
  const aviso = redactarAvisoAgenda(dia)!;

  assert.match(aviso.texto, /Atrasados \(2\): /);
  // Sin nada para hoy, el título no promete "hoy".
  assert.equal(aviso.titulo, "Lo que viene en tu agenda");
});

test("sin nada que decir no hay aviso: nunca 'hoy no tenés nada'", () => {
  assert.equal(redactarAvisoAgenda({ hoy: [], manana: [], atrasados: [] }), null);
});

// ---------------------------------------------------------------- el reparto

/** Un cliente de servicio de mentira, con lo justo para este módulo. */
function admin(opciones: {
  candidatos?: string[];
  apagados?: string[];
  reclamados?: string[];
  errorAlReclamar?: { code: string } | null;
  registro?: { insertados: unknown[]; borrados: number; actualizados: unknown[] };
}) {
  const registro = opciones.registro ?? { insertados: [], borrados: 0, actualizados: [] };
  const reclamados = new Set(opciones.reclamados ?? []);

  return {
    from(tabla: string) {
      const cadena: Record<string, unknown> = {};
      let uid = "";

      for (const m of ["select", "not", "or", "limit", "in"]) cadena[m] = () => cadena;
      cadena.eq = (col: string, valor: string) => {
        if (col === "usuario_id") uid = valor;
        return cadena;
      };
      cadena.maybeSingle = () =>
        Promise.resolve({
          data: tabla === "eos_followup_preferences" ? { avisos_agenda: !(opciones.apagados ?? []).includes(uid) } : null,
          error: null,
        });
      cadena.insert = (fila: { usuario_id: string }) => {
        if (opciones.errorAlReclamar) return Promise.resolve({ error: opciones.errorAlReclamar });
        if (reclamados.has(fila.usuario_id)) return Promise.resolve({ error: { code: "23505" } });
        reclamados.add(fila.usuario_id);
        registro.insertados.push(fila);
        return Promise.resolve({ error: null });
      };
      cadena.delete = () => {
        registro.borrados += 1;
        return cadena;
      };
      cadena.update = (cambios: unknown) => {
        registro.actualizados.push(cambios);
        return cadena;
      };
      cadena.then = (resolver: (r: unknown) => unknown) => {
        const ids = (opciones.candidatos ?? []).map((usuario_id) => ({ usuario_id }));
        return Promise.resolve({ data: tabla.startsWith("eos_calendario") || tabla === "eos_tasks" ? ids : [], error: null }).then(resolver);
      };
      return cadena;
    },
  };
}

const conAgenda = async () => [evento({ id: "a", titulo: "Pagar los salarios", fecha: HOY })];

test("avisa por push a quien tiene algo hoy, y lo anota una vez por día", async () => {
  const registro = { insertados: [] as unknown[], borrados: 0, actualizados: [] as unknown[] };
  const mandados: string[] = [];

  const r = await avisarAgenda(admin({ candidatos: ["u1"], registro }) as never, {
    hoy: HOY,
    leer: conAgenda,
    entregar: async (_a, uid) => {
      mandados.push(uid);
      return "push";
    },
  });

  assert.deepEqual(mandados, ["u1"]);
  assert.equal(r.avisados, 1);
  assert.equal(r.por_push, 1);
  assert.equal(registro.insertados.length, 1);
  assert.equal(registro.borrados, 0);
});

test("una segunda corrida el mismo día no manda nada", async () => {
  const mandados: string[] = [];

  const r = await avisarAgenda(admin({ candidatos: ["u1"], reclamados: ["u1"] }) as never, {
    hoy: HOY,
    leer: conAgenda,
    entregar: async (_a, uid) => {
      mandados.push(uid);
      return "push";
    },
  });

  assert.deepEqual(mandados, []);
  assert.equal(r.ya_avisados, 1);
  assert.equal(r.avisados, 0);
});

test("quien apagó los avisos de agenda no recibe ninguno", async () => {
  const mandados: string[] = [];

  const r = await avisarAgenda(admin({ candidatos: ["u1", "u2"], apagados: ["u1"] }) as never, {
    hoy: HOY,
    leer: conAgenda,
    entregar: async (_a, uid) => {
      mandados.push(uid);
      return "correo";
    },
  });

  assert.deepEqual(mandados, ["u2"]);
  assert.equal(r.apagados, 1);
  assert.equal(r.por_correo, 1);
});

test("sin nada en la agenda no se manda ni se reclama el día", async () => {
  const registro = { insertados: [] as unknown[], borrados: 0, actualizados: [] as unknown[] };

  const r = await avisarAgenda(admin({ candidatos: ["u1"], registro }) as never, {
    hoy: HOY,
    leer: async () => [evento({ id: "lejos", fecha: "2026-12-01" })],
    entregar: async () => {
      throw new Error("no debería intentar entregar");
    },
  });

  assert.equal(r.sin_nada, 1);
  assert.equal(registro.insertados.length, 0);
});

test("si no se pudo entregar por ningún canal, se devuelve el reclamo del día", async () => {
  const registro = { insertados: [] as unknown[], borrados: 0, actualizados: [] as unknown[] };

  const r = await avisarAgenda(admin({ candidatos: ["u1"], registro }) as never, {
    hoy: HOY,
    leer: conAgenda,
    entregar: async () => null,
  });

  assert.equal(r.sin_canal, 1);
  assert.equal(r.avisados, 0);
  // Sin devolverlo, un canal que se active más tarde ese día ya no podría avisar.
  assert.equal(registro.borrados, 1);
});

test("un fallo al entregar a uno no le quita el aviso a los demás", async () => {
  const mandados: string[] = [];

  const r = await avisarAgenda(admin({ candidatos: ["u1", "u2"] }) as never, {
    hoy: HOY,
    leer: conAgenda,
    entregar: async (_a, uid) => {
      if (uid === "u1") throw new Error("Resend caído");
      mandados.push(uid);
      return "push";
    },
  });

  assert.deepEqual(mandados, ["u2"]);
  assert.equal(r.avisados, 1);
  assert.equal(r.sin_canal, 1);
});

test("un error al reclamar (no un duplicado) no manda el aviso: sin reclamo no hay garantía de una vez", async () => {
  const r = await avisarAgenda(admin({ candidatos: ["u1"], errorAlReclamar: { code: "42P01" } }) as never, {
    hoy: HOY,
    leer: conAgenda,
    entregar: async () => {
      throw new Error("no debería mandar sin reclamar");
    },
  });

  assert.equal(r.con_error, 1);
  assert.equal(r.avisados, 0);
});
