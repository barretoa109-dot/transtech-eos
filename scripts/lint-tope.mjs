#!/usr/bin/env node
/**
 * El trinquete del lint: la deuda puede bajar, nunca subir.
 *
 * ============================================================
 * POR QUÉ NO ALCANZA CON "LINT SIN ERRORES"
 * ============================================================
 *
 * La hoja de ruta pide una puerta de calidad donde cada cambio pase el lint
 * sin errores. Hoy eso no se puede exigir: quedan 24 errores heredados, y
 * bloquear por ellos frenaría trabajo que no tiene nada que ver.
 *
 * La respuesta que se venía usando era `continue-on-error: true` en el CI, con
 * un comentario que decía "para que deje de crecer en silencio". Pero un
 * chequeo que informa y no bloquea no impide que crezca: solo lo deja anotado
 * en un log que nadie abre. La deuda igual sube, y encima con testigo.
 *
 * Esto sí lo impide. El tope es el número de HOY. Un cambio que agregue un
 * error rompe el CI, con el archivo y la línea a la vista. Un cambio que baje
 * el número también rompe —pidiendo que se baje el tope— para que el número
 * de acá abajo nunca mienta sobre el estado real.
 *
 * ============================================================
 * CÓMO SE USA
 * ============================================================
 *
 *   npm run lint:tope
 *
 * Si falla porque bajó, se baja el tope acá y se commitea junto con el arreglo.
 * Ese commit es la prueba de que la deuda se achicó.
 *
 * El día que los dos lleguen a cero, este archivo se borra y el CI vuelve a
 * correr `npm run lint` a secas, que es como tendría que ser.
 *
 * ============================================================
 * QUÉ FALTA PARA LLEGAR A CERO
 * ============================================================
 *
 * De los 24 errores:
 *
 *  - 19 son `no-explicit-any` en el código de pagos, donde el tipo honesto es
 *    "JSON que manda Bancard, sin contrato". Tiparlos obliga a estrechar en
 *    cada uso; es un pase aparte y con cuidado, no un reemplazo masivo.
 *  - 5 son `react-hooks/set-state-in-effect`, y no se arreglan quitando
 *    líneas: la regla marca el patrón de carga de datos entero. Ver el
 *    hallazgo 2 de `docs/lanzamiento/lista-maestra.md`.
 */

import { execSync } from "node:child_process";

/** El estado de hoy, 31 de agosto de 2026. Solo puede bajar. */
const TOPE = { errores: 24, avisos: 7 };

function contar() {
  let salida;

  try {
    // Comando fijo, sin nada interpolado: no hay entrada que escapar.
    salida = execSync("npx eslint --format json", {
      encoding: "utf8",
      maxBuffer: 1 << 26,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (fallo) {
    // eslint sale con código 1 cuando encuentra errores: eso es normal acá y
    // la salida JSON viene igual por stdout.
    salida = fallo.stdout;

    if (!salida) {
      console.error("No se pudo correr eslint:\n" + (fallo.stderr || fallo.message));
      process.exit(2);
    }
  }

  const archivos = JSON.parse(salida);

  return {
    errores: archivos.reduce((t, a) => t + a.errorCount, 0),
    avisos: archivos.reduce((t, a) => t + a.warningCount, 0),
  };
}

const hoy = contar();
const problemas = [];

for (const clase of ["errores", "avisos"]) {
  if (hoy[clase] > TOPE[clase]) {
    problemas.push(
      `Los ${clase} de lint subieron de ${TOPE[clase]} a ${hoy[clase]}. ` +
        `Corré \`npm run lint\` y arreglá lo que agregaste.`,
    );
  } else if (hoy[clase] < TOPE[clase]) {
    problemas.push(
      `Los ${clase} de lint bajaron de ${TOPE[clase]} a ${hoy[clase]}. ` +
        `Bajá el tope en scripts/lint-tope.mjs y commiteálo con el arreglo.`,
    );
  }
}

if (problemas.length > 0) {
  console.error("\n" + problemas.join("\n") + "\n");
  process.exit(1);
}

console.log(`Lint dentro del tope: ${hoy.errores} errores, ${hoy.avisos} avisos.`);
