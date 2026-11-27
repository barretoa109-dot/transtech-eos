import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AGENTES, type Agente } from "./agentes.ts";

/**
 * La versión de un agente es un hash de sus reglas, prompts y plantillas.
 *
 * ============================================================
 * POR QUÉ UN HASH Y NO UN NÚMERO
 * ============================================================
 *
 * La regla 7 dice que todo cambio de reglas o prompts lo aprueba el dueño
 * antes de producción. Con un número escrito a mano, alcanza con cambiar un
 * prompt y olvidarse de subir la versión para que el cambio entre sin
 * aprobación. Con el hash no hay forma: cualquier letra distinta en
 * `agentes/<agente>/` o en `agentes/reglas-comunes.md` es otra versión, y la
 * base no deja arrancar una versión que el dueño no aprobó.
 *
 * En Vercel no se leen los archivos: la versión viaja en
 * `versiones.generado.ts`, que arma `npm run agentes:versiones`. Un test
 * comprueba que ese archivo esté al día con los .md del repo, así que un
 * prompt cambiado sin regenerar no pasa el CI.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function archivosDe(carpeta: string): string[] {
  if (!fs.existsSync(carpeta)) return [];
  return fs
    .readdirSync(carpeta, { withFileTypes: true })
    .flatMap((e) => {
      const ruta = path.join(carpeta, e.name);
      return e.isDirectory() ? archivosDe(ruta) : [ruta];
    })
    .sort();
}

/** Los archivos que forman la versión de un agente, relativos a la raíz. */
export function archivosDeVersion(agente: Agente, raiz = RAIZ): string[] {
  const propios = archivosDe(path.join(raiz, "agentes", agente)).filter((f) => !f.includes(`${path.sep}evals${path.sep}`));
  return [path.join(raiz, "agentes", "reglas-comunes.md"), ...propios].map((f) =>
    path.relative(raiz, f).split(path.sep).join("/"),
  );
}

/**
 * sha256 de rutas + contenidos, con saltos de línea normalizados (en Windows
 * git puede dejar CRLF y en el CI LF: no puede dar dos versiones distintas).
 * Las evals no entran: agregar un caso de prueba no exige reaprobar.
 */
export function calcularVersion(agente: Agente, raiz = RAIZ): string {
  const hash = createHash("sha256");
  for (const relativo of archivosDeVersion(agente, raiz)) {
    const contenido = fs.readFileSync(path.join(raiz, relativo), "utf8").replace(/\r\n/g, "\n");
    hash.update(`${relativo}\n${contenido}\n`);
  }
  return hash.digest("hex").slice(0, 16);
}

export function calcularTodas(raiz = RAIZ): Record<Agente, string> {
  return Object.fromEntries(AGENTES.map((a) => [a, calcularVersion(a, raiz)])) as Record<Agente, string>;
}

export function textoDelGenerado(versiones: Record<Agente, string>): string {
  const filas = AGENTES.map((a) => `  ${a}: "${versiones[a]}",`).join("\n");
  return `// Generado por \`npm run agentes:versiones\`. No editar a mano.
// Es el hash de agentes/reglas-comunes.md + agentes/<agente>/ (sin evals).
// Ver lib/agentes/versiones.ts.

import type { Agente } from "./agentes.ts";

export const VERSIONES: Record<Agente, string> = {
${filas}
};
`;
}
