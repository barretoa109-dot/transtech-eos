/**
 * ¿Una foto de la lista de precios carga el catálogo? (inicio-08 del tablero).
 *
 *     node --experimental-strip-types evals/bateria/foto-catalogo.mts
 *
 * Es lo que más frena a una cuenta nueva: cargar 200 productos a mano. La
 * meta de la tarea es "una foto de una lista de 20 productos crea los 20 con
 * precio". Esto lo mide SIN ejecutar nada: arma una lista de 20 productos como
 * imagen, se la manda al modelo con las mismas funciones del gateway y cuenta
 * cuántos productos pidió crear con el precio correcto.
 *
 * Tres versiones de la misma lista, de más fácil a más difícil: impresa y
 * derecha, impresa y torcida con poca luz (como sale una foto de celular), y
 * en dos columnas con precios abreviados ("45 mil", "1,2 M").
 *
 * Cuesta unos centavos por corrida.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import sharp from "sharp";

import { prepararEntrada } from "../../lib/gateway/entrada.ts";
import { armarPrompt } from "../../lib/gateway/prompt.ts";
import { prepararRespuesta } from "../../lib/gateway/respuesta.ts";
import { ESFUERZO, MODELO, PROMPT_SISTEMA } from "../../lib/gateway/sistema.ts";

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");

const LISTA: { nombre: string; precio: number; abreviado: string }[] = [
  { nombre: "Arroz 1 kg", precio: 9500, abreviado: "9.500" },
  { nombre: "Fideo tallarín 500 g", precio: 6000, abreviado: "6 mil" },
  { nombre: "Aceite de soja 900 ml", precio: 14500, abreviado: "14.500" },
  { nombre: "Azúcar 1 kg", precio: 7800, abreviado: "7.800" },
  { nombre: "Yerba mate 500 g", precio: 18000, abreviado: "18 mil" },
  { nombre: "Harina 000 1 kg", precio: 6500, abreviado: "6.500" },
  { nombre: "Leche entera 1 L", precio: 8200, abreviado: "8.200" },
  { nombre: "Café soluble 170 g", precio: 32000, abreviado: "32 mil" },
  { nombre: "Galletita surtida", precio: 5500, abreviado: "5.500" },
  { nombre: "Poroto 1 kg", precio: 16000, abreviado: "16 mil" },
  { nombre: "Sal fina 1 kg", precio: 3500, abreviado: "3.500" },
  { nombre: "Detergente 500 ml", precio: 9000, abreviado: "9 mil" },
  { nombre: "Jabón en polvo 800 g", precio: 21000, abreviado: "21 mil" },
  { nombre: "Papel higiénico x4", precio: 12500, abreviado: "12.500" },
  { nombre: "Gaseosa cola 2 L", precio: 15000, abreviado: "15 mil" },
  { nombre: "Agua mineral 2 L", precio: 7000, abreviado: "7 mil" },
  { nombre: "Cerveza lata 473 ml", precio: 8500, abreviado: "8.500" },
  { nombre: "Mortadela 1 kg", precio: 38000, abreviado: "38 mil" },
  { nombre: "Queso Paraguay 1 kg", precio: 45000, abreviado: "45 mil" },
  { nombre: "Garrafa de gas 10 kg", precio: 120000, abreviado: "120 mil" },
];

const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function svgUnaColumna(): string {
  const filas = LISTA.map(
    (p, i) =>
      `<text x="40" y="${130 + i * 42}" font-size="26" font-family="Arial">${escapar(p.nombre)}</text>` +
      `<text x="760" y="${130 + i * 42}" font-size="26" font-family="Arial" text-anchor="end">Gs. ${p.precio.toLocaleString("es-PY")}</text>`,
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${160 + LISTA.length * 42}">
<rect width="100%" height="100%" fill="white"/>
<text x="40" y="70" font-size="34" font-weight="bold" font-family="Arial">DESPENSA SAN BLAS - LISTA DE PRECIOS</text>
${filas}</svg>`;
}

function svgDosColumnas(): string {
  const mitad = Math.ceil(LISTA.length / 2);
  const col = (items: typeof LISTA, x: number) =>
    items
      .map(
        (p, i) =>
          `<text x="${x}" y="${120 + i * 48}" font-size="24" font-family="Georgia" font-style="italic">${escapar(p.nombre)} ..... ${p.abreviado}</text>`,
      )
      .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${150 + mitad * 48}">
<rect width="100%" height="100%" fill="#f3efe4"/>
<text x="30" y="60" font-size="30" font-family="Georgia">Precios (guaraníes)</text>
${col(LISTA.slice(0, mitad), 30)}${col(LISTA.slice(mitad), 570)}</svg>`;
}

async function imagenes(): Promise<{ id: string; base64: string; tipo: string }[]> {
  const derecha = await sharp(Buffer.from(svgUnaColumna())).png().toBuffer();
  // Como una foto de celular: torcida, más oscura, con ruido de compresión.
  const torcida = await sharp(derecha)
    .rotate(4, { background: "#b9b3a6" })
    .modulate({ brightness: 0.78 })
    .blur(0.6)
    .jpeg({ quality: 45 })
    .toBuffer();
  const dosColumnas = await sharp(Buffer.from(svgDosColumnas())).jpeg({ quality: 70 }).toBuffer();
  return [
    { id: "impresa", base64: derecha.toString("base64"), tipo: "image/png" },
    { id: "foto-torcida", base64: torcida.toString("base64"), tipo: "image/jpeg" },
    { id: "dos-columnas-abreviada", base64: dosColumnas.toString("base64"), tipo: "image/jpeg" },
  ];
}

function leerClave(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const m = fs.readFileSync(path.join(RAIZ, ".env.local"), "utf8").match(/^OPENAI_API_KEY=(.*)$/m);
  if (!m) throw new Error("Falta OPENAI_API_KEY.");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const normalizar = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function primeraPalabra(nombre: string): string {
  return normalizar(nombre).split(" ")[0];
}

async function probar(img: { id: string; base64: string; tipo: string }, clave: string) {
  const entrada = prepararEntrada({
    request_id: randomUUID(),
    usuario_id: randomUUID(),
    conversacion_id: randomUUID(),
    nombre: "Carmen",
    mensaje: "te paso mi lista de precios, cargá todos los productos",
    plan: "business",
    contexto_negocio: "Negocio: despensa de barrio en Lambaré.\nProductos: (todavía no cargó ninguno).",
    origen: "whatsapp",
    historial: [],
    archivo: { nombre: `${img.id}.${img.tipo.split("/")[1]}`, tipo: img.tipo, base64: img.base64, tamanio: img.base64.length },
    archivos: [{ nombre: img.id, tipo: img.tipo, base64: img.base64 }],
  });
  const { contenido } = armarPrompt(entrada);
  const comienzo = Date.now();
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
    body: JSON.stringify({
      model: modeloFoto,
      reasoning: { effort: ESFUERZO },
      input: [
        { role: "system", content: [{ type: "input_text", text: PROMPT_SISTEMA }] },
        { role: "user", content: contenido },
      ],
    }),
  });
  if (!r.ok) throw new Error(`OpenAI respondió ${r.status}`);
  const cuerpo = prepararRespuesta(entrada, await r.json());
  const ms = Date.now() - comienzo;

  const productos = cuerpo.acciones
    .filter((a) => String(a.tipo).toUpperCase() === "CREAR_PRODUCTO")
    .flatMap((a) => {
      const datos = (a.datos ?? {}) as Record<string, unknown>;
      return Array.isArray(datos.productos) ? (datos.productos as Record<string, unknown>[]) : [];
    });

  let conPrecioBien = 0;
  const mal: string[] = [];
  for (const esperado of LISTA) {
    const hallado = productos.find((p) => normalizar(String(p.nombre ?? "")).startsWith(primeraPalabra(esperado.nombre)));
    const precio = Number(hallado?.precio_venta);
    if (hallado && precio === esperado.precio) conPrecioBien += 1;
    else mal.push(`${esperado.nombre}: ${hallado ? `precio ${hallado.precio_venta}` : "no está"}`);
  }

  return { id: img.id, pedidos: productos.length, conPrecioBien, mal, ms, respuesta: cuerpo.respuesta };
}

/** `--modelo gpt-6-sol`: el modelo a medir (sin la bandera, el de producción). */
const modeloFoto = (() => {
  const i = process.argv.indexOf("--modelo");
  return i >= 0 ? (process.argv[i + 1] ?? MODELO) : MODELO;
})();

/*
 * `--achicar`: cada imagen se agranda primero a 4000 px (como sale de la cámara
 * de un celular) y después pasa por `achicarImagen`, que es lo que hace el
 * webhook de WhatsApp desde el 29/09 (encargado-11). Mide que achicar no le
 * haga perder lectura al modelo.
 */
async function comoLlegaDeWhatsapp(img: { id: string; base64: string; tipo: string }) {
  const { achicarImagen } = await import("../../lib/whatsapp/achicar.ts");
  const deCamara = await sharp(Buffer.from(img.base64, "base64")).resize({ width: 4000 }).jpeg({ quality: 92 }).toBuffer();
  const r = await achicarImagen(deCamara, "image/jpeg");
  console.log(`${img.id}: ${Math.round(deCamara.length / 1024)} KB de cámara → ${Math.round(r.bytes.length / 1024)} KB`);
  return { id: `${img.id}-achicada`, base64: r.bytes.toString("base64"), tipo: r.tipo };
}

const clave = leerClave();
const achicar = process.argv.includes("--achicar");
const resultados = [];
for (const img of await imagenes()) resultados.push(await probar(achicar ? await comoLlegaDeWhatsapp(img) : img, clave));

const lineas = [
  `# Catálogo desde una foto — ${new Date().toISOString().slice(0, 10)}`,
  "",
  `Modelo \`${modeloFoto}\` · esfuerzo \`${ESFUERZO}\`. Lista de ${LISTA.length} productos. Meta (inicio-08): los ${LISTA.length} con su precio.`,
  "",
  "| Imagen | Productos pedidos | Con el precio correcto | Tiempo |",
  "|---|---|---|---|",
  ...resultados.map((r) => `| ${r.id} | ${r.pedidos} | ${r.conPrecioBien}/${LISTA.length} | ${(r.ms / 1000).toFixed(1)} s |`),
  "",
  ...resultados.flatMap((r) => [
    `## ${r.id}`,
    "",
    `Respuesta: «${r.respuesta.replace(/\s*\n+\s*/g, " ⏎ ")}»`,
    "",
    ...(r.mal.length ? r.mal.map((m) => `- ${m}`) : ["Todos bien."]),
    "",
  ]),
];

const carpeta = path.join(RAIZ, "evals", "bateria", "resultados");
fs.mkdirSync(carpeta, { recursive: true });
const archivo = path.join(carpeta, `${new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "")}-foto-catalogo-${modeloFoto}.md`);
fs.writeFileSync(archivo, lineas.join("\n"));
console.log(lineas.join("\n"));
console.log(`Guardado en ${path.relative(RAIZ, archivo)}`);
