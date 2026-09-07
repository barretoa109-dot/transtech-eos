import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { PROMPT_SISTEMA } from "./sistema.ts";

/**
 * Las reglas del prompt que no se pueden perder en una edición.
 *
 * ============================================================
 * POR QUÉ ESTO ES UNA PRUEBA Y NO UN COMENTARIO
 * ============================================================
 *
 * El punto 15 de la lista de lanzamiento —"no inventar respuestas"— quedó
 * parcial con este argumento: para verificar que EOS no diga "listo, ya cobré"
 * antes de cobrar hay que llamar al modelo real, o inspeccionar el prompt del
 * workflow, "que vive fuera de este repo".
 *
 * Ya no vive afuera. Desde la etapa 1 de `docs/salida-de-n8n.md`, el prompt
 * está acá en `sistema.ts`, extraído del workflow y verificado idéntico. Eso
 * no vuelve testeable la prosa del modelo —eso sigue necesitando llamarlo—
 * pero sí vuelve testeable lo único que la gobierna: sus instrucciones.
 *
 * Es la diferencia entre no poder probar nada y poder probar que la regla
 * sigue escrita. Una regla de seguridad borrada por accidente en una edición
 * del prompt no la nota nadie: el chat sigue contestando, y contesta mal en el
 * caso raro que era justamente el que la regla cuidaba.
 *
 * ============================================================
 * EL CASO REAL QUE ESTO PREVIENE
 * ============================================================
 *
 * El 6 de septiembre se encontró usando el producto: el prompt decía que las
 * acciones del negocio "SIEMPRE necesitan que el usuario las apruebe", cosa
 * que dejó de ser cierta el 3 de septiembre. EOS respondía, textual:
 *
 *   "Dejo listo el alta de Rossana Benítez para que lo confirmes.
 *    El contacto quedó guardado."
 *
 * Dos finales opuestos en el mismo mensaje. El usuario le cree al primero,
 * espera una confirmación que nunca llega, y concluye que EOS no registra
 * nada. Tres días de un chat que parecía roto por una frase desactualizada.
 */

const RAIZ = path.resolve(import.meta.dirname, "..", "..");

test("el prompt prohíbe anunciar el resultado de una acción del negocio", () => {
  // La regla que se rompió una vez. Si alguien la saca, el modelo vuelve a
  // contar un final que todavía no ocurrió.
  assert.match(PROMPT_SISTEMA, /NO ANUNCIES EL RESULTADO/);
  assert.match(PROMPT_SISTEMA, /El sistema ejecuta[\s\S]{0,120}después de tu respuesta/);
});

test("el prompt prohíbe dar por hecho lo que todavía tiene que ejecutar el Worker", () => {
  assert.match(
    PROMPT_SISTEMA,
    /No afirmes que un archivo, tarea, objetivo o memoria ya fue creado/,
  );
});

test("el prompt prohíbe adivinar el producto de una venta", () => {
  // Vender el producto equivocado descuenta el stock equivocado y cobra el
  // precio equivocado. Es la regla más cara de las tres del negocio.
  assert.match(PROMPT_SISTEMA, /NO ADIVINES NOMBRES/);
});

test("el prompt prohíbe inventar el dígito verificador de un RUC", () => {
  assert.match(PROMPT_SISTEMA, /Nunca inventes el dígito verificador/);
});

test("el prompt exige JSON estricto y sin markdown", () => {
  // El nodo 05 del gateway parsea la salida. Con markdown alrededor, las
  // acciones se pierden en silencio: el chat contesta y no ejecuta nada.
  assert.match(PROMPT_SISTEMA, /sin markdown, sin bloques de código/);
});

test("la lista de acciones del prompt es EXACTAMENTE la que acepta la base", () => {
  /*
   * El invariante que más fácil se rompe al agregar una acción.
   *
   * Una acción nueva hay que darla de alta en el prompt, en la lista blanca
   * del nodo 05, en el mapa del nodo 06 y en los tres `check` de la base. Si
   * falta cualquiera, el modelo la pide y se descarta en silencio, o la
   * ejecución falla con "Acción Worker no permitida".
   *
   * Esta prueba cubre las dos puntas que viven en el repo: el prompt y el
   * `check` de `eos_action_commands`. Las de n8n no se pueden probar desde
   * acá, pero una lista que ya coincide con la base es la mitad del problema
   * y es la mitad que se puede automatizar.
   */
  const migracion = fs.readFileSync(
    path.join(RAIZ, "supabase/migrations/20260828020000_eos_acciones_erp_v83.sql"),
    "utf8",
  );

  const bloque = migracion.match(
    /add constraint eos_action_commands_accion_check\s*\n\s*check \(accion = any \(array\[([\s\S]*?)\]\)\)/,
  );

  assert.ok(bloque, "no se encontró el check de eos_action_commands en la v83");

  const deLaBase = [...bloque[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();

  const seccion = PROMPT_SISTEMA.slice(
    PROMPT_SISTEMA.indexOf("Acciones permitidas:"),
    PROMPT_SISTEMA.indexOf("Acciones del negocio"),
  );

  const delPrompt = [...seccion.matchAll(/^([A-Z_]{4,})$/gm)].map((m) => m[1]).sort();

  // RESPONDER está en la base pero NO en el prompt, a propósito: el gateway lo
  // fabrica solo cuando el modelo no pide ninguna acción. Ofrecérselo al
  // modelo lo invitaría a pedir explícitamente "responder", que no es una
  // acción sino la ausencia de una.
  assert.deepEqual(
    delPrompt,
    deLaBase.filter((a) => a !== "RESPONDER"),
    "la lista de acciones del prompt y la que acepta la base dejaron de coincidir",
  );
});

test("las tres acciones del negocio traen su forma de datos", () => {
  // Sin la forma, el modelo inventa las claves y el ejecutor no encuentra
  // ninguna: la acción llega, se acepta y no hace nada.
  for (const accion of ["REGISTRAR_VENTA", "AJUSTAR_STOCK", "CREAR_CONTACTO"]) {
    const i = PROMPT_SISTEMA.indexOf(`${accion}\n  datos:`);
    assert.ok(i > 0, `${accion} no declara su forma de datos en el prompt`);
  }
});

test("el prompt no promete formatos de archivo que el sistema no arma", () => {
  // Los tres que `lib/documentos/guardar.ts` sabe generar, y ninguno más.
  const prometidos = PROMPT_SISTEMA.match(/en Excel, PDF y Word/g) ?? [];
  assert.ok(prometidos.length > 0);
  assert.doesNotMatch(PROMPT_SISTEMA, /PowerPoint|CSV descargable|Google Sheets/);
});
