import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { PROMPT_SISTEMA } from "./sistema.ts";

/**
 * Los tres lugares del alta de una acción que fallan CALLADOS.
 *
 * ============================================================
 * LA CLASE DE PROBLEMA, NO EL CASO
 * ============================================================
 *
 * Dar de alta una acción en EOS toca nueve lugares. Seis ya los cuida
 * `sistema.test.ts`: el prompt, `ACCIONES_PERMITIDAS`, `ACCIONES_INTERNAS`,
 * `RUTAS`, `SYSTEM_RISK` y el `check` de la base.
 *
 * Faltaban los tres que ya costaron incidentes, y no es casualidad: son los
 * tres que no rompen nada al faltar. El chat sigue contestando. La persona
 * pide algo, EOS dice que lo entendió, y no pasa nada.
 *
 *   · La lista blanca del Worker. Faltaban REGISTRAR_VENTA, AJUSTAR_STOCK y
 *     CREAR_CONTACTO: el worker las rechazaba ANTES de pedir autorización.
 *     El chat mostraba "Operación lista para registrar" y la pantalla de
 *     aprobaciones quedaba vacía. Lo reportó una clienta el 31 de agosto de
 *     2026 y llevó dos semanas encontrarlo: la auditoría del gate mostraba
 *     como último movimiento uno de catorce días antes, porque el rechazo
 *     ocurría antes de que hubiera algo que auditar.
 *
 *   · La rama del ejecutor en la base. Sin ella, EOS_INTERNAL_EFFECT_
 *     UNSUPPORTED_ACTION — una orden autorizada que no se puede cumplir.
 *
 *   · La frase de la respuesta. Sin ella, "La acción quedó completada", que
 *     después de cargar una venta no le dice a nadie que la venta está.
 *
 * ============================================================
 * POR QUÉ SE LEEN LOS ARCHIVOS Y NO SE ESCRIBE UNA LISTA
 * ============================================================
 *
 * Una lista escrita a mano acá sería el décimo lugar donde dar de alta la
 * acción, y el décimo también se olvidaría. La fuente es el prompt: si el
 * modelo puede pedirla, los tres lugares tienen que conocerla.
 */

const RAIZ = path.resolve(import.meta.dirname, "..", "..");

/** Las acciones que el modelo puede pedir, tal como se las enseña el prompt. */
function accionesDelPrompt(): string[] {
  const seccion = PROMPT_SISTEMA.slice(
    PROMPT_SISTEMA.indexOf("Acciones permitidas:"),
    PROMPT_SISTEMA.indexOf("Acciones del negocio"),
  );

  const acciones = [...seccion.matchAll(/^([A-Z_]{4,})$/gm)].map((m) => m[1]);

  /*
   * El guard contra la prueba que no prueba nada.
   *
   * Todo lo de acá abajo es un `for` sobre esta lista. Si un día el prompt
   * cambia de forma y la expresión deja de encontrar nada, los cuatro
   * controles pasarían en verde recorriendo cero acciones — que es peor que
   * no tenerlos, porque además dan tranquilidad.
   */
  assert.ok(
    acciones.length >= 15,
    `sólo se encontraron ${acciones.length} acciones en el prompt: la expresión dejó de leerlo`,
  );

  return acciones;
}

/** Las que dejan un efecto durable: las que pasan por el ejecutor interno. */
function accionesConEfecto(): string[] {
  const porOtroLado = new Set([
    "GENERAR_EXCEL",
    "GENERAR_PDF",
    "GENERAR_WORD",
    "VER_DASHBOARD",
    "VER_BRIEFING",
  ]);

  return accionesDelPrompt().filter((a) => !porOtroLado.has(a));
}

function nodoDelWorker(nombre: string): string {
  const flujo = JSON.parse(
    fs.readFileSync(path.join(RAIZ, "n8n", "workflows", "eos-background-worker-rc1.json"), "utf8"),
  ) as { nodes: { name: string; parameters?: { jsCode?: string } }[] };

  const nodo = flujo.nodes.find((n) => n.name.startsWith(nombre));
  assert.ok(nodo?.parameters?.jsCode, `no existe el nodo "${nombre}" del worker`);

  return nodo.parameters.jsCode;
}

// ============================================================
// 7º lugar: la lista blanca del Worker
// ============================================================

test("el Worker conoce todas las acciones que el modelo puede pedir", () => {
  const codigo = nodoDelWorker("01 INT Preparar");

  const bloque = codigo.match(/const allowed = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(bloque, "no se encontró la lista blanca en el nodo 01 INT del worker");

  // Sin los comentarios: adentro se nombran acciones que NO están en la lista,
  // contando qué pasó cuando faltaban.
  const sinComentarios = bloque[1]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  const enLaLista = new Set([...sinComentarios.matchAll(/'([A-Z_]{4,})'/g)].map((m) => m[1]));

  for (const accion of accionesConEfecto()) {
    assert.ok(
      enLaLista.has(accion),
      `${accion} no está en la lista blanca del Worker: se rechaza ANTES de pedir autorización, ` +
        "y el chat contesta como si la hubiera dejado lista",
    );
  }
});

// ============================================================
// 8º lugar: la rama del ejecutor, en la base
// ============================================================

/** La migración MÁS RECIENTE que redefine el ejecutor, no una fijada a mano. */
function ejecutorVigente(): string {
  const carpeta = path.join(RAIZ, "supabase", "migrations");

  const conElEjecutor = fs
    .readdirSync(carpeta)
    .filter((a) => a.endsWith(".sql"))
    .sort()
    .filter((a) =>
      /CREATE OR REPLACE FUNCTION public\.eos_execute_internal_effect_v64/i.test(
        fs.readFileSync(path.join(carpeta, a), "utf8"),
      ),
    );

  assert.ok(conElEjecutor.length > 0, "ninguna migración define eos_execute_internal_effect_v64");

  return fs.readFileSync(path.join(carpeta, conElEjecutor[conElEjecutor.length - 1]), "utf8");
}

test("el ejecutor de la base tiene una rama para cada acción con efecto", () => {
  const sql = ejecutorVigente();

  /*
   * Las dos formas de escribir una rama, y las dos valen:
   *
   *   elsif v_command.accion = 'REGISTRAR_VENTA' then
   *   elsif v_command.accion in ('REGISTRAR_COBRO', 'REGISTRAR_PAGO_COMPRA') then
   *
   * La segunda es una rama compartida por dos acciones que hacen lo mismo con
   * el signo cambiado. Un control que sólo mirara la primera daría por
   * faltante algo que está — y una alarma falsa enseña a ignorar la alarma.
   */
  const conRama = new Set<string>();

  for (const m of sql.matchAll(/v_command\.accion\s*=\s*'([A-Z_]{4,})'\s*then/g)) {
    conRama.add(m[1]);
  }

  for (const m of sql.matchAll(/v_command\.accion\s+in\s*\(([^)]*)\)\s*then/g)) {
    for (const n of m[1].matchAll(/'([A-Z_]{4,})'/g)) conRama.add(n[1]);
  }

  for (const accion of accionesConEfecto()) {
    assert.ok(
      conRama.has(accion),
      `${accion} no tiene rama en eos_execute_internal_effect_v64: la orden se autoriza y después ` +
        "muere con EOS_INTERNAL_EFFECT_UNSUPPORTED_ACTION",
    );
  }
});

test("el ejecutor acepta exactamente las acciones que el modelo puede pedir", () => {
  const sql = ejecutorVigente();

  const bloque = sql.match(
    /if v_command\.accion not in \(([\s\S]*?)\) then\s*\n\s*raise exception 'EOS_INTERNAL_EFFECT_UNSUPPORTED_ACTION'/,
  );
  assert.ok(bloque, "no se encontró la lista de acciones soportadas del ejecutor");

  const aceptadas = new Set([...bloque[1].matchAll(/'([A-Z_]{4,})'/g)].map((m) => m[1]));

  for (const accion of accionesConEfecto()) {
    assert.ok(aceptadas.has(accion), `el ejecutor rechaza ${accion} en su primera comprobación`);
  }
});

// ============================================================
// 9º lugar: qué se le dice a la persona cuando salió bien
// ============================================================

test("cada acción con efecto tiene su frase, y ninguna cae en la genérica", () => {
  /*
   * "La acción quedó completada" es correcto y no sirve. Después de registrar
   * una venta, la persona necesita leer que la venta está —y dónde—, que es
   * lo que le permite darse cuenta AHÍ de que se cargó el producto
   * equivocado, en vez de descubrirlo a fin de mes.
   */
  const codigo = nodoDelWorker("05 INT Respuesta");

  /*
   * Todo lo que `fraseDeAccion` nombra, en cualquiera de sus formas: una
   * acción por línea, o dos compartiendo una rama con `||`. Se mira el CUERPO
   * de la función y no el archivo entero, para que nombrar una acción en un
   * comentario de otro lado no la dé por cubierta.
   */
  const desde = codigo.indexOf("function fraseDeAccion");
  const cuerpo = codigo.slice(desde, codigo.indexOf("\n}", desde));

  const conFrasePropia = new Set(
    [...cuerpo.matchAll(/accion === '([A-Z_]{4,})'/g)].map((m) => m[1]),
  );

  const bloque = codigo.match(/const doneText = \{([\s\S]*?)\n\};/);
  assert.ok(bloque, "no se encontró doneText en el nodo 05 INT del worker");

  const enDoneText = new Set(
    [...bloque[1].replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/^\s*([A-Z_]{4,}):/gm)].map((m) => m[1]),
  );

  for (const accion of accionesConEfecto()) {
    assert.ok(
      conFrasePropia.has(accion) || enDoneText.has(accion),
      `${accion} no tiene qué contestar cuando sale bien: cae en "La acción quedó completada"`,
    );
  }
});
