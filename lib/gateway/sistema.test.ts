import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { PROMPT_SISTEMA } from "./sistema.ts";
import { ACCIONES_PERMITIDAS } from "./respuesta.ts";
import { ACCIONES_INTERNAS } from "./ejecutar.ts";
import { RUTAS } from "./jobs.ts";
import { ACCIONES_CON_RIESGO } from "../autonomia/riesgo.ts";

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

test("el prompt prohíbe elegir entre varios productos parecidos", () => {
  /*
   * Vender el producto equivocado descuenta el stock equivocado y cobra el
   * precio equivocado. Es la regla más cara de las del negocio.
   *
   * Decía "NO ADIVINES NOMBRES" hasta la v158, cuando el modelo no veía el
   * catálogo. Sin catálogo, esa regla sólo se podía cumplir preguntando
   * siempre — y preguntar "¿cuál de todos?" cuando hay uno solo es la forma
   * más rápida de que alguien deje de usar el chat. Ahora la regla distingue
   * los dos casos, que es lo que se comprueba acá.
   */
  assert.match(PROMPT_SISTEMA, /VARIOS que podrían ser/);
  assert.match(PROMPT_SISTEMA, /preguntá cuál antes de pedir la acción/);
  assert.match(PROMPT_SISTEMA, /UNO SOLO que puede ser, ese es: no preguntes/);
});

test("el prompt le dice al modelo que el catálogo está adelante", () => {
  // Sin esto, la instrucción de usar el nombre exacto habla de una lista que
  // el modelo no sabe que tiene.
  assert.match(PROMPT_SISTEMA, /EL CATÁLOGO ESTÁ ARRIBA/);
  assert.match(PROMPT_SISTEMA, /nombre TAL\s+CUAL figura ahí/);
});

test('el prompt prohíbe mandar "uno" o "ese" como nombre de producto', () => {
  /*
   * Una usuaria escribió "vendí uno a 185.000" después de tres mensajes
   * hablando del mismo conjunto. Si eso viaja como producto: "uno", no hay
   * resolución posible del otro lado y la venta se pierde con un error que no
   * explica nada.
   */
  assert.match(PROMPT_SISTEMA, /NO SON NOMBRES DE PRODUCTO/);
  assert.match(PROMPT_SISTEMA, /resolvé de qué producto hablan y mandá SU NOMBRE/);
});

test("el prompt NO manda a cargar el producto antes de vender", () => {
  // Desde la v156 el sistema crea el producto con el precio que la persona
  // acaba de decir y registra la venta en el mismo paso. Pedirle que lo
  // cargue primero es mandarla a otra pantalla para algo que EOS hace solo.
  assert.match(PROMPT_SISTEMA, /mandá la acción IGUAL, con\s+el nombre como te lo dijeron/);
  assert.match(PROMPT_SISTEMA, /No le pidas a la\s+persona que lo cargue primero/);
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
  /*
   * La ÚLTIMA migración que define el check, no una fijada a mano.
   *
   * Estaba clavada en la v83 y se rompió en cuanto la v131 agregó
   * CREAR_PRODUCTO: la prueba comparaba el prompt de hoy contra la lista de
   * hace diez días. Una prueba que mira una versión vieja de la verdad falla
   * cuando todo está bien, que es la forma más rápida de que alguien la borre.
   */
  const carpeta = path.join(RAIZ, "supabase", "migrations");

  const conElCheck = fs
    .readdirSync(carpeta)
    .filter((a) => a.endsWith(".sql"))
    .sort()
    .filter((a) =>
      fs.readFileSync(path.join(carpeta, a), "utf8").includes("add constraint eos_action_commands_accion_check"),
    );

  assert.ok(conElCheck.length > 0, "ninguna migración define eos_action_commands_accion_check");

  const migracion = fs.readFileSync(path.join(carpeta, conElCheck[conElCheck.length - 1]), "utf8");

  const bloque = migracion.match(
    /add constraint eos_action_commands_accion_check\s*\n\s*check \(accion = any \(array\[([\s\S]*?)\]\)\)/,
  );

  assert.ok(bloque, `no se encontró el check en ${conElCheck[conElCheck.length - 1]}`);

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

test("cada acción del negocio trae su forma de datos", () => {
  /*
   * Sin la forma, el modelo inventa las claves y el ejecutor no encuentra
   * ninguna: la acción llega, se acepta y no hace nada.
   *
   * La lista se saca de la sección del prompt, no de un arreglo escrito acá.
   * Estaba escrita a mano con las tres del 3 de septiembre, y cuando llegaron
   * CREAR_PRODUCTO y ACTUALIZAR_PRODUCTO la prueba siguió en verde sin
   * mirarlas: una prueba con la lista clavada deja de cubrir justo lo que se
   * agrega, que es lo único que todavía no se probó a mano.
   */
  const seccion = PROMPT_SISTEMA.slice(PROMPT_SISTEMA.indexOf("Acciones del negocio (ERP y CRM):"));
  const delNegocio = [...seccion.matchAll(/^([A-Z_]{6,})$/gm)].map((m) => m[1]);

  assert.ok(delNegocio.length >= 3, "no se reconoció ninguna acción del negocio en el prompt");

  for (const accion of delNegocio) {
    assert.ok(
      PROMPT_SISTEMA.includes(`${accion}\n  datos:`),
      `${accion} no declara su forma de datos en el prompt`,
    );
  }
});

test("el prompt no puede tener comillas invertidas", () => {
  /*
   * En n8n el prompt vive DENTRO de un literal de plantilla de JavaScript
   * (`text: ` seguido de comilla invertida). Una comilla invertida en el
   * texto lo termina antes de tiempo.
   *
   * Pasó el 7 de septiembre de 2026: se agregó a las instrucciones la palabra
   * `total` entre comillas invertidas, para que se leyera como nombre de
   * campo. El prompt quedó cortado en "El MONTO: mandá " y el resto del
   * cuerpo de la petición pasó a ser JavaScript inválido. El chat de
   * producción se cayó entero hasta que se restauró el respaldo.
   *
   * Lo detectó la prueba de paridad de acá abajo, pero después de escribir en
   * producción. Esta prueba mira el texto y falla antes.
   */
  assert.doesNotMatch(
    PROMPT_SISTEMA,
    /`/,
    "el prompt tiene una comilla invertida y en n8n eso corta el literal de plantilla",
  );
});

test("los nodos de código del gateway son JavaScript válido", () => {
  /*
   * El otro lado del mismo accidente: si un parche deja un nodo con código
   * roto, n8n no avisa al guardar — falla recién cuando alguien escribe en el
   * chat, y falla para todos.
   *
   * `jsonBody` no es código suelto sino una expresión de n8n, envuelta en
   * `={{ … }}`. Se desenvuelve y se compila igual.
   */
  const flujo = JSON.parse(
    fs.readFileSync(path.join(RAIZ, "n8n", "workflows", "eos-conversational-gateway-rc1.json"), "utf8"),
  );

  for (const nodo of flujo.nodes as { name: string; parameters?: Record<string, unknown> }[]) {
    const codigo = nodo.parameters?.jsCode;
    if (typeof codigo === "string") {
      assert.doesNotThrow(() => new Function(codigo), `el nodo "${nodo.name}" no compila`);
    }

    const cuerpo = nodo.parameters?.jsonBody;
    if (typeof cuerpo === "string" && cuerpo.startsWith("={{")) {
      const expresion = cuerpo.replace(/^=\{\{/, "(").replace(/\}\}$/, ")");
      assert.doesNotThrow(
        () => new Function(`return ${expresion}`),
        `la expresión del nodo "${nodo.name}" no compila`,
      );
    }
  }
});

test("el prompt de n8n y el del repo son el mismo texto", () => {
  /*
   * La regla que la cabecera de `sistema.ts` pide y que hasta hoy no
   * verificaba nadie: mientras convivan los dos caminos, el prompt está
   * duplicado y hay que cambiarlo en los dos.
   *
   * Si divergen, dos personas con el mismo mensaje reciben respuestas
   * distintas según qué bandera esté prendida, y desde un reporte de soporte
   * eso es indistinguible de que el modelo tuvo un mal día.
   *
   * El workflow exportado se versiona en `n8n/workflows/` cada vez que se
   * toca —lo hacen los parches de `n8n/parches/`— así que la copia de acá es
   * la del workflow que está corriendo.
   */
  const flujo = JSON.parse(
    fs.readFileSync(path.join(RAIZ, "n8n", "workflows", "eos-conversational-gateway-rc1.json"), "utf8"),
  );

  const http = flujo.nodes.find((n: { name: string }) => n.name === "HTTP Request");
  assert.ok(http, "el gateway exportado no tiene el nodo HTTP Request");

  // El prompt es el primer literal de plantilla del cuerpo: `text: ` seguido
  // de una comilla invertida, hasta la que cierra.
  const cuerpo = http.parameters.jsonBody;
  const inicio = cuerpo.indexOf("text: `");
  assert.ok(inicio > 0, "no se encontró el prompt dentro del nodo HTTP Request");

  const desde = inicio + "text: `".length;
  const fin = cuerpo.indexOf("`", desde);
  const enN8n = cuerpo.slice(desde, fin);

  assert.equal(
    enN8n,
    PROMPT_SISTEMA,
    "el prompt de n8n y el de lib/gateway/sistema.ts dejaron de ser el mismo texto",
  );
});

test("el prompt no promete formatos de archivo que el sistema no arma", () => {
  // Los tres que `lib/documentos/guardar.ts` sabe generar, y ninguno más.
  const prometidos = PROMPT_SISTEMA.match(/en Excel, PDF y Word/g) ?? [];
  assert.ok(prometidos.length > 0);
  assert.doesNotMatch(PROMPT_SISTEMA, /PowerPoint|CSV descargable|Google Sheets/);
});

test("las listas del gateway en TypeScript no se quedan atrás del prompt", () => {
  /*
   * ============================================================
   * EL PATRÓN QUE ESTE PROYECTO YA PAGÓ TRES VECES
   * ============================================================
   *
   * Una acción hay que darla de alta en nueve lugares. Los que fallan ruidoso
   * se arreglan el mismo día; los que fallan callados —una lista blanca que
   * descarta lo que no conoce— se descubren semanas después, cuando alguien
   * reporta que "EOS no registra nada".
   *
   * `ACCIONES_PERMITIDAS` se escribió con once acciones y se quedó ahí
   * mientras n8n llegaba a veinte. `ACCIONES_INTERNAS` se quedó en seis, con
   * un comentario que decía "misma lista que n8n". Como el gateway en
   * TypeScript vive detrás de una bandera y todavía no atiende producción, la
   * diferencia no se veía: el día que se prendiera, ocho acciones se habrían
   * descartado en silencio.
   *
   * El prompt es la fuente: si el modelo puede pedir una acción, las dos
   * listas que la reciben tienen que conocerla.
   */
  const seccion = PROMPT_SISTEMA.slice(
    PROMPT_SISTEMA.indexOf("Acciones permitidas:"),
    PROMPT_SISTEMA.indexOf("Acciones del negocio"),
  );

  const delPrompt = [...seccion.matchAll(/^([A-Z_]{4,})$/gm)].map((m) => m[1]).sort();

  assert.deepEqual(
    [...ACCIONES_PERMITIDAS].sort(),
    delPrompt,
    "ACCIONES_PERMITIDAS dejó de coincidir con la lista del prompt",
  );

  /*
   * Las internas son un subconjunto: las que dejan un efecto durable en la
   * base. Los archivos y las vistas van por otro worker, así que no están —
   * pero ninguna acción del prompt puede faltar en las DOS listas.
   */
  const noInternas = new Set([
    "GENERAR_EXCEL",
    "GENERAR_PDF",
    "GENERAR_WORD",
    "VER_DASHBOARD",
    "VER_BRIEFING",
  ]);

  const esperadas = delPrompt.filter((a) => !noInternas.has(a));

  assert.deepEqual(
    [...ACCIONES_INTERNAS].sort(),
    esperadas,
    "ACCIONES_INTERNAS dejó de coincidir con las acciones del prompt que dejan efecto",
  );

  /*
   * Y la tercera lista: a qué worker va cada acción. Se había quedado en
   * tres mientras n8n llegaba a doce, así que una venta habría salido sin
   * ruta el día que se prendiera la bandera.
   */
  for (const accion of delPrompt) {
    assert.ok(RUTAS[accion], `${accion} no tiene ruta de worker en jobs.ts`);
  }
});

test("toda acción que el modelo puede pedir tiene su riesgo declarado", () => {
  /*
   * Sin fila en SYSTEM_RISK, el gate la rechaza en la puerta con un 400 y la
   * persona lee "no pude" sin motivo. Es el quinto de los nueve lugares.
   */
  const seccion = PROMPT_SISTEMA.slice(
    PROMPT_SISTEMA.indexOf("Acciones permitidas:"),
    PROMPT_SISTEMA.indexOf("Acciones del negocio"),
  );

  for (const accion of [...seccion.matchAll(/^([A-Z_]{4,})$/gm)].map((m) => m[1])) {
    assert.ok(
      ACCIONES_CON_RIESGO.has(accion),
      `${accion} no tiene entrada en SYSTEM_RISK`,
    );
  }
});

test("el prompt dice que GUARDAR_MEMORIA no reemplaza a un verbo del negocio", () => {
  /*
   * ============================================================
   * LA ACCIÓN QUE SIEMPRE FUNCIONA, Y POR ESO TAPA
   * ============================================================
   *
   * GUARDAR_MEMORIA acepta cualquier texto y nunca falla. Es la salida cómoda
   * cuando el modelo no encuentra el verbo que corresponde, y la peor forma de
   * fallar que tiene este sistema: la respuesta suena a que quedó hecho.
   *
   * Pasó dos veces con la misma usuaria. El 7 de septiembre de 2026 pidió
   * cargar cuatro productos y EOS guardó una memoria: ninguno entró al
   * catálogo (ver la migración v131). El 9 calculó los costos de sus conjuntos
   * y EOS dijo "guardé esa información en la memoria empresarial": el panel de
   * rentabilidad nunca los vio.
   *
   * Si alguien saca esta regla en una edición del prompt, no se rompe nada
   * visible — vuelve a fallar en silencio, que es de donde salió.
   */
  assert.match(PROMPT_SISTEMA, /NUNCA la uses para un dato que tiene su propio verbo/);
  assert.match(PROMPT_SISTEMA, /Ante la duda entre la memoria y un verbo del negocio, es el verbo/);
});

test("el prompt explica para qué SÍ es la memoria", () => {
  // La regla en negativo sola convertiría GUARDAR_MEMORIA en una acción que el
  // modelo no usa nunca, y hay cosas que de verdad no tienen otro lugar.
  assert.match(PROMPT_SISTEMA, /Es para lo que NO tiene otro lugar/);
});
