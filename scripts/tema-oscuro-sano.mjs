/**
 * Que el modo oscuro no se rompa de a un color por vez.
 *
 *     npm run tema
 *
 * El modo oscuro de EOS funciona porque casi todos los colores de
 * `eosApp.css` salen de un token, y los tokens se redefinen en el bloque
 * `[data-eos-theme="dark"]`. Un `#fff` escrito a mano en una regla nueva no
 * rompe nada en claro —se ve idéntico— y deja una mancha blanca en una
 * pantalla negra que nadie va a notar hasta que un usuario la reporte.
 *
 * Este script busca eso: colores literales, en propiedades que se ven, fuera
 * de los dos bloques donde los literales SÍ corresponden.
 *
 * Las excepciones van abajo con su motivo escrito. Son pocas y son reales; si
 * la lista crece hasta la decena, lo que hay que revisar es la lista, no
 * agregarle una fila más.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOJA = path.join(RAIZ, "app/eos/chat/eosApp.css");

/**
 * Los componentes del shell que traen su CSS adentro, en `<style jsx>`.
 *
 * ============================================================
 * ESTE CANDADO YA FALLÓ UNA VEZ, POR MIRAR UN SOLO ARCHIVO
 * ============================================================
 *
 * La primera versión revisaba `eosApp.css` y decía "modo oscuro sano". El
 * mismo día, una usuaria reportó que en oscuro **no se veían las respuestas de
 * EOS**: `MessageBubble.tsx` estila las burbujas con styled-jsx y tenía
 * `color: #172033` escrito a mano — casi negro, sobre el panel oscuro.
 *
 * El candado no lo vio porque ese color no está en la hoja que miraba. Dar por
 * sano lo que no se revisó es peor que no revisar: el "sano" se cree.
 *
 * Se listan los archivos y no se busca `<style jsx>` por todo el árbol a
 * propósito: `app/eos/autonomy/page.tsx` y `app/eos/page.tsx` son páginas con
 * su propio fondo oscuro fijo, no viven adentro de `.eos-app` y sus colores
 * literales son correctos ahí. Una lista corta con el motivo escrito es más
 * honesta que una regla que después hay que llenar de excepciones.
 */
const CON_STYLED_JSX = [
  "app/eos/components/MessageBubble.tsx",
  "app/eos/components/DecisionsView.tsx",
  "app/eos/components/LearningsView.tsx",
];

/**
 * Lo que puede quedar escrito a mano, y por qué.
 *
 * La clave es la declaración COMPLETA, no el número de línea: una línea se
 * mueve con cualquier edición de arriba y la excepción dejaría de aplicar
 * justo cuando se agrega código nuevo.
 */
const PERMITIDAS = new Map([
  [
    "background: radial-gradient(circle at 30% 30%, #a9c6ee, #113f8c 70%)",
    "Una de las manchas de aurora del fondo. Es decoración con desenfoque, no una superficie con texto encima.",
  ],
  [
    "background: linear-gradient(180deg, rgba(255, 255, 255, 0), #fff 30%)",
    "El degradado que funde la lista de mensajes con el compositor. Tiene su propia regla en el bloque oscuro.",
  ],
  [
    "color: var(--ink, #111)",
    "Respaldo de un token que siempre está definido: el literal no llega a usarse nunca.",
  ],
  [
    "color: var(--red, #dc2626)",
    "Igual que el anterior: `--red` existe en los dos temas.",
  ],
  [
    "background: #a9c8f0",
    "Un tramo de la barra de composición del gasto. Son los colores de los DATOS, no de la interfaz: distinguen categorías entre sí y se leen igual sobre cualquier fondo.",
  ],
  [
    "background: #cbd5e1",
    'El tramo "otros" de la misma barra. Mismo motivo.',
  ],
]);

function luminancia(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  const canales = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => {
    const v = x / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * canales[0] + 0.7152 * canales[1] + 0.0722 * canales[2];
}

const problemas = [];
const permitidasVistas = new Set();

/**
 * Revisa un archivo: la hoja del shell, o un componente con su CSS adentro.
 *
 * `conBloques` solo aplica a la hoja: es la que tiene el bloque de tokens y el
 * bloque oscuro, que son los dos lugares donde un literal SÍ corresponde. Un
 * componente no tiene ninguno de los dos, así que ahí todo literal es
 * sospechoso.
 */
function revisar(rutaRelativa, { conBloques }) {
  const lineas = fs.readFileSync(path.join(RAIZ, rutaRelativa), "utf8").split(/\r?\n/);

  let enTokens = false;
  let enOscuro = false;

  lineas.forEach((linea, i) => {
    if (conBloques) {
      if (/^\.eos-app \{/.test(linea)) enTokens = true;
      if (enTokens && /--ease:/.test(linea)) enTokens = false;
      if (/\[data-eos-theme="dark"\]/.test(linea)) enOscuro = true;
      if (enOscuro && /^\}/.test(linea)) enOscuro = false;
      if (enTokens || enOscuro) return;
    }

    const m = linea.match(/^\s*(background|background-color|color|border-color|fill|stroke)\s*:\s*(.+);\s*$/);
    if (!m) return;

    const [, propiedad, valor] = m;
    const hex = valor.match(/#[0-9a-fA-F]{3,6}\b/);
    if (!hex) return;

    const declaracion = `${propiedad}: ${valor.trim()}`;
    if (PERMITIDAS.has(declaracion)) {
      permitidasVistas.add(declaracion);
      return;
    }

    const L = luminancia(hex[0]);
    const esTexto = propiedad === "color" || propiedad === "fill" || propiedad === "stroke";

    // Un color claro como FONDO es una mancha en la pantalla oscura.
    if (L > 0.5 && !esTexto) {
      problemas.push({ archivo: rutaRelativa, n: i + 1, declaracion, motivo: "fondo claro escrito a mano" });
    }

    // Un color oscuro como TEXTO se pierde sobre el panel oscuro.
    if (L < 0.25 && esTexto) {
      problemas.push({ archivo: rutaRelativa, n: i + 1, declaracion, motivo: "texto oscuro escrito a mano" });
    }
  });
}

revisar(path.relative(RAIZ, HOJA).split(path.sep).join("/"), { conBloques: true });
for (const componente of CON_STYLED_JSX) revisar(componente, { conBloques: false });

const huerfanas = [...PERMITIDAS.keys()].filter((k) => !permitidasVistas.has(k));

if (problemas.length === 0 && huerfanas.length === 0) {
  console.log(`Modo oscuro sano: ni en la hoja del shell ni en los ${CON_STYLED_JSX.length} componentes con styled-jsx.`);
  process.exit(0);
}

for (const p of problemas) {
  console.error(`  ${p.archivo}:${p.n}  ${p.motivo}: ${p.declaracion}`);
}

if (problemas.length > 0) {
  console.error(
    `\n${problemas.length} color(es) escrito(s) a mano en una propiedad visible.\n` +
      "En claro se ven bien y en oscuro no. Usá el token que corresponda —o, si de\n" +
      "verdad tiene que ser literal, agregalo a PERMITIDAS en este archivo con el\n" +
      "motivo escrito.",
  );
}

// Una excepción que ya no coincide con nada es una excepción que quedó
// tapando un caso que se movió o se corrigió. Se avisa para sacarla.
for (const h of huerfanas) {
  console.error(`\n  excepción sin uso: "${h}" — ya no está en la hoja; sacala de PERMITIDAS.`);
}

process.exit(1);
