import assert from "node:assert/strict";
import test from "node:test";

import { claveDeCupo, consumirCupo, ipDelCliente, respuestaSinCupo } from "./limite.ts";

const SECRETO = "un-secreto-suficientemente-largo";

function cabeceras(valores: Record<string, string>): Headers {
  return new Headers(valores);
}

// ============================================================
// De dónde sale la IP
// ============================================================
//
// El test que importa: tomar el PRIMER elemento de `x-forwarded-for` deja el
// límite sin efecto, porque el atacante manda una IP inventada distinta en
// cada pedido y el proxy agrega la real detrás.

test("con x-forwarded-for falsificado, se toma la que puso el proxy y no la inventada", () => {
  const ip = ipDelCliente(cabeceras({ "x-forwarded-for": "1.2.3.4, 200.85.100.7" }));

  assert.equal(ip, "200.85.100.7");
});

test("y así dos pedidos con distinta IP inventada caen en la misma clave", () => {
  const uno = claveDeCupo("/api/x", ipDelCliente(cabeceras({ "x-forwarded-for": "9.9.9.9, 200.85.100.7" })), SECRETO);
  const otro = claveDeCupo("/api/x", ipDelCliente(cabeceras({ "x-forwarded-for": "8.8.8.8, 200.85.100.7" })), SECRETO);

  assert.equal(uno, otro);
});

test("x-real-ip gana, que es el valor limpio del proxy", () => {
  const ip = ipDelCliente(cabeceras({ "x-real-ip": "200.85.100.7", "x-forwarded-for": "1.2.3.4" }));

  assert.equal(ip, "200.85.100.7");
});

test("sin ninguna cabecera no se inventa una IP", () => {
  assert.equal(ipDelCliente(cabeceras({})), null);
  assert.equal(ipDelCliente(cabeceras({ "x-forwarded-for": "" })), null);
  assert.equal(ipDelCliente(cabeceras({ "x-forwarded-for": " , , " })), null);
});

// ============================================================
// La clave no puede decir de quién es
// ============================================================

test("la clave no contiene la IP en ninguna forma legible", () => {
  const clave = claveDeCupo("/api/ventas/contacto", "200.85.100.7", SECRETO);

  assert.ok(clave);
  assert.ok(!clave.includes("200.85.100.7"), "la IP viaja en claro");
  assert.equal(clave.length, 64, "no parece un sha256");
  assert.match(clave, /^[0-9a-f]{64}$/, "no es hexadecimal");
});

test("la misma IP en dos rutas distintas da claves distintas", () => {
  const a = claveDeCupo("/api/ventas/contacto", "200.85.100.7", SECRETO);
  const b = claveDeCupo("/api/soporte", "200.85.100.7", SECRETO);

  assert.notEqual(a, b);
});

test("la misma IP en la misma ruta da siempre la misma clave", () => {
  assert.equal(
    claveDeCupo("/api/x", "200.85.100.7", SECRETO),
    claveDeCupo("/api/x", "200.85.100.7", SECRETO),
  );
});

test("sin secreto no se hashea nada: sería publicar un diccionario de IPs", () => {
  assert.equal(claveDeCupo("/api/x", "200.85.100.7", undefined), null);
  assert.equal(claveDeCupo("/api/x", "200.85.100.7", ""), null);
  assert.equal(claveDeCupo("/api/x", "200.85.100.7", "corto"), null);
});

test("sin IP tampoco hay clave", () => {
  assert.equal(claveDeCupo("/api/x", null, SECRETO), null);
});

// ============================================================
// Consumir el cupo
// ============================================================

function adminQueResponde(respuesta: unknown, error: { message?: string } | null = null) {
  const llamadas: Record<string, unknown>[] = [];

  return {
    llamadas,
    cliente: {
      rpc(_nombre: string, args: Record<string, unknown>) {
        llamadas.push(args);
        return Promise.resolve({ data: respuesta, error });
      },
    },
  };
}

test("cuando la base dice que no, no se permite", async () => {
  const { cliente } = adminQueResponde({
    permitido: false,
    intentos: 6,
    maximo: 5,
    faltan_segundos: 240,
  });

  const cupo = await consumirCupo(cliente, {
    ruta: "/api/x",
    cabeceras: cabeceras({ "x-real-ip": "200.85.100.7" }),
    ventanaSegundos: 300,
    maximo: 5,
    secreto: SECRETO,
  });

  assert.equal(cupo.permitido, false);
  assert.equal(cupo.faltan_segundos, 240);
});

test("si la base falla, la solicitud pasa igual", async () => {
  // Es la decisión incómoda: rechazar todo ante una caída dejaría el
  // formulario muerto para los clientes de verdad. Un límite protege del
  // abuso; lo que protege datos es la sesión y la RLS.
  const { cliente } = adminQueResponde(null, { message: "se cayó" });

  const cupo = await consumirCupo(cliente, {
    ruta: "/api/x",
    cabeceras: cabeceras({ "x-real-ip": "200.85.100.7" }),
    ventanaSegundos: 300,
    maximo: 5,
    secreto: SECRETO,
  });

  assert.equal(cupo.permitido, true);
});

test("sin IP confiable no se llama a la base siquiera", async () => {
  const { cliente, llamadas } = adminQueResponde({ permitido: false });

  const cupo = await consumirCupo(cliente, {
    ruta: "/api/x",
    cabeceras: cabeceras({}),
    ventanaSegundos: 300,
    maximo: 5,
    secreto: SECRETO,
  });

  assert.equal(cupo.permitido, true);
  assert.equal(llamadas.length, 0);
});

test("la clave que viaja a la base va hasheada, no en claro", async () => {
  const { cliente, llamadas } = adminQueResponde({ permitido: true, intentos: 1 });

  await consumirCupo(cliente, {
    ruta: "/api/ventas/contacto",
    cabeceras: cabeceras({ "x-real-ip": "200.85.100.7" }),
    ventanaSegundos: 300,
    maximo: 5,
    secreto: SECRETO,
  });

  assert.equal(llamadas.length, 1);
  assert.ok(!String(llamadas[0].p_clave).includes("200.85.100.7"));
  assert.equal(String(llamadas[0].p_clave).length, 64);
});

// ============================================================
// La respuesta
// ============================================================

test("el 429 dice en cuántos segundos volver, y no en cero", async () => {
  const respuesta = respuestaSinCupo(
    { permitido: false, intentos: 6, maximo: 5, faltan_segundos: 0 },
    "Demasiados intentos.",
  );

  assert.equal(respuesta.status, 429);
  // Nunca 0: un Retry-After en cero invita a reintentar de inmediato, que es
  // justo lo que el límite quiere frenar.
  assert.equal(respuesta.headers.get("Retry-After"), "1");
  assert.equal(respuesta.headers.get("Cache-Control"), "no-store");

  const cuerpo = await respuesta.json();
  assert.equal(cuerpo.error, "Demasiados intentos.");
});
