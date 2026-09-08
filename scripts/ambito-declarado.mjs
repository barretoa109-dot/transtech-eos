/**
 * Ninguna consulta a la plata puede omitir de quién es.
 *
 *     npm run ambito
 *
 * ============================================================
 * QUÉ PROTEGE
 * ============================================================
 *
 * `eos_movimientos_financieros` y `eos_finanzas_fijos` guardan dos cosas que
 * no se pueden mezclar: la plata del NEGOCIO —ventas, compras, el sueldo del
 * capataz— y la de la PERSONA —el alquiler, el almuerzo, su sueldo—.
 *
 * Desde la v136 las separa la columna `ambito`, y cada consulta declara cuál
 * de las dos mira. Una consulta sin ese filtro no falla ni avisa: devuelve las
 * dos cosas sumadas. El panel que contesta "¿estoy bien?" pasa a incluir la
 * inversión de un negocio, y el resultado del mes del negocio pasa a incluir
 * el sueldo de la persona. Los dos números quedan mal y los dos siguen
 * pareciendo números.
 *
 * Pasó de verdad el 7 de septiembre de 2026, antes de que existiera la
 * columna: los ₲ 2.638.000 de una compra de lechones aterrizaron en el panel
 * de finanzas personales.
 *
 * ============================================================
 * CÓMO LO REVISA
 * ============================================================
 *
 * Aísla cada cadena que arranca en `.from("<tabla>")` y exige que dentro de
 * ella aparezca un `.eq("ambito", …)`. Los `insert` quedan exentos: la columna
 * tiene default y un trigger que fuerza `negocio` a todo lo que viene del ERP.
 */

import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
);

const TABLAS = [
  "eos_movimientos_financieros",
  "eos_finanzas_fijos",
  // Desde la v143. La posición del negocio leía `eos_finanzas_deudas` sin
  // filtro y sumaba el préstamo del auto de la persona a su pasivo corriente.
  "eos_finanzas_cuentas",
  "eos_finanzas_deudas",
  // Desde la v145. Una camioneta puede ser del negocio o de la persona, y de
  // esa diferencia depende en qué patrimonio aparece.
  "eos_finanzas_activos",
  // Desde la v144. Un objetivo del negocio no va en el panel de la persona.
  "eos_goals",
  // Desde la v146. Las compras quedan afuera: heredan el ámbito de su tarjeta.
  "eos_finanzas_tarjetas",
];
const CARPETAS = ["app", "lib"];

/** Hasta dónde llega una cadena: el `.from(` siguiente, o el fin del statement. */
const LARGO_DE_CADENA = 12;

function archivos(dir, encontrados = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === "node_modules" || entrada.name === ".next") continue;
      archivos(completo, encontrados);
    } else if (/\.tsx?$/.test(entrada.name) && !entrada.name.includes(".test.")) {
      encontrados.push(completo);
    }
  }
  return encontrados;
}

const problemas = [];
let revisadas = 0;

for (const carpeta of CARPETAS) {
  const base = path.join(RAIZ, carpeta);
  if (!fs.existsSync(base)) continue;

  for (const archivo of archivos(base)) {
    const lineas = fs.readFileSync(archivo, "utf8").split(/\r?\n/);

    for (let i = 0; i < lineas.length; i += 1) {
      const tabla = TABLAS.find((t) => lineas[i].includes(`from("${t}")`));
      if (!tabla) continue;

      const cadena = lineas.slice(i, i + LARGO_DE_CADENA).join("\n");
      revisadas += 1;

      // Escribir no necesita filtro: lo resuelven el default y el trigger.
      if (cadena.includes(".insert(")) continue;

      if (!/\.eq\("ambito"/.test(cadena)) {
        problemas.push(`${path.relative(RAIZ, archivo)}:${i + 1} — consulta a ${tabla} sin decir de quién es la plata`);
      }
    }
  }
}

if (problemas.length) {
  console.error("Consultas sin ámbito:\n");
  for (const p of problemas) console.error(`  ${p}`);
  console.error(
    `\nAgregá .eq("ambito", "negocio") o .eq("ambito", "personal") según qué panel alimente.`,
  );
  process.exit(1);
}

console.log(`Ámbito declarado: las ${revisadas} consultas a la plata dicen de quién es.`);
