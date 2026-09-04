/**
 * Corredor de la suite de evals.
 *
 * `npm run evals`
 *
 * Criterio de aprobación, en dos niveles a propósito:
 *
 *   1. **Ningún caso crítico puede fallar.** Un crítico roto significa que el
 *      sistema le va a mentir al usuario sobre cuánta plata tiene.
 *   2. **Ningún caso deseable puede fallar tampoco**, salvo que esté anotado a
 *      mano en `LIMITACIONES_CONOCIDAS`. La severidad no cambia si algo corta
 *      el deploy: cambia cómo se reporta y cuánto urge.
 *
 * La primera versión de esto usaba un umbral porcentual para los deseables
 * ("que pase el 80%"). El chequeo por mutación mostró que ese diseño no servía:
 * borrar un arreglo hacía fallar un caso y la suite seguía en verde porque 8
 * de 9 alcanzaban el umbral. Un umbral con holgura tolera regresiones por
 * construcción. La lista explícita no: para que algo falle sin cortar el
 * deploy, alguien tiene que escribirlo acá y explicar por qué.
 */

import type { Caso, Suite } from "./tipos.ts";
import { categorizacion } from "./casos/categorizacion.ts";
import { importes } from "./casos/importes.ts";
import { fechas } from "./casos/fechas.ts";
import { correo } from "./casos/correo.ts";
import { acciones } from "./casos/acciones.ts";

const SUITES: Suite[] = [correo, categorizacion, importes, fechas, acciones];

/**
 * Casos que hoy NO pasan y aceptamos conscientemente, por nombre exacto.
 *
 * Agregar algo acá es una decisión, no un descuido: queda en el diff, con
 * autor y fecha. Sacar un caso de esta lista cuando se arregla es obligatorio
 * —la suite avisa si algo anotado acá empezó a pasar—, para que la lista no se
 * llene de limitaciones que ya no existen.
 *
 * Vacía a propósito: hoy pasa el corpus completo.
 */
const LIMITACIONES_CONOCIDAS: string[] = [];

type Fallo = { clave: string; suite: string; caso: Caso; esperado: string; obtenido: string };

/** Nombre único de un caso: es la clave que se anota en las limitaciones. */
function clave(suite: Suite, caso: Caso): string {
  return `${suite.nombre} · ${caso.nombre}`;
}

function evaluar(caso: Caso) {
  try {
    return caso.evaluar();
  } catch (error) {
    // Una excepción es un fallo, no una interrupción: el resto del corpus
    // sigue siendo información útil.
    return {
      ok: false,
      esperado: "sin excepción",
      obtenido: `lanzó ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function detallar(titulo: string, fallos: Fallo[]) {
  if (fallos.length === 0) return;
  console.log(titulo);
  for (const f of fallos) {
    console.log(`  · [${f.suite}] ${f.caso.nombre}`);
    console.log(`      esperado: ${f.esperado}`);
    console.log(`      obtenido: ${f.obtenido}`);
    console.log(`      importa porque: ${f.caso.porque}`);
  }
  console.log("");
}

function correr() {
  const conocidas = new Set(LIMITACIONES_CONOCIDAS);

  const fallosCriticos: Fallo[] = [];
  const fallosDeseables: Fallo[] = [];
  const fallosAnotados: Fallo[] = [];
  /** Anotadas como limitación pero que hoy pasan: hay que sacarlas de la lista. */
  const yaResueltas: string[] = [];

  const lineas: string[] = [];
  let totalCasos = 0;
  let totalOk = 0;

  for (const suite of SUITES) {
    let ok = 0;
    let anotados = 0;

    for (const caso of suite.casos) {
      const k = clave(suite, caso);
      const resultado = evaluar(caso);
      totalCasos += 1;

      if (resultado.ok) {
        ok += 1;
        totalOk += 1;
        if (conocidas.has(k)) yaResueltas.push(k);
        continue;
      }

      const fallo: Fallo = {
        clave: k,
        suite: suite.nombre,
        caso,
        esperado: resultado.esperado,
        obtenido: resultado.obtenido,
      };

      if (conocidas.has(k)) {
        anotados += 1;
        fallosAnotados.push(fallo);
      } else if (caso.severidad === "critico") {
        fallosCriticos.push(fallo);
      } else {
        fallosDeseables.push(fallo);
      }
    }

    const rotos = suite.casos.length - ok - anotados;
    lineas.push(
      `  ${rotos === 0 ? "ok   " : "FALLA"}  ${suite.nombre.padEnd(16)} ${ok}/${suite.casos.length}` +
        (anotados > 0 ? `   ·   ${anotados} anotado(s) como limitación` : ""),
    );
  }

  console.log("");
  console.log("EOS · suite de evals");
  console.log("");
  console.log(lineas.join("\n"));
  console.log("");

  detallar("Limitaciones conocidas (anotadas a mano, no cortan el deploy):", fallosAnotados);
  detallar("FALLAS CRÍTICAS — esto le miente al usuario sobre su plata:", fallosCriticos);
  detallar("Fallas en casos deseables:", fallosDeseables);

  if (yaResueltas.length > 0) {
    console.log("Estas limitaciones ya no existen. Sacalas de LIMITACIONES_CONOCIDAS:");
    for (const k of yaResueltas) console.log(`  · ${k}`);
    console.log("");
  }

  console.log(
    `Total: ${totalOk}/${totalCasos} casos · ${fallosAnotados.length} limitación(es) anotada(s)`,
  );

  const aprobado =
    fallosCriticos.length === 0 && fallosDeseables.length === 0 && yaResueltas.length === 0;

  console.log(aprobado ? "Resultado: APROBADO" : "Resultado: RECHAZADO");
  console.log("");

  process.exit(aprobado ? 0 : 1);
}

correr();
