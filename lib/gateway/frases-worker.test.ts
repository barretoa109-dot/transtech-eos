import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ACCIONES_INTERNAS } from "./ejecutar.ts";

/**
 * Las frases con las que el Worker le cuenta a la persona qué pasó.
 *
 * ============================================================
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ============================================================
 *
 * Esas frases son lo único que la persona recibe después de que EOS movió
 * plata. No son adorno: son la confirmación, y en varios casos son la ÚNICA
 * forma de darse cuenta de que EOS tocó el registro equivocado —"Ueno pasó de
 * 1.200.000 a 3.000.000" sobre una cuenta que se sabe que tenía otra cosa.
 *
 * Y viven en JavaScript adentro de un nodo de n8n, fuera de TypeScript y fuera
 * de este CI. `verificarFlujo()` comprueba que COMPILAN, no que digan lo
 * correcto.
 *
 * El 10 de septiembre de 2026 salió a producción "Cerró 1 facturas". Los
 * números estaban todos bien y la cartera quedó exacta; lo que estaba mal era
 * el castellano, en el mensaje donde EOS confirma que movió plata. Lo encontró
 * una conversación real, no una prueba.
 *
 * ============================================================
 * CÓMO
 * ============================================================
 *
 * Se lee el workflow exportado, se recorta el nodo hasta donde empieza el
 * código propio de n8n (`const prep`), y lo de arriba —que son puras
 * declaraciones de función— se evalúa. Después se llama a `fraseDeAccion`, que
 * es el mismo despacho que usa producción: así la prueba cubre también la
 * tabla de despacho, que es donde se olvida una acción nueva.
 *
 * Los datos de cada caso son los que devolvieron las funciones REALES de la
 * base cuando se las probó contra producción. No están inventados.
 */

const RAIZ = path.resolve(import.meta.dirname, "..", "..");

function cargarFrases(): (accion: string, result: unknown) => string | null {
  const flujo = JSON.parse(
    fs.readFileSync(path.join(RAIZ, "n8n", "workflows", "eos-background-worker-rc1.json"), "utf8"),
  ) as { nodes: { name: string; parameters?: { jsCode?: string } }[] };

  const nodo = flujo.nodes.find(
    (n) => typeof n.parameters?.jsCode === "string" && n.parameters.jsCode.includes("function fraseDeAccion"),
  );

  assert.ok(nodo, "no se encontró el nodo del worker que arma las frases");

  const codigo = nodo.parameters!.jsCode!;

  /*
   * El corte. Arriba de `const prep` son solo declaraciones de función y una
   * constante; abajo empieza el código que habla con n8n ($input, items) y que
   * no se puede ejecutar acá.
   *
   * Si alguien mueve una función debajo de ese corte, la prueba se cae al
   * llamarla — que es lo correcto: significaría que el archivo cambió de forma
   * y hay que mirarlo.
   */
  const corte = codigo.indexOf("const prep");
  assert.ok(corte > 0, "no se encontró dónde termina el bloque de funciones del nodo");

  const fabrica = new Function(`${codigo.slice(0, corte)}\nreturn fraseDeAccion;`);
  return fabrica() as (accion: string, result: unknown) => string | null;
}

const frase = cargarFrases();

/** El envoltorio con el que le llega el resultado del ejecutor al worker. */
function res(resultado: Record<string, unknown>) {
  return { resultado };
}

// ---------------------------------------------------------------------------
// El candado estructural
// ---------------------------------------------------------------------------

test("toda acción interna decide si tiene frase propia o usa la genérica", () => {
  /*
   * Las que NO tienen frase propia, con su motivo. No es una lista de
   * pendientes: es una decisión escrita.
   *
   * Una tarea, un objetivo, una memoria y un contacto no tienen nada que
   * contar más allá de "quedó" — no hay un número que la persona pueda
   * desmentir. AJUSTAR_STOCK sí lo tendría y es el próximo candidato.
   */
  const CON_FRASE_GENERICA = new Set([
    "CREAR_TAREA",
    "CREAR_OBJETIVO",
    "GUARDAR_MEMORIA",
    "CREAR_CONTACTO",
    "AJUSTAR_STOCK",
  ]);

  const sinDecidir: string[] = [];

  for (const accion of ACCIONES_INTERNAS) {
    if (CON_FRASE_GENERICA.has(accion)) continue;

    // Con datos vacíos la frase puede ser null; lo que se comprueba es que la
    // acción esté CONTEMPLADA en el despacho, y eso se ve pidiéndosela con
    // datos plausibles mínimos.
    const tiene = frase(accion, res({ cuenta: "x", contacto: "x", titulo: "x", descripcion: "x", tarjeta: "x" }));

    if (tiene === null || tiene === undefined) sinDecidir.push(accion);
  }

  assert.deepEqual(
    sinDecidir,
    [],
    "estas acciones dejan efecto durable y no tienen frase propia ni están declaradas como genéricas",
  );
});

// ---------------------------------------------------------------------------
// El bug que salió a producción
// ---------------------------------------------------------------------------

test("no dice \"1 facturas\"", () => {
  const t = frase(
    "REGISTRAR_COBRO",
    res({
      es_venta: true,
      contacto: "Rossana",
      moneda: "PYG",
      aplicado: 25000,
      documentos: [
        { fecha: "2026-08-21", aplicado: 20000, saldaba: true },
        { fecha: "2026-08-31", aplicado: 5000, saldaba: false },
      ],
      cerrados: 1,
      resta: 35000,
    }),
  );

  assert.doesNotMatch(t ?? "", /\b1 facturas\b/, "volvió el plural roto");
  assert.match(t ?? "", /Saldó la del 21\/08/, "con una sola cerrada tiene que decir CUÁL");
  assert.match(t ?? "", /Le quedan ₲ 35\.000/);
});

test("con dos cerradas sí van en plural", () => {
  const t = frase(
    "REGISTRAR_COBRO",
    res({
      es_venta: true,
      contacto: "Rossana",
      moneda: "PYG",
      aplicado: 30000,
      documentos: [
        { fecha: "2026-08-21", aplicado: 20000, saldaba: true },
        { fecha: "2026-08-31", aplicado: 10000, saldaba: true },
      ],
      cerrados: 2,
      resta: 0,
    }),
  );

  assert.match(t ?? "", /Cerró 2 facturas/);
  assert.match(t ?? "", /No te debe más nada/);
});

// ---------------------------------------------------------------------------
// La dirección de la plata
// ---------------------------------------------------------------------------

test("cobrar y pagar no se dicen igual", () => {
  const datos = {
    contacto: "Distribuidora",
    moneda: "PYG",
    aplicado: 400000,
    documentos: [{ fecha: "2026-09-05", aplicado: 400000, saldaba: false }],
    cerrados: 0,
    resta: 500000,
  };

  const cobro = frase("REGISTRAR_COBRO", res({ ...datos, es_venta: true })) ?? "";
  const pago = frase("REGISTRAR_PAGO_COMPRA", res({ ...datos, es_venta: false })) ?? "";

  assert.match(cobro, /^Cobré /);
  assert.match(pago, /^Pagué /);

  // Y el pendiente cambia de dueño: al cliente le quedan, al proveedor le
  // quedo debiendo yo. Decirlo al revés invierte quién debe a quién.
  assert.match(cobro, /Le quedan/);
  assert.match(pago, /Te quedan/);
});

// ---------------------------------------------------------------------------
// Lo que cada frase NO puede callarse
// ---------------------------------------------------------------------------

test("el saldo dice de cuánto venía, que es como se ve un error de cuenta", () => {
  const t = frase(
    "DECLARAR_SALDO",
    res({
      cuenta: "Ueno",
      tipo: "banco",
      moneda: "PYG",
      saldo: 1200000,
      antes: 3000000,
      creada: false,
      repetida: false,
    }),
  );

  assert.match(t ?? "", /Ueno pasó de ₲ 3\.000\.000 a ₲ 1\.200\.000/);
});

test("una cuenta nueva sin clasificar lo dice", () => {
  const t = frase(
    "DECLARAR_SALDO",
    res({
      cuenta: "Ueno",
      tipo: "otro",
      sin_clasificar: true,
      moneda: "PYG",
      saldo: 3000000,
      creada: true,
    }),
  );

  assert.match(t ?? "", /Cuenta nueva/);
  assert.match(t ?? "", /sin clasificar/i);
});

test("el saldo en dólares no se escribe con el signo del guaraní", () => {
  const t = frase(
    "DECLARAR_SALDO",
    res({ cuenta: "Ueno USD", tipo: "banco", moneda: "USD", saldo: 300, creada: true }),
  );

  assert.match(t ?? "", /US\$ 300/);
  assert.doesNotMatch(t ?? "", /₲/);
});

test("la compra con tarjeta avisa que NO es un gasto del mes", () => {
  /*
   * Es contraintuitivo —la persona acaba de gastar— y si EOS no lo dice, va a
   * buscar la compra en su panel del mes, no la va a encontrar, y va a
   * concluir que no se anotó.
   */
  const t = frase(
    "REGISTRAR_COMPRA_TARJETA",
    res({
      tarjeta: "Visa",
      descripcion: "heladera",
      moneda: "PYG",
      monto_cuota: 500000,
      cuotas: 6,
      cuota_estimada: false,
    }),
  );

  assert.match(t ?? "", /6 cuotas de ₲ 500\.000/);
  assert.match(t ?? "", /No es un gasto de este mes/);
});

test("una cuota estimada se declara estimada", () => {
  const t = frase(
    "REGISTRAR_COMPRA_TARJETA",
    res({
      tarjeta: "Visa",
      descripcion: "notebook",
      moneda: "PYG",
      monto_cuota: 400000,
      monto_total: 4800000,
      cuotas: 12,
      cuota_estimada: true,
    }),
  );

  assert.match(t ?? "", /del total dividido 12/);
});

test("una tarjeta sin ciclo dice qué le falta", () => {
  const t = frase(
    "REGISTRAR_TARJETA",
    res({ tarjeta: "Visa", moneda: "PYG", creada: true, falta_ciclo: true }),
  );

  assert.match(t ?? "", /cierra y qué día vence/);
});

test("el resumen de la tarjeta dice el total, el mínimo y cuándo vence", () => {
  const t = frase(
    "REGISTRAR_TARJETA",
    res({
      tarjeta: "Visa",
      moneda: "PYG",
      creada: false,
      pago_total: 1850000,
      pago_minimo: 320000,
      dia_vencimiento: 5,
      falta_ciclo: false,
    }),
  );

  assert.match(t ?? "", /₲ 1\.850\.000/);
  assert.match(t ?? "", /mínimo ₲ 320\.000/);
  assert.match(t ?? "", /Vence el 5/);
});

test("una oportunidad que avanza dice de dónde venía", () => {
  /*
   * El título que se confirma puede NO ser el que la persona nombró: se avanza
   * el negocio que ya estaba y conserva su nombre. Decirlo entero es lo único
   * que permite ver que EOS movió el equivocado.
   */
  const t = frase(
    "REGISTRAR_OPORTUNIDAD",
    res({
      titulo: "Sistema de gestión",
      contacto: "Pedro",
      monto: 5000000,
      moneda: "PYG",
      etapa: "propuesta",
      etapa_antes: "nueva",
      creada: false,
    }),
  );

  assert.match(t ?? "", /Sistema de gestión/);
  assert.match(t ?? "", /de nueva a propuesta enviada/);
});

test("una oportunidad sin monto lo pide en vez de callarlo", () => {
  const t = frase(
    "REGISTRAR_OPORTUNIDAD",
    res({ titulo: "Mantenimiento", contacto: "Pedro", monto: 0, moneda: "PYG", etapa: "nueva", creada: true, sin_monto: true }),
  );

  assert.match(t ?? "", /sin monto/i);
});

test("ganar una oportunidad recuerda que la venta va aparte", () => {
  const t = frase(
    "REGISTRAR_OPORTUNIDAD",
    res({ titulo: "Sistema", contacto: "Pedro", monto: 5000000, moneda: "PYG", etapa: "ganada", etapa_antes: "negociacion", creada: false }),
  );

  assert.match(t ?? "", /vendiste/);
});

test("una corrección dice qué tocó y qué había antes", () => {
  const t = frase(
    "CORREGIR_MOVIMIENTO",
    res({
      antes: { monto: 800000, fecha: "2026-09-08", descripcion: "nafta" },
      despues: { monto: 80000, fecha: "2026-09-08", descripcion: "nafta" },
      coincidencias: 1,
    }),
  );

  assert.match(t ?? "", /Corregí nafta del 2026-09-08/);
  assert.match(t ?? "", /de ₲ 800\.000 a ₲ 80\.000/);
});

// ---------------------------------------------------------------------------
// Nada de esto puede romperse con datos incompletos
// ---------------------------------------------------------------------------

test("con el resultado vacío ninguna frase revienta", () => {
  /*
   * El worker llama a esto sobre lo que devolvió el ejecutor, y una rama que
   * falla acá deja a la persona sin ninguna confirmación de algo que SÍ pasó.
   * Devolver null está bien; tirar una excepción no.
   */
  for (const accion of ACCIONES_INTERNAS) {
    for (const vacio of [{}, { resultado: {} }, { resultado: null }, null, undefined]) {
      assert.doesNotThrow(
        () => frase(accion, vacio),
        `${accion} rompe con ${JSON.stringify(vacio)}`,
      );
    }
  }
});

test("los montos salen con el formato de acá, no con el del servidor", () => {
  // Punto para los miles. "1,200,000" sería el de otro país, y este proyecto
  // ya pagó esa fuga una vez, en el texto de un error de la base.
  const t = frase(
    "DECLARAR_SALDO",
    res({ cuenta: "Ueno", moneda: "PYG", saldo: 1200000, antes: 900000, creada: false }),
  );

  assert.match(t ?? "", /1\.200\.000/);
  assert.doesNotMatch(t ?? "", /1,200,000/);
});

// ---------------------------------------------------------------------------
// Anular: la frase ES la red de seguridad
// ---------------------------------------------------------------------------
//
// EOS elige cuál venta anular —la más reciente que coincida— y esa elección
// puede estar mal. Decir "listo, anulada" sin más deja el error invisible
// hasta que alguien mira el stock, que puede ser a fin de mes.

test("la anulación dice QUÉ anuló: fecha, productos y total", () => {
  const texto = frase("ANULAR_VENTA", res({
    fecha: "2026-09-09",
    total: 370000,
    items: [{ producto: "Conjunto verde oliva talle S", cantidad: 2 }],
    productos_devueltos: 1,
    movimiento_borrado: true,
    candidatos: 1,
  }));

  assert.match(texto ?? "", /2026-09-09/);
  assert.match(texto ?? "", /Conjunto verde oliva talle S/);
  assert.match(texto ?? "", /370\.000/);
});

test("si eligió entre varias, lo dice y ofrece deshacerlo", () => {
  // Es la línea que convierte una elección automática en una revisable.
  const texto = frase("ANULAR_VENTA", res({
    fecha: "2026-09-09",
    total: 185000,
    items: [{ producto: "Conjunto verde oliva M", cantidad: 1 }],
    productos_devueltos: 0,
    movimiento_borrado: true,
    candidatos: 2,
  }));

  assert.match(texto ?? "", /m[áa]s reciente de 2/i);
  assert.match(texto ?? "", /si no era esa/i);
});

test("con una sola candidata no se agrega ruido", () => {
  const texto = frase("ANULAR_VENTA", res({
    fecha: "2026-09-09", total: 185000, items: [], productos_devueltos: 0,
    movimiento_borrado: false, candidatos: 1,
  }));

  assert.ok(!/m[áa]s reciente de/i.test(texto ?? ""));
});

test("anular dos veces no cuenta como una segunda anulación", () => {
  const texto = frase("ANULAR_VENTA", res({ ya_estaba: true }));

  assert.match(texto ?? "", /ya estaba anulada/i);
  assert.ok(!/Anulé la venta/.test(texto ?? ""), "diría que anuló algo que ya estaba");
});

test("el stock sólo se menciona si de verdad volvió alguno", () => {
  // Un producto sin inventario no devuelve nada, y decir "le devolví el stock"
  // sobre algo que nadie cuenta es una afirmación falsa de las baratas.
  const texto = frase("ANULAR_VENTA", res({
    fecha: "2026-09-09", total: 185000, items: [{ producto: "Asesoría", cantidad: 1 }],
    productos_devueltos: 0, movimiento_borrado: true, candidatos: 1,
  }));

  assert.ok(!/stock/i.test(texto ?? ""));
});

// ---------------------------------------------------------------------------
// Corregir una venta: el antes y el después ES la seguridad
// ---------------------------------------------------------------------------
//
// EOS elige cuál venta y cuál renglón. "Listo, corregido" no permite ver que
// corrigió el número equivocado; "de 30 a 3" sí, y en el momento.

test("la corrección de cantidad dice de cuánto a cuánto", () => {
  const texto = frase("CORREGIR_VENTA", res({
    antes: { producto: "Conjunto verde oliva M", cantidad: 30, precio_unitario: 185000 },
    despues: { producto: "Conjunto verde oliva M", cantidad: 3, precio_unitario: 185000 },
    total_anterior: 5550000,
    total: 555000,
    candidatos: 1,
  }));

  assert.match(texto ?? "", /de 30 a 3/);
  assert.match(texto ?? "", /555\.000/);
  assert.match(texto ?? "", /5\.550\.000/, "sin el total anterior no se ve la magnitud del arreglo");
});

test("la corrección de precio se dice como plata, no como número pelado", () => {
  const texto = frase("CORREGIR_VENTA", res({
    antes: { producto: "Blush rhode", cantidad: 1, precio_unitario: 230000 },
    despues: { producto: "Blush rhode", cantidad: 1, precio_unitario: 200000 },
    total_anterior: 230000,
    total: 200000,
    candidatos: 1,
  }));

  assert.match(texto ?? "", /₲ 230\.000 a ₲ 200\.000/);
});

test("si eligió entre varias ventas, lo dice", () => {
  const texto = frase("CORREGIR_VENTA", res({
    antes: { producto: "X", cantidad: 1, precio_unitario: 100 },
    despues: { producto: "X", cantidad: 2, precio_unitario: 100 },
    total_anterior: 100, total: 200, candidatos: 3,
  }));

  assert.match(texto ?? "", /m[áa]s reciente de 3/i);
});

test("un reintento no cuenta como una segunda corrección", () => {
  const texto = frase("CORREGIR_VENTA", res({ ya_estaba: true }));

  assert.match(texto ?? "", /ya estaba hecha/i);
  assert.ok(!/Corregí/.test(texto ?? ""), "diría que corrigió algo por segunda vez");
});
