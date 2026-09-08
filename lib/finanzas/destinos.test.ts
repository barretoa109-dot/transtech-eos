import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clasificar,
  desglosarGastos,
  desglosarIngresos,
  type MovimientoGasto,
} from "./destinos.ts";

function gasto(descripcion: string | null, monto: number, extra: Partial<MovimientoGasto> = {}): MovimientoGasto {
  return { monto, fecha: "2026-08-12", descripcion, ...extra };
}

test("reconoce los servicios como los escribe un banco paraguayo", () => {
  assert.equal(clasificar("PAGO ANDE 08/2026"), "servicios");
  assert.equal(clasificar("Débito automático ESSAP"), "servicios");
  assert.equal(clasificar("TIGO HOGAR - internet"), "servicios");
});

test("ignora las tildes y las mayúsculas", () => {
  // El mismo comercio llega escrito de tres formas distintas según el correo.
  assert.equal(clasificar("FARMACIA PUNTO"), "salud");
  assert.equal(clasificar("Clínica del Sur"), "salud");
  assert.equal(clasificar("CLINICA DEL SUR"), "salud");
});

test("la cuota del colegio es educación, no una deuda", () => {
  // Las dos reglas contienen "cuota". El orden de REGLAS es lo que decide, y
  // equivocarse acá le diría al usuario que se endeuda cuando está educando.
  assert.equal(clasificar("Cuota escolar agosto"), "educacion");
  assert.equal(clasificar("Cuota préstamo personal"), "deudas");
});

test("no clasifica de más: lo que no entiende va a 'otros'", () => {
  // Preferimos un pendiente visible a una respuesta falsa.
  assert.equal(clasificar("TRANSF A JUAN P"), "otros");
  assert.equal(clasificar("compra 4521"), "otros");
  assert.equal(clasificar(null), "otros");
});

test("una palabra suelta no arrastra al gasto entero", () => {
  // "banco" o "pago" aparecen en casi toda descripción bancaria: si fueran
  // patrones, todo caería en el mismo rubro y el desglose no diría nada.
  assert.equal(clasificar("PAGO EN BANCO CONTINENTAL"), "otros");
});

test("la categoría cargada le gana a adivinar del texto", () => {
  // Cuando una integración traiga el rubro real, esa es mejor información.
  assert.equal(clasificar("COMPRA 8891", "mercado"), "mercado");
});

test("una categoría desconocida no se inventa un destino", () => {
  assert.equal(clasificar("TIGO HOGAR", "rubro_raro_del_banco"), "servicios");
  assert.equal(clasificar("COMPRA 8891", "rubro_raro_del_banco"), "otros");
});

test("suma por destino y calcula el peso de cada uno", () => {
  const desglose = desglosarGastos([
    gasto("PAGO ANDE", 300_000),
    gasto("ESSAP agosto", 100_000),
    gasto("Alquiler agosto", 600_000),
  ]);

  assert.equal(desglose.total, 1_000_000);
  assert.equal(desglose.cantidad, 3);

  const [primero, segundo] = desglose.destinos;
  assert.equal(primero.clave, "vivienda");
  assert.equal(primero.total, 600_000);
  assert.equal(primero.porcentaje, 60);
  assert.equal(segundo.clave, "servicios");
  assert.equal(segundo.total, 400_000);
  assert.equal(segundo.cantidad, 2);
});

test("'sin reconocer' va último aunque sea el más grande", () => {
  // Es una tarea pendiente de EOS, no un rubro de gasto del usuario.
  const desglose = desglosarGastos([gasto("TRANSF 8821", 5_000_000), gasto("PAGO ANDE", 200_000)]);

  assert.equal(desglose.destinos[0].clave, "servicios");
  assert.equal(desglose.destinos.at(-1)?.clave, "otros");
  assert.equal(desglose.sin_reconocer, 5_000_000);
});

test("compara contra el período anterior por destino", () => {
  const desglose = desglosarGastos(
    [gasto("PAGO ANDE", 500_000)],
    [gasto("PAGO ANDE", 300_000), gasto("Alquiler julio", 600_000)],
  );

  const servicios = desglose.destinos.find((d) => d.clave === "servicios");
  assert.equal(servicios?.antes, 300_000);
});

test("sin período anterior no inventa una comparación", () => {
  // Mostrar "bajó 100%" contra un mes que no existe sería mentir.
  const desglose = desglosarGastos([gasto("PAGO ANDE", 500_000)]);
  assert.equal(desglose.destinos[0].antes, null);
});

test("un importe roto no ensucia el desglose entero", () => {
  /*
   * Un negativo dejó de ser un importe roto.
   *
   * Esta prueba usaba -50.000 como ejemplo de dato corrupto, y era razonable
   * mientras un gasto solo podía ser positivo. Desde la v141 un gasto negativo
   * significa algo preciso —una devolución— y tiene que restar. Se cambia el
   * ejemplo por uno que sigue siendo indiscutiblemente roto (NaN y cero) sin
   * aflojar lo que la prueba cuida: que un dato ilegible no arrastre al resto.
   */
  const desglose = desglosarGastos([
    gasto("PAGO ANDE", Number.NaN),
    gasto("Alquiler", 0),
    gasto("Alquiler agosto", 600_000),
  ]);

  assert.equal(desglose.total, 600_000);
  assert.equal(desglose.cantidad, 1);
});

test("un gasto negativo NO es un importe roto: es una devolución y resta", () => {
  // El otro lado de la prueba de arriba, para que nadie vuelva a tratarlos
  // igual: lo ilegible se descarta, lo negativo se resta.
  const desglose = desglosarGastos([
    gasto("Alquiler agosto", 600_000),
    gasto("Devolución — alquiler", -100_000),
  ]);

  assert.equal(desglose.total, 500_000);
  // Y no cuenta como una salida más: fueron un pago y una devolución, no dos
  // pagos.
  assert.equal(desglose.cantidad, 1);
});

test("un mes sin gastos devuelve un desglose vacío, no un error", () => {
  const desglose = desglosarGastos([]);
  assert.deepEqual(desglose, { total: 0, cantidad: 0, sin_reconocer: 0, destinos: [] });
});

test("los ingresos se agrupan por su núcleo, no por el texto literal", () => {
  // "Transferencia Juan Pérez agosto" y "TRANSF... 09/2026" son el mismo
  // cliente: si aparecen como dos orígenes distintos, el panel dice que hay el
  // doble de fuentes de ingreso de las que hay.
  const desglose = desglosarIngresos([
    { monto: 1_000_000, fecha: "2026-08-01", descripcion: "Transferencia Juan Perez agosto" },
    { monto: 1_000_000, fecha: "2026-09-01", descripcion: "TRANSFERENCIA JUAN PEREZ - 09/2026" },
    { monto: 300_000, fecha: "2026-08-15", descripcion: "Venta mostrador" },
  ]);

  assert.equal(desglose.origenes.length, 2);
  assert.equal(desglose.origenes[0].total, 2_000_000);
  assert.equal(desglose.origenes[0].cantidad, 2);
  assert.equal(desglose.total, 2_300_000);
});

test("la categoría que puso el usuario manda sobre la descripción", () => {
  const desglose = desglosarIngresos([
    { monto: 500, fecha: "2026-08-01", descripcion: "Cosa rara", categoria: "Alquileres" },
    { monto: 700, fecha: "2026-08-02", descripcion: "Otra cosa", categoria: "Alquileres" },
  ]);

  assert.equal(desglose.origenes.length, 1);
  assert.equal(desglose.origenes[0].etiqueta, "Alquileres");
});

test("de siete orígenes en adelante, el sobrante se junta en una sola línea", () => {
  const movimientos = Array.from({ length: 9 }, (_, i) => ({
    monto: 100 - i,
    fecha: "2026-08-01",
    descripcion: `Cliente ${String.fromCharCode(97 + i)}`,
  }));

  const desglose = desglosarIngresos(movimientos);

  assert.equal(desglose.origenes.length, 7);
  assert.match(desglose.origenes[6].etiqueta, /^Otros 3 orígenes$/);
  assert.equal(desglose.origenes[6].cantidad, 3);
});

test("una devolución RESTA del gasto de su categoría, no suma como ingreso", () => {
  /*
   * El invariante de la v141, y la razón por la que una devolución se guarda
   * como un gasto de monto negativo en vez de vivir en su propia tabla.
   *
   * Si viviera aparte, cada una de las veintitrés consultas que suman gastos
   * tendría que acordarse de restarle esa otra tabla, y la que se olvidara
   * seguiría mostrando el gasto entero sin fallar y sin avisar.
   *
   * El caso: se compra una camisa de 200.000 y se devuelve. En "Ropa" tiene
   * que quedar cero gastado, no 200.000 gastados y 200.000 ganados.
   */
  const desglose = desglosarGastos([
    { monto: 200_000, fecha: "2026-09-05", descripcion: "camisa" },
    { monto: -200_000, fecha: "2026-09-07", descripcion: "Devolución — camisa" },
    { monto: 150_000, fecha: "2026-09-06", descripcion: "supermercado" },
  ]);

  // El total del período es solo lo que de verdad se gastó.
  assert.equal(desglose.total, 150_000);

  // Y la camisa quedó neteada: su categoría no puede seguir mostrando los
  // 200.000 de una compra que se deshizo.
  const conMonto = desglose.destinos.filter((d) => d.total !== 0);
  assert.ok(
    conMonto.every((d) => d.total !== 200_000),
    "la categoría de la camisa sigue mostrando el gasto entero: la devolución no restó",
  );
});
