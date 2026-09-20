import assert from "node:assert/strict";
import test from "node:test";

import {
  consultarPlantilla,
  crearPlantilla,
  enviarPlantilla,
  enviarTexto,
  estadoDePlantilla,
  verificarCredenciales,
  type Fetcher,
} from "./meta.ts";

type Llamada = { url: string; init: RequestInit };

/** Un `fetch` que devuelve lo que se le diga y anota a qué se le pegó. */
function falso(status: number, cuerpo: unknown): { fetcher: Fetcher; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    llamadas.push({ url: String(url), init });
    return new Response(cuerpo === null ? "" : JSON.stringify(cuerpo), { status });
  }) as unknown as Fetcher;
  return { fetcher, llamadas };
}

const TOKEN = "EAAG" + "x".repeat(40);

test("verificar credenciales devuelve el número y el nombre verificado", async () => {
  const { fetcher, llamadas } = falso(200, {
    id: "123456",
    display_phone_number: "+595 987 506802",
    verified_name: "Molino Sur",
    quality_rating: "GREEN",
  });

  const r = await verificarCredenciales(TOKEN, "123456", fetcher);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.datos.verified_name, "Molino Sur");
  assert.match(llamadas[0].url, /graph\.facebook\.com\/v21\.0\/123456\?fields=/);
  assert.equal((llamadas[0].init.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
});

test("un token vencido se explica en castellano y no es transitorio", async () => {
  const { fetcher } = falso(401, { error: { code: 190, message: "Error validating access token" } });
  const r = await verificarCredenciales(TOKEN, "123456", fetcher);

  assert.equal(r.ok, false);
  assert.ok(!r.ok);
  assert.match(r.mensaje, /token de acceso venció/);
  assert.equal(r.transitorio, false);
  assert.equal(r.codigo, 190);
});

test("enviar texto arma el cuerpo de la API con solo dígitos y devuelve el id de Meta", async () => {
  const { fetcher, llamadas } = falso(200, { messages: [{ id: "wamid.ABC" }] });
  const r = await enviarTexto(TOKEN, "123456", "+595 981 123-456", "Hola Carlos", fetcher);

  assert.deepEqual(r, { ok: true, datos: { wa_message_id: "wamid.ABC" } });
  const cuerpo = JSON.parse(String(llamadas[0].init.body));
  assert.equal(cuerpo.to, "595981123456");
  assert.equal(cuerpo.type, "text");
  assert.equal(cuerpo.text.body, "Hola Carlos");
  assert.equal(cuerpo.text.preview_url, false);
  assert.match(llamadas[0].url, /\/123456\/messages$/);
});

test("un 200 SIN id de mensaje no se toma como enviado", async () => {
  const { fetcher } = falso(200, { messages: [] });
  const r = await enviarTexto(TOKEN, "123456", "595981123456", "Hola", fetcher);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.transitorio);
});

test("fuera de la ventana de 24 horas se explica qué hacer", async () => {
  const { fetcher } = falso(400, { error: { code: 131047, message: "Re-engagement message" } });
  const r = await enviarTexto(TOKEN, "123456", "595981123456", "Hola", fetcher);
  assert.ok(!r.ok);
  assert.match(r.mensaje, /plantilla aprobada/);
  assert.equal(r.transitorio, false);
});

test("los límites de Meta son transitorios; un rechazo de contenido, no", async () => {
  const limite = await enviarTexto(TOKEN, "1", "595981123456", "Hola", falso(400, { error: { code: 130429 } }).fetcher);
  assert.ok(!limite.ok && limite.transitorio);

  const contenido = await enviarTexto(TOKEN, "1", "595981123456", "Hola", falso(400, { error: { code: 132007 } }).fetcher);
  assert.ok(!contenido.ok && !contenido.transitorio);
});

test("un 500 de Meta es transitorio; un 400 desconocido muestra lo que dijo Meta, recortado", async () => {
  const caido = await enviarTexto(TOKEN, "1", "595981123456", "Hola", falso(503, null).fetcher);
  assert.ok(!caido.ok && caido.transitorio);

  const raro = await enviarTexto(
    TOKEN, "1", "595981123456", "Hola",
    falso(400, { error: { code: 999999, message: "x".repeat(400) } }).fetcher,
  );
  assert.ok(!raro.ok);
  assert.ok(raro.mensaje.length < 190);
  assert.match(raro.mensaje, /^Meta respondió: x+/);
});

test("si la red falla o se agota el tiempo, es transitorio y no lanza", async () => {
  const cortado = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as Fetcher;
  const r1 = await enviarTexto(TOKEN, "1", "595981123456", "Hola", cortado);
  assert.ok(!r1.ok && r1.transitorio);

  const lento = (async () => {
    const e = new Error("agotado");
    e.name = "TimeoutError";
    throw e;
  }) as unknown as Fetcher;
  const r2 = await enviarTexto(TOKEN, "1", "595981123456", "Hola", lento);
  assert.ok(!r2.ok && /tardó demasiado/.test(r2.mensaje));
});

test("una plantilla con variables manda los parámetros del cuerpo", async () => {
  const { fetcher, llamadas } = falso(200, { messages: [{ id: "wamid.T" }] });
  await enviarPlantilla(TOKEN, "123456", "595981123456", { nombre: "seguimiento_propuesta", idioma: "es", variables: ["Carlos", "Gs. 3.500.000"] }, fetcher);

  const t = JSON.parse(String(llamadas[0].init.body)).template;
  assert.equal(t.name, "seguimiento_propuesta");
  assert.equal(t.language.code, "es");
  assert.deepEqual(t.components[0].parameters, [
    { type: "text", text: "Carlos" },
    { type: "text", text: "Gs. 3.500.000" },
  ]);
});

test("una plantilla sin variables no manda componentes", async () => {
  const { fetcher, llamadas } = falso(200, { messages: [{ id: "wamid.T" }] });
  await enviarPlantilla(TOKEN, "1", "595981123456", { nombre: "hola", idioma: "es", variables: [] }, fetcher);
  assert.equal(JSON.parse(String(llamadas[0].init.body)).template.components, undefined);
});

test("crear una plantilla la manda a la WABA con su categoría y sus ejemplos", async () => {
  const { fetcher, llamadas } = falso(200, { id: "tpl-1", status: "PENDING" });
  const r = await crearPlantilla(
    TOKEN, "waba-9",
    { nombre: "seguimiento", idioma: "es", categoria: "utilidad", cuerpo: "Hola {{1}}, ¿pudiste ver la propuesta?", ejemplos: ["Carlos"] },
    fetcher,
  );

  assert.deepEqual(r, { ok: true, datos: { id: "tpl-1", status: "PENDING" } });
  const c = JSON.parse(String(llamadas[0].init.body));
  assert.equal(c.category, "UTILITY");
  assert.equal(c.components[0].type, "BODY");
  assert.deepEqual(c.components[0].example.body_text, [["Carlos"]]);
  assert.match(llamadas[0].url, /\/waba-9\/message_templates$/);
});

test("consultar una plantilla devuelve la del nombre pedido, o null si no está", async () => {
  const { fetcher } = falso(200, { data: [{ id: "1", name: "otra", status: "APPROVED" }, { id: "2", name: "seguimiento", status: "APPROVED" }] });
  const ok = await consultarPlantilla(TOKEN, "waba-9", "seguimiento", fetcher);
  assert.ok(ok.ok && ok.datos?.id === "2");

  const vacia = await consultarPlantilla(TOKEN, "waba-9", "no_esta", falso(200, { data: [] }).fetcher);
  assert.ok(vacia.ok && vacia.datos === null);
});

test("el estado de Meta se traduce al de la tabla; lo desconocido NO se usa", () => {
  assert.equal(estadoDePlantilla("APPROVED"), "aprobada");
  assert.equal(estadoDePlantilla("REJECTED"), "rechazada");
  assert.equal(estadoDePlantilla("PAUSED"), "pausada");
  assert.equal(estadoDePlantilla("DISABLED"), "pausada");
  assert.equal(estadoDePlantilla("PENDING"), "en_revision");
  assert.equal(estadoDePlantilla("ALGO_NUEVO"), "en_revision");
});

test("el ID del número se escapa: no se puede inyectar una ruta", async () => {
  const { fetcher, llamadas } = falso(200, { id: "x", display_phone_number: "", verified_name: "" });
  await verificarCredenciales(TOKEN, "1/../me?x=", fetcher);
  assert.doesNotMatch(llamadas[0].url, /\/\.\.\//);
  assert.match(llamadas[0].url, /1%2F\.\.%2Fme%3Fx%3D/);
});
