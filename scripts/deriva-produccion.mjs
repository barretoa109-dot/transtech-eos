#!/usr/bin/env node
/**
 * ¿Producción corre lo mismo que `main`? Lo corre .github/workflows/deriva.yml.
 *
 *   PROD_VERSIONES=archivo.txt node scripts/deriva-produccion.mjs
 *   (+ N8N_BASE_URL y N8N_API_KEY en el entorno para comparar también n8n)
 *
 * POR QUÉ EXISTE. Varias sesiones aplicaban migraciones y parches de n8n a
 * producción desde su rama, antes de mergear. Resultado, varias veces: la base
 * por delante del repositorio, dos migraciones con la misma versión, una
 * función regenerada desde un archivo viejo que borró lo que otra sesión había
 * agregado (le vació el catálogo del contexto a una usuaria real el
 * 2026-09-10), y mergeados que nunca se aplicaron. Ninguna de esas cosas
 * avisaba: se veían recién llamando a la función en producción.
 *
 * Esto lo compara todas las noches y falla si difieren, en cualquiera de los
 * dos sentidos:
 *
 *  - migraciones: versiones aplicadas en producción que no están en
 *    `supabase/migrations/` de main (alguien aplicó desde una rama), y archivos
 *    de main que producción no tiene (se mergeó y nadie corrió `db push`);
 *  - n8n (si hay credenciales): los parámetros y conexiones de cada nodo de los
 *    workflows exportados en `n8n/workflows/` contra los vivos. El prompt del
 *    chat vive ahí, así que un parche aplicado en vivo sin reexportar aparece.
 *
 * LOS LOGS SON PÚBLICOS: imprime versiones de migración y nombres de nodo, que
 * ya están en el repositorio. Nunca el contenido de un nodo.
 */

import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
);

let problemas = 0;

// ------------------------------------------------------------------ migraciones
const archivo = process.env.PROD_VERSIONES;
if (!archivo) {
  console.error("Falta PROD_VERSIONES (archivo con una versión aplicada por renglón).");
  process.exit(2);
}

const enProduccion = new Set(
  fs.readFileSync(archivo, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
);
const enMain = new Set(
  fs
    .readdirSync(path.join(RAIZ, "supabase", "migrations"))
    .map((f) => f.match(/^(\d+)_.*\.sql$/)?.[1])
    .filter(Boolean),
);

if (enProduccion.size < 10) {
  console.error(`Producción devolvió ${enProduccion.size} versiones: la consulta no trajo nada útil.`);
  process.exit(2);
}

const soloProduccion = [...enProduccion].filter((v) => !enMain.has(v)).sort();
const soloMain = [...enMain].filter((v) => !enProduccion.has(v)).sort();

console.log(`migraciones: ${enMain.size} en main, ${enProduccion.size} en producción`);
for (const v of soloProduccion) {
  console.log(`::error::Aplicada en producción y ausente de main: ${v} (¿se aplicó desde una rama?)`);
}
for (const v of soloMain) {
  console.log(`::error::En main y sin aplicar en producción: ${v} (falta db push)`);
}
problemas += soloProduccion.length + soloMain.length;

// ------------------------------------------------------------------ n8n
/*
 * La misma lista que `n8n/exportar.mjs` (que no se importa: al importarlo se
 * ejecuta y exporta). Si se agrega un workflow allá, agregarlo acá.
 */
const FLUJOS = {
  gateway: { id: "JRgzUkoHBKgGpyPA", archivo: "eos-conversational-gateway-rc1.json" },
  worker: { id: "iUMdg9fhAg54irmy", archivo: "eos-background-worker-rc1.json" },
  briefing: { id: "bFY6PPhJyTPJ4X2P", archivo: "eos-briefing-personalizado-diario-v5.json" },
  decisiones: { id: "xwFkncvx2T7DYAm8", archivo: "eos-registro-decisiones-resultados-v6.json" },
};

/** Lo que cambia el comportamiento: parámetros por nodo y conexiones. No posiciones. */
function huella(flujo) {
  const nodos = {};
  for (const n of flujo.nodes ?? []) nodos[n.name] = JSON.stringify(n.parameters ?? {});
  return { nodos, conexiones: JSON.stringify(flujo.connections ?? {}) };
}

const { N8N_BASE_URL, N8N_API_KEY } = process.env;

if (!N8N_BASE_URL || !N8N_API_KEY) {
  console.log("n8n: sin N8N_BASE_URL/N8N_API_KEY, no se compara.");
} else {
  const base = N8N_BASE_URL.replace(/\/$/, "");
  for (const [nombre, { id, archivo: exportado }] of Object.entries(FLUJOS)) {
    const r = await fetch(`${base}/api/v1/workflows/${id}`, { headers: { "X-N8N-API-KEY": N8N_API_KEY } });
    if (!r.ok) {
      console.log(`::error::n8n ${nombre}: GET ${r.status}`);
      problemas += 1;
      continue;
    }
    const vivo = huella(await r.json());
    const repo = huella(JSON.parse(fs.readFileSync(path.join(RAIZ, "n8n", "workflows", exportado), "utf8")));

    const nombres = new Set([...Object.keys(vivo.nodos), ...Object.keys(repo.nodos)]);
    const distintos = [...nombres].filter((n) => vivo.nodos[n] !== repo.nodos[n]).sort();
    const conexiones = vivo.conexiones !== repo.conexiones;

    if (!distintos.length && !conexiones) {
      console.log(`n8n ${nombre}: igual a main`);
      continue;
    }
    problemas += distintos.length + (conexiones ? 1 : 0);
    for (const n of distintos) {
      const donde = !(n in repo.nodos) ? "solo en vivo" : !(n in vivo.nodos) ? "solo en main" : "distinto";
      console.log(`::error::n8n ${nombre}, nodo "${n}": ${donde} (¿parche sin reexportar? node n8n/exportar.mjs ${nombre})`);
    }
    if (conexiones) console.log(`::error::n8n ${nombre}: las conexiones difieren`);
  }
}

console.log(problemas ? `\n${problemas} diferencia(s) entre producción y main.` : "\nProducción corre lo mismo que main.");
process.exit(problemas ? 1 : 0);
