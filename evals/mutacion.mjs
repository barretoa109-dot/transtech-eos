/**
 * Auditoría por mutación de la suite de evals.
 *
 *   npm run evals:mutacion
 *
 * Por qué existe: en este proyecto ya pasó que un test verde no probaba nada.
 * El caso "RECHAZA publicidad del banco" seguía pasando con el filtro de
 * publicidad BORRADO, porque otros dos guardas atrapaban los mismos ejemplos.
 * La lista entera de palabras promocionales se podía eliminar sin que fallara
 * nada. Un corpus que pasa no demuestra que el corpus sirva.
 *
 * Esto rompe cada protección a propósito, una por vez, y exige que la suite lo
 * note. Si una mutación NO se detecta, o esa protección es código muerto o al
 * corpus le falta el caso que la ejercita — las dos cosas hay que arreglarlas.
 *
 * Los fragmentos se buscan por texto exacto: cuando alguien reescribe una de
 * estas líneas, esta herramienta avisa que no la encuentra en vez de fingir que
 * todo está bien. Es un chequeo manual y deliberado, no un test automático.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const MOVIMIENTOS = "lib/finanzas/extraerMovimientos.ts";
const CORREO = "lib/finanzas/extraerDeCorreo.ts";
const JOBS = "lib/gateway/jobs.ts";
const RESPUESTA = "lib/gateway/respuesta.ts";

/** [nombre, archivo, fragmento a romper, con qué reemplazarlo] */
const MUTACIONES = [
  [
    "desempate por recepción explícita",
    MOVIMIENTOS,
    "if (ingreso > 0 && ingreso === gasto && RECEPCION_EXPLICITA.some((p) => texto.includes(p))) {",
    "if (false) {",
  ],
  [
    "conteo por concepto en vez de por coincidencia",
    MOVIMIENTOS,
    'conceptos.add(palabra.replace(/s$/, ""));',
    "conceptos.add(palabra);",
  ],
  [
    "rechazo de PYG con decimales",
    MOVIMIENTOS,
    "if (!esUSD && !Number.isInteger(monto)) return null;",
    "",
  ],
  ["rechazo de ceros a la izquierda", MOVIMIENTOS, ".test(numerico)) return null;", ""],
  ["rechazo de porcentajes", MOVIMIENTOS, 'if (limpio.includes("%")) return null;', ""],
  [
    "importe más cercano a la palabra de dirección",
    CORREO,
    "const principal = elegirPrincipal(importes, plano, marcaDireccion(completo)?.pos ?? 0);",
    "const principal = importes[0];",
  ],
  [
    "descarte de importes que son saldos",
    CORREO,
    "const noSaldo = importes.filter((i) => !pareceSaldo(plano, i.indice));",
    "const noSaldo = importes;",
  ],

  /*
   * Gateway. Estas cuatro protegen exact-once: si una mutación pasa sin que la
   * suite lo note, el Worker Gate podría dejar de reconocer un reintento y
   * ejecutar una venta dos veces.
   *
   * Las dos primeras ya se colaron una vez: el corpus de `acciones` comparaba
   * solo las claves declaradas y con `datos: {}` no comparaba nada.
   */
  [
    "orden de preferencia de los alias de una tarea",
    JOBS,
    "titulo: texto(d.titulo, d.nombre, d.name, d.asunto, d.tarea),",
    "titulo: texto(d.nombre, d.titulo, d.name, d.asunto, d.tarea),",
  ],
  [
    "las lecturas no arrastran datos",
    JOBS,
    'if (tipo === "VER_DASHBOARD" || tipo === "VER_BRIEFING" || tipo === "RESPONDER") return {};',
    'if (tipo === "VER_BRIEFING" || tipo === "RESPONDER") return {};',
  ],
  [
    "lista blanca de acciones",
    RESPUESTA,
    ".filter((a) => ACCIONES_PERMITIDAS.has(a.tipo))",
    "",
  ],
  [
    "con documento se descartan las acciones de archivo",
    RESPUESTA,
    "const finales = documento ? acciones.filter((a) => !ACCIONES_DE_ARCHIVO.has(a.tipo)) : acciones;",
    "const finales = acciones;",
  ],
];

const original = new Map(
  [MOVIMIENTOS, CORREO, JOBS, RESPUESTA].map((archivo) => [archivo, readFileSync(archivo, "utf8")]),
);

let problemas = 0;

console.log("\nEOS · auditoría por mutación de los evals\n");

for (const [nombre, archivo, fragmento, reemplazo] of MUTACIONES) {
  const texto = original.get(archivo);

  if (!texto.includes(fragmento)) {
    console.log(`  ??  ${nombre}`);
    console.log(`      el fragmento ya no existe en ${archivo}: actualizá esta mutación.`);
    problemas += 1;
    continue;
  }

  writeFileSync(archivo, texto.replace(fragmento, reemplazo));

  let detectada = false;
  try {
    execFileSync("node", ["evals/correr.ts"], { stdio: "pipe" });
  } catch {
    detectada = true;
  } finally {
    // Pase lo que pase, el archivo vuelve a como estaba.
    writeFileSync(archivo, texto);
  }

  if (detectada) {
    console.log(`  ok  ${nombre}`);
  } else {
    console.log(`  NO  ${nombre}`);
    console.log("      la suite sigue en verde con esta protección rota.");
    problemas += 1;
  }
}

console.log("");
console.log(
  problemas === 0
    ? `Las ${MUTACIONES.length} protecciones están cubiertas por el corpus.`
    : `${problemas} protección(es) sin cubrir.`,
);
console.log("");

process.exit(problemas === 0 ? 0 : 1);
