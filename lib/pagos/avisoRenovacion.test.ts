import assert from "node:assert/strict";
import { test } from "node:test";

import {
  avisarRenovacionPendiente,
  enlaceRenovacion,
  redactarAvisoRenovacion,
  TITULO_RENOVACION,
} from "./avisoRenovacion.ts";

test("dice qué pasó, que no es culpa del usuario y qué hacer", () => {
  const aviso = redactarAvisoRenovacion({
    plan: "pro",
    vence: "2026-08-28",
    hoy: "2026-08-25",
  });

  assert.match(aviso.cuerpo, /verificación adicional/);
  assert.match(aviso.cuerpo, /no la podemos hacer por vos/);
  assert.match(aviso.cuerpo, /confirmá el pago/);
});

test("no usa la palabra 3DS: no le dice nada a quien lo recibe", () => {
  const aviso = redactarAvisoRenovacion({
    plan: "pro",
    vence: "2026-08-28",
    hoy: "2026-08-25",
  });

  assert.doesNotMatch(aviso.cuerpo, /3ds/i);
  assert.doesNotMatch(aviso.asunto, /3ds/i);
});

test("el título no lleva plan ni cifras, porque se ve en la pantalla bloqueada", () => {
  const aviso = redactarAvisoRenovacion({
    plan: "pro",
    vence: "2026-08-28",
    hoy: "2026-08-25",
  });

  assert.equal(aviso.titulo, TITULO_RENOVACION);
  assert.doesNotMatch(aviso.titulo, /pro/i);
  assert.doesNotMatch(aviso.titulo, /\d/);
});

test("nombra el plan en el cuerpo", () => {
  const aviso = redactarAvisoRenovacion({
    plan: "pro",
    vence: "2026-08-28",
    hoy: "2026-08-25",
  });

  assert.match(aviso.cuerpo, /EOS Pro/);
});

test("con el vencimiento a días, dice el día", () => {
  const aviso = redactarAvisoRenovacion({
    plan: "pro",
    vence: "2026-08-28",
    hoy: "2026-08-25",
  });

  assert.match(aviso.cuerpo, /vence el 28/);
});

test("si vence hoy, lo dice así y no con la fecha", () => {
  const aviso = redactarAvisoRenovacion({
    plan: "plus",
    vence: "2026-08-25",
    hoy: "2026-08-25",
  });

  assert.match(aviso.cuerpo, /vence hoy/);
});

test("si vence mañana, lo dice así", () => {
  const aviso = redactarAvisoRenovacion({
    plan: "plus",
    vence: "2026-08-26",
    hoy: "2026-08-25",
  });

  assert.match(aviso.cuerpo, /vence mañana/);
});

test("si el plan YA venció no se disimula", () => {
  // El cron sigue intentando durante la ventana de gracia. Decir "vence el 24"
  // el 26 le haría creer que todavía tiene margen.
  const aviso = redactarAvisoRenovacion({
    plan: "pro",
    vence: "2026-08-24",
    hoy: "2026-08-26",
  });

  assert.match(aviso.cuerpo, /venció el 24/);
  assert.match(aviso.cuerpo, /no quedarte sin acceso/);
});

test("sin fecha de vencimiento no se inventa ninguna", () => {
  const aviso = redactarAvisoRenovacion({ plan: "pro", vence: null, hoy: "2026-08-25" });

  assert.match(aviso.cuerpo, /siga activo/);
  assert.doesNotMatch(aviso.cuerpo, /vence/);
});

test("el mes cambia sin romper el día", () => {
  const aviso = redactarAvisoRenovacion({
    plan: "pro",
    vence: "2026-09-01",
    hoy: "2026-08-31",
  });

  assert.match(aviso.cuerpo, /vence mañana/);
});

test("el enlace lleva al checkout con el plan ya elegido", () => {
  assert.equal(
    enlaceRenovacion("pro", "mensual"),
    "/pago/tarjeta?plan=pro&periodicidad=mensual",
  );
});

/*
 * Sin claves VAPID el push no se intenta, así que estas pruebas ejercitan el
 * respaldo por correo. Se fuerzan acá para que el resultado no dependa de lo
 * que tenga cargado la máquina que corre los tests.
 */
delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

type Fila = { id: string; metadata: Record<string, unknown> | null };

function adminFalso(opciones: {
  previas?: Fila[];
  errorAlLeer?: boolean;
  email?: string | null;
}) {
  const actualizaciones: Record<string, unknown>[] = [];

  const admin = {
    actualizaciones,
    from(tabla: string) {
      let accion = "select";

      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        gte: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        update: (valores: Record<string, unknown>) => {
          accion = "update";
          actualizaciones.push({ tabla, ...valores });
          return q;
        },
        maybeSingle: () =>
          Promise.resolve({
            data: tabla === "usuarios" ? { email: opciones.email ?? null } : null,
          }),
        then: (resolver: (v: unknown) => unknown, rechazar?: (e: unknown) => unknown) => {
          if (accion === "update") return Promise.resolve({ error: null }).then(resolver, rechazar);

          if (tabla === "solicitudes_pago") {
            return Promise.resolve(
              opciones.errorAlLeer
                ? { data: null, error: { message: "sin conexión" } }
                : { data: opciones.previas ?? [], error: null },
            ).then(resolver, rechazar);
          }

          return Promise.resolve({ data: [], error: null }).then(resolver, rechazar);
        },
      };

      return q;
    },
  };

  return admin;
}

const BASE = {
  usuarioId: "u1",
  solicitudId: "s-hoy",
  plan: "pro",
  periodicidad: "mensual",
  vence: "2026-08-28",
  hoy: "2026-08-25",
  ventanaDesde: "2026-08-22T00:00:00.000Z",
  baseUrl: "https://transtech.com.py",
};

test("la primera vez avisa, y deja anotado que avisó", async () => {
  const enviados: { para: string; asunto: string; texto: string }[] = [];
  const admin = adminFalso({
    previas: [{ id: "s-hoy", metadata: { bancard_respuesta: {} } }],
    email: "marta@ejemplo.com",
  });

  const resultado = await avisarRenovacionPendiente(admin, {
    ...BASE,
    enviarCorreo: async (a) => {
      enviados.push(a);
    },
  });

  assert.deepEqual(resultado, { avisado: true, motivo: "enviado" });
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].para, "marta@ejemplo.com");
  // El correo lleva el enlace absoluto: no se puede hacer clic en una ruta.
  assert.match(enviados[0].texto, /https:\/\/transtech\.com\.py\/pago\/tarjeta\?plan=pro/);

  const marca = admin.actualizaciones.find((a) => a.tabla === "solicitudes_pago");
  assert.ok((marca?.metadata as Record<string, unknown>)?.aviso_renovacion_en);
  // No pisa lo que ya había anotado el cobro.
  assert.ok((marca?.metadata as Record<string, unknown>)?.bancard_respuesta);
});

test("NO vuelve a avisar en la misma ventana de gracia", async () => {
  // El cron reintenta cada día. Cuatro veces el mismo mensaje es lo que
  // enseña a ignorar las notificaciones.
  const enviados: unknown[] = [];
  const admin = adminFalso({
    previas: [
      { id: "s-hoy", metadata: {} },
      { id: "s-ayer", metadata: { aviso_renovacion_en: "2026-08-24T13:00:00.000Z" } },
    ],
    email: "marta@ejemplo.com",
  });

  const resultado = await avisarRenovacionPendiente(admin, {
    ...BASE,
    enviarCorreo: async (a) => {
      enviados.push(a);
    },
  });

  assert.deepEqual(resultado, { avisado: false, motivo: "repetido" });
  assert.equal(enviados.length, 0);
});

test("sin ningún canal no se anota nada, para poder avisar mañana", async () => {
  const admin = adminFalso({
    previas: [{ id: "s-hoy", metadata: {} }],
    email: null,
  });

  const resultado = await avisarRenovacionPendiente(admin, BASE);

  assert.deepEqual(resultado, { avisado: false, motivo: "sin_canal" });
  assert.equal(admin.actualizaciones.length, 0);
});

test("si no se puede leer el historial, se calla en vez de arriesgar repetir", async () => {
  const enviados: unknown[] = [];
  const admin = adminFalso({ errorAlLeer: true, email: "marta@ejemplo.com" });

  const resultado = await avisarRenovacionPendiente(admin, {
    ...BASE,
    enviarCorreo: async (a) => {
      enviados.push(a);
    },
  });

  assert.deepEqual(resultado, { avisado: false, motivo: "sin_historial" });
  assert.equal(enviados.length, 0);
});
