import assert from "node:assert/strict";
import test from "node:test";

import { administrarCanal, conectarCanal, validarAjustes, validarConexion, type DatosConexion } from "./canal.ts";
import { baseFalsa } from "./base-falsa.ts";
import type { Fetcher } from "./meta.ts";

const TOKEN = "EAAG" + "x".repeat(40);
const USUARIO = "u-1";

const datos: DatosConexion = {
  phone_number_id: "123456789",
  waba_id: "987654321",
  token: TOKEN,
  app_secret: null,
  nombre_visible: null,
};

/** Meta respondiendo bien: el número existe y el token sirve. */
const metaOk: Fetcher = (async () =>
  new Response(JSON.stringify({ id: "123456789", display_phone_number: "+595 987 506802", verified_name: "Molino Sur" }), {
    status: 200,
  })) as unknown as Fetcher;

const metaRechaza: Fetcher = (async () =>
  new Response(JSON.stringify({ error: { code: 190, message: "expired" } }), { status: 401 })) as unknown as Fetcher;

// -------------------------------------------------------------- validación

test("los datos correctos pasan y se limpian", () => {
  const r = validarConexion({ phone_number_id: " 123456789 ", waba_id: "987654321", token: ` ${TOKEN} `, nombre_visible: " Mi negocio " });
  assert.ok(r.ok);
  assert.equal(r.datos.phone_number_id, "123456789");
  assert.equal(r.datos.token, TOKEN);
  assert.equal(r.datos.nombre_visible, "Mi negocio");
});

test("un ID que no son dígitos se rechaza con qué hacer", () => {
  const r = validarConexion({ phone_number_id: "+595 987", token: TOKEN });
  assert.ok(!r.ok);
  assert.equal(r.campo, "phone_number_id");
  assert.match(r.error, /Configuración de la API/);
});

test("un token cortado o con espacios se rechaza", () => {
  for (const token of ["corto", "EAAG con espacios en el medio de un token largo", ""]) {
    const r = validarConexion({ phone_number_id: "123456789", token });
    assert.ok(!r.ok, token);
    assert.equal(r.campo, "token");
  }
});

test("el secreto de la app y el ID de la cuenta son opcionales, pero si vienen se validan", () => {
  assert.ok(validarConexion({ phone_number_id: "123456789", token: TOKEN }).ok);
  assert.ok(!validarConexion({ phone_number_id: "123456789", token: TOKEN, app_secret: "corto" }).ok);
  assert.ok(!validarConexion({ phone_number_id: "123456789", token: TOKEN, waba_id: "abc" }).ok);
});

test("los ajustes se validan uno por uno y con su rango", () => {
  assert.deepEqual(validarAjustes({ limite_diario: 500, silencio_desde_hora: "22", respuesta_automatica: true }), {
    ok: true,
    datos: { limite_diario: 500, silencio_desde_hora: 22, respuesta_automatica: true },
  });

  for (const malo of [{ limite_diario: 0 }, { limite_diario: 1e9 }, { limite_por_contacto_dia: 11 }, { silencio_hasta_hora: 24 }, { limite_diario: 1.5 }, { respuesta_automatica: "si" }]) {
    assert.ok(!validarAjustes(malo).ok, JSON.stringify(malo));
  }
  assert.ok(!validarAjustes({}).ok);
});

// ------------------------------------------------------------------ conectar

test("conectar un número nuevo: prueba el token, crea el canal, guarda el secreto y asienta el evento", async () => {
  const { admin, pedidos } = baseFalsa({
    "eos_wa_canales.select": { data: null, error: null },
    "eos_wa_canales.insert": { data: { id: "canal-1" }, error: null },
    "rpc:eos_wa_guardar_secreto_v185": { data: "ref", error: null },
  });

  const r = await conectarCanal(admin, USUARIO, datos, metaOk);

  assert.ok(r.ok);
  assert.equal(r.canal.id, "canal-1");
  assert.equal(r.canal.telefono, "595987506802");
  assert.equal(r.canal.nombre, "Molino Sur");
  assert.equal(r.canal.estado, "activo");
  assert.match(r.canal.verify_token, /^[0-9a-f]{48}$/);

  const insert = pedidos.find((p) => p.clave === "eos_wa_canales.insert")!;
  const fila = insert.payload as Record<string, unknown>;
  assert.equal(fila.usuario_id, USUARIO);
  assert.equal(fila.estado, "activo");
  // EL PUNTO: el token NO va a la tabla.
  assert.ok(!JSON.stringify(insert.payload).includes(TOKEN));

  const guardado = pedidos.find((p) => p.clave === "rpc:eos_wa_guardar_secreto_v185")!;
  assert.deepEqual(guardado.args, { p_canal_id: "canal-1", p_valor: TOKEN, p_tipo: "token" });
  assert.ok(pedidos.some((p) => p.clave === "eos_wa_eventos.insert"));
});

test("si Meta rechaza el token NO se guarda nada", async () => {
  const { admin, pedidos } = baseFalsa({ "eos_wa_canales.select": { data: null, error: null } });
  const r = await conectarCanal(admin, USUARIO, datos, metaRechaza);

  assert.ok(!r.ok);
  assert.equal(r.estado, 400);
  assert.match(r.error, /token de acceso venció/);
  assert.ok(!pedidos.some((p) => p.clave.startsWith("eos_wa_canales.insert") || p.clave.startsWith("rpc:")));
});

test("un número que ya es de OTRA cuenta no se puede conectar", async () => {
  const { admin, pedidos } = baseFalsa({ "eos_wa_canales.select": { data: { id: "c", usuario_id: "otro-usuario" }, error: null } });
  const r = await conectarCanal(admin, USUARIO, datos, metaOk);

  assert.ok(!r.ok);
  assert.equal(r.estado, 409);
  assert.match(r.error, /otra cuenta/);
  // Ni siquiera se le pega a Meta ni se toca la tabla.
  assert.ok(!pedidos.some((p) => p.clave.includes("insert") || p.clave.includes("update")));
});

test("volver a conectar el mismo número actualiza el canal y renueva el secreto", async () => {
  const { admin, pedidos } = baseFalsa({
    "eos_wa_canales.select": { data: { id: "canal-1", usuario_id: USUARIO }, error: null },
    "rpc:eos_wa_guardar_secreto_v185": { data: "ref", error: null },
  });

  const r = await conectarCanal(admin, USUARIO, datos, metaOk);
  assert.ok(r.ok);
  assert.equal(r.canal.id, "canal-1");
  assert.ok(!pedidos.some((p) => p.clave === "eos_wa_canales.insert"));

  const actualiza = pedidos.find((p) => p.clave === "eos_wa_canales.update")!;
  // Y solo si es SUYO.
  assert.ok(actualiza.filtros.some((f) => f.metodo === "eq" && f.args[0] === "usuario_id" && f.args[1] === USUARIO));
});

test("con secreto de app, se guardan los dos", async () => {
  const { admin, pedidos } = baseFalsa({
    "eos_wa_canales.select": { data: null, error: null },
    "eos_wa_canales.insert": { data: { id: "canal-1" }, error: null },
    "rpc:eos_wa_guardar_secreto_v185": { data: "ref", error: null },
  });
  await conectarCanal(admin, USUARIO, { ...datos, app_secret: "appsecret" + "c".repeat(30) }, metaOk);

  const tipos = pedidos.filter((p) => p.clave === "rpc:eos_wa_guardar_secreto_v185").map((p) => (p.args as { p_tipo: string }).p_tipo);
  assert.deepEqual(tipos, ["token", "app"]);
});

test("si Vault falla, el canal recién creado se borra: no queda una fila a medias", async () => {
  const { admin, pedidos } = baseFalsa({
    "eos_wa_canales.select": { data: null, error: null },
    "eos_wa_canales.insert": { data: { id: "canal-1" }, error: null },
    "rpc:eos_wa_guardar_secreto_v185": { data: null, error: { message: "vault caído" } },
  });

  const r = await conectarCanal(admin, USUARIO, datos, metaOk);
  assert.ok(!r.ok);
  assert.match(r.error, /No se conectó nada/);
  assert.ok(pedidos.some((p) => p.clave === "eos_wa_canales.delete"));
  assert.ok(!pedidos.some((p) => p.clave === "eos_wa_eventos.insert"));
});

// ---------------------------------------------------------------- administrar

const canalPropio = (extra: Record<string, unknown> = {}) => ({
  "eos_wa_canales.select": { data: { id: "canal-1", estado: "activo", secreto_ref: "ref", ...extra }, error: null },
});

test("pausar cambia el estado y lo asienta", async () => {
  const { admin, pedidos } = baseFalsa(canalPropio());
  const r = await administrarCanal(admin, USUARIO, "canal-1", { accion: "pausar" });

  assert.ok(r.ok);
  assert.equal(r.canal.estado, "pausado");
  assert.deepEqual((pedidos.find((p) => p.clave === "eos_wa_canales.update")!.payload as { estado: string }).estado, "pausado");
  const ev = pedidos.find((p) => p.clave === "eos_wa_eventos.insert")!;
  assert.equal((ev.payload as { evento: string }).evento, "canal_pausado");
});

test("un canal ajeno o inexistente responde 404, sin distinguir", async () => {
  const { admin } = baseFalsa({ "eos_wa_canales.select": { data: null, error: null } });
  const r = await administrarCanal(admin, USUARIO, "ajeno", { accion: "pausar" });
  assert.ok(!r.ok);
  assert.equal(r.estado, 404);
});

test("toda consulta de administrar lleva el dueño como filtro", async () => {
  const { admin, pedidos } = baseFalsa(canalPropio());
  await administrarCanal(admin, USUARIO, "canal-1", { accion: "pausar" });

  for (const p of pedidos.filter((x) => x.clave.startsWith("eos_wa_canales."))) {
    assert.ok(p.filtros.some((f) => f.metodo === "eq" && f.args[0] === "usuario_id" && f.args[1] === USUARIO), p.clave);
  }
});

test("reanudar exige que el acceso de Meta esté guardado", async () => {
  const { admin } = baseFalsa(canalPropio({ estado: "pausado", secreto_ref: null }));
  const r = await administrarCanal(admin, USUARIO, "canal-1", { accion: "reanudar" });
  assert.ok(!r.ok);
  assert.equal(r.estado, 409);
  assert.match(r.error, /Conectalo de nuevo/);
});

test("reanudar con acceso guardado lo deja activo", async () => {
  const { admin } = baseFalsa(canalPropio({ estado: "pausado" }));
  const r = await administrarCanal(admin, USUARIO, "canal-1", { accion: "reanudar" });
  assert.ok(r.ok && r.canal.estado === "activo");
});

test("desconectar borra los secretos ANTES de marcarlo desconectado, y conserva el historial", async () => {
  const { admin, pedidos } = baseFalsa({ ...canalPropio(), "rpc:eos_wa_borrar_secreto_v185": { data: true, error: null } });
  const r = await administrarCanal(admin, USUARIO, "canal-1", { accion: "desconectar" });

  assert.ok(r.ok && r.canal.estado === "desconectado");
  const orden = pedidos.map((p) => p.clave);
  assert.ok(orden.indexOf("rpc:eos_wa_borrar_secreto_v185") < orden.indexOf("eos_wa_canales.update"));
  // Nada de borrar mensajes ni clientes.
  assert.ok(!orden.some((c) => c.startsWith("eos_wa_mensajes") || c.startsWith("eos_crm_contactos")));
});

test("si no se pudieron borrar los secretos, NO se marca desconectado", async () => {
  const { admin, pedidos } = baseFalsa({ ...canalPropio(), "rpc:eos_wa_borrar_secreto_v185": { data: null, error: { message: "x" } } });
  const r = await administrarCanal(admin, USUARIO, "canal-1", { accion: "desconectar" });

  assert.ok(!r.ok);
  assert.ok(!pedidos.some((p) => p.clave === "eos_wa_canales.update"));
});

test("configurar guarda solo los ajustes validados", async () => {
  const { admin, pedidos } = baseFalsa(canalPropio());
  const r = await administrarCanal(admin, USUARIO, "canal-1", { accion: "configurar", ajustes: { limite_diario: 500 } });

  assert.ok(r.ok);
  const cambios = pedidos.find((p) => p.clave === "eos_wa_canales.update")!.payload as Record<string, unknown>;
  assert.equal(cambios.limite_diario, 500);
});
