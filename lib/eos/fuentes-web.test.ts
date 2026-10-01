import assert from "node:assert/strict";
import { test } from "node:test";

import { leerRespuestaConFuentes, partirCitas, respuestaParaWhatsapp } from "./fuentes-web.ts";

const RESPUESTA = [
  "🔎 Busqué en la web el 01/10/2026.",
  "",
  "Cerdo vivo: ₲7.000–7.500/kg [1] y ₲8.750/kg en frigoríficos [2].",
  "",
  "Mi lectura: tu precio está arriba [1][2].",
  "",
  "Fuentes:",
  "[1] Gremio porcino alerta sobre contrabando — La Tribuna — latribuna.com.py",
  "https://www.latribuna.com.py/economia/gremio",
  "[2] Contrabando de cerdos — ABC Color — abc.com.py",
  "https://www.abc.com.py/economia/cerdos",
].join("\n");

test("separa encabezado, cuerpo y fuentes", () => {
  const r = leerRespuestaConFuentes(RESPUESTA);
  assert.ok(r);
  assert.equal(r.fecha, "01/10/2026");
  assert.equal(r.lugar, null);
  assert.equal(r.fuentes.length, 2);
  assert.deepEqual(r.fuentes[0], {
    n: 1,
    titulo: "Gremio porcino alerta sobre contrabando — La Tribuna",
    sitio: "latribuna.com.py",
    url: "https://www.latribuna.com.py/economia/gremio",
  });
  assert.doesNotMatch(r.cuerpo, /Busqué|Fuentes|https/);
});

test("lee también las respuestas viejas, con el país; y por WhatsApp no lo muestra", () => {
  for (const encabezado of ["🔎 Busqué en la web el 01/10/2026 · Paraguay.", "🔎 Busqué en la web el 01/10/2026 (Paraguay)."]) {
    const vieja = RESPUESTA.replace("🔎 Busqué en la web el 01/10/2026.", encabezado);
    const r = leerRespuestaConFuentes(vieja);
    assert.equal(r?.fecha, "01/10/2026");
    assert.doesNotMatch(r?.cuerpo ?? "", /Busqué/);
    assert.doesNotMatch(respuestaParaWhatsapp(vieja).split("\n")[0], /Paraguay/);
  }
});

test("un mensaje común no se toca", () => {
  assert.equal(leerRespuestaConFuentes("Registré la venta de 3 bolsas."), null);
  assert.equal(leerRespuestaConFuentes("Fuentes:\nninguna"), null);
});

test("las citas se separan del texto, solo las que existen", () => {
  const t = partirCitas("a ₲58.000 [1][2] y [9].", new Set([1, 2]));
  assert.deepEqual(t, [
    { tipo: "texto", texto: "a ₲58.000" },
    { tipo: "cita", n: 1 },
    { tipo: "cita", n: 2 },
    { tipo: "texto", texto: " y [9]." },
  ]);
});

test("WhatsApp: sin corchetes ni paréntesis, citas en superíndice y fuentes con enlace", () => {
  const w = respuestaParaWhatsapp(RESPUESTA);
  assert.doesNotMatch(w, /\[\d\]/);
  assert.doesNotMatch(w, /\(Paraguay\)/);
  assert.match(w, /₲7\.000–7\.500\/kg¹ y ₲8\.750\/kg en frigoríficos²\./);
  assert.match(w, /arriba¹²\./);
  assert.match(w, /\*Fuentes\*\n¹ Gremio porcino alerta sobre contrabando — La Tribuna · latribuna\.com\.py\nhttps:\/\/www\.latribuna\.com\.py\/economia\/gremio/);
  assert.equal(respuestaParaWhatsapp("hola"), "hola");
});
