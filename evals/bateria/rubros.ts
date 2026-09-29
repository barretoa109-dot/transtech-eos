/**
 * La batería por rubro (encargado-12 del tablero de lanzamiento).
 *
 * Cada rubro habla distinto: la ferretería vende "bolsas" y "varillas", la
 * lomitería vende de a 30 platos por noche, la peluquería vende servicios que
 * no tienen stock, y el criadero cobra un cerdo terminado por casi dos
 * millones. Un cambio de prompt o de modelo que anda bien con el almacén puede
 * romper a la peluquería sin que nadie lo vea.
 *
 * Cada rubro trae su propio catálogo (lo que el modelo vería en una cuenta
 * real de ese rubro) y 30 frases. Las frases son del estilo de las que ya
 * llegaron por WhatsApp. Cuando lleguen los primeros clientes, se reemplazan
 * por las suyas, tal cual las escribieron.
 */

import type { Frase, Turno } from "./frases.ts";

export const CONTEXTOS_RUBRO: Record<string, string> = {
  ropa: [
    "Negocio: reventa de ropa femenina por Instagram y WhatsApp en Asunción.",
    "Productos: Conjunto deportivo verde oliva talle S (₲ 185.000, costo ₲ 120.000, stock 4), Conjunto deportivo negro talle M (₲ 185.000, costo ₲ 120.000, stock 6), Top básico blanco (₲ 65.000, costo ₲ 35.000, stock 15), Calza negra (₲ 95.000, sin costo, stock 8).",
    "Clientes: Camila (debe ₲ 185.000), Lorena, Tamara.",
    "Proveedores: Mayorista Brasil (le debemos ₲ 1.200.000).",
  ].join("\n"),
  ferreteria: [
    "Negocio: ferretería de barrio en San Lorenzo.",
    "Productos: Cemento bolsa 50 kg (₲ 58.000, costo ₲ 49.000, stock 80), Varilla 8 mm (₲ 42.000, costo ₲ 35.000, stock 150), Pintura látex blanca 18 L (₲ 320.000, costo ₲ 250.000, stock 10), Tornillo 6x1 caja (₲ 25.000, sin costo, stock 30).",
    "Clientes: Constructora Ñandutí (debe ₲ 2.400.000), Don Ramón (debe ₲ 150.000).",
    "Proveedores: Distribuidora Central (le debemos ₲ 4.900.000).",
  ].join("\n"),
  agro: [
    "Negocio: cría de cerdos en Itá.",
    "Productos: Lechón (₲ 350.000, costo ₲ 220.000, stock 18), Cerdo terminado (₲ 1.900.000, costo ₲ 1.300.000, stock 6).",
    "Clientes: Carnicería La Paz (debe ₲ 3.800.000), Frigorífico Norte.",
    "Proveedores: Agro Sur (balanceado, le debemos ₲ 2.040.000), Veterinaria San Roque.",
    "Gastos fijos: capataz ₲ 1.500.000 por quincena.",
  ].join("\n"),
  comida: [
    "Negocio: lomitería con delivery en Fernando de la Mora.",
    "Productos: Lomito árabe (₲ 35.000, costo ₲ 18.000), Hamburguesa completa (₲ 30.000, costo ₲ 15.000), Empanada de carne (₲ 6.000, costo ₲ 2.500), Gaseosa 2 L (₲ 15.000, costo ₲ 10.000, stock 24).",
    "Clientes: Oficina Tigo (debe ₲ 420.000).",
    "Proveedores: Frigorífico Guaraní, Distribuidora de bebidas Paraguarí.",
  ].join("\n"),
  servicios: [
    "Negocio: peluquería y estética en Encarnación.",
    "Productos: Corte de dama (₲ 60.000, servicio), Color completo (₲ 180.000, servicio), Manicura (₲ 40.000, servicio), Shampoo profesional (₲ 95.000, costo ₲ 60.000, stock 10).",
    "Clientas: Laura (debe ₲ 180.000), Marisa, Doña Chiquita.",
    "Proveedores: Belleza Total.",
  ].join("\n"),
};

const V = [["REGISTRAR_VENTA"]];
const C = [["REGISTRAR_COMPRA"]];
const NADA = [[]];
const LECTURA = [[], ["VER_DASHBOARD"]];

function tras(usuario: string, eos: string): Turno[] {
  return [
    { rol: "usuario", texto: usuario },
    { rol: "eos", texto: eos },
  ];
}

type SinRubro = Omit<Frase, "rubro" | "id"> & { id: string };

function delRubro(rubro: string, frases: SinRubro[]): Frase[] {
  return frases.map((f) => ({ ...f, id: `${rubro}-${f.id}`, rubro }));
}

// ---------------------------------------------------------------------------
// Ropa: variantes por talle y color, ventas por Instagram, fiado entre amigas
// ---------------------------------------------------------------------------

const TRAS_VENTA_ROPA = tras(
  "vendí el conjunto verde oliva talle S a Camila",
  "Listo: registré la venta de 1 Conjunto deportivo verde oliva talle S a Camila por ₲ 185.000.",
);

const ROPA = delRubro("ropa", [
  { id: "venta-variante", grupo: "venta", mensaje: "vendí un conjunto negro talle M a 185 mil", esperado: V, porque: "Variante por talle y color." },
  { id: "venta-dos-items", grupo: "venta", mensaje: "Lorena se llevó 2 tops blancos y una calza", esperado: V, porque: "Varios productos en una venta." },
  { id: "venta-descuento", grupo: "venta", mensaje: "vendí una calza a 80 mil, le hice descuento", esperado: V, porque: "Precio distinto al del catálogo." },
  { id: "venta-transferencia", grupo: "venta", mensaje: "Lorena me transfirió 185 mil por un conjunto negro", esperado: V, prohibido: ["REGISTRAR_MOVIMIENTO_PERSONAL", "REGISTRAR_COBRO"], porque: "Lorena no debía nada: es una venta cobrada por transferencia." },
  { id: "venta-fiado", grupo: "venta", mensaje: "Tamara se llevó un top, me paga la semana que viene", esperado: V, porque: "Fiado entre conocidas." },
  { id: "venta-producto-nuevo", grupo: "venta", mensaje: "vendí un vestido floreado a 150 mil", esperado: V, porque: "Producto que no está: se carga con la venta." },
  { id: "venta-instagram", grupo: "venta", mensaje: "salieron 3 tops por insta hoy", esperado: V, porque: "Sin precio: sale del catálogo." },
  { id: "compra-mercaderia", grupo: "compra", mensaje: "compré 10 conjuntos a 120 mil cada uno a Mayorista Brasil", esperado: [["REGISTRAR_COMPRA"], []], porque: "Reposición. Hay dos conjuntos en el catálogo: preguntar cuáles es correcto (29/09: preguntó color y talle para cargar bien el stock)." },
  { id: "compra-envio", grupo: "compra", mensaje: "pagué 80 mil de envío del paquete de Brasil", esperado: C, porque: "Flete del negocio." },
  { id: "gasto-publicidad", grupo: "compra", mensaje: "gasté 50 mil en publicidad de Instagram", esperado: [["REGISTRAR_COMPRA"], ["REGISTRAR_GASTO_FIJO"]], porque: "Gasto del negocio." },
  { id: "producto-nuevo", grupo: "producto", mensaje: "cargá el vestido rojo talle M a 160 mil, tengo 3", esperado: [["CREAR_PRODUCTO"]], porque: "Alta con precio y stock." },
  { id: "producto-sin-precio", grupo: "producto", mensaje: "agregá una campera de jean", esperado: NADA, prohibido: ["GUARDAR_MEMORIA", "CREAR_PRODUCTO"], porque: "Sin precio no se carga: se pregunta." },
  { id: "producto-costo", grupo: "producto", mensaje: "la calza me sale 55 mil con el envío", esperado: [["ACTUALIZAR_PRODUCTO"]], prohibido: ["GUARDAR_MEMORIA"], porque: "El costo va al producto." },
  { id: "stock", grupo: "producto", mensaje: "me quedan 2 conjuntos verdes", esperado: [["AJUSTAR_STOCK"]], porque: "Conteo." },
  { id: "cobro", grupo: "cobro", mensaje: "Camila ya me pagó el conjunto", esperado: [["REGISTRAR_COBRO"]], prohibido: ["REGISTRAR_VENTA"], porque: "Cobro, no venta nueva." },
  { id: "pago-proveedor", grupo: "cobro", mensaje: "le transferí 600 mil a Mayorista Brasil a cuenta", esperado: [["REGISTRAR_PAGO_COMPRA"]], prohibido: ["REGISTRAR_COMPRA"], porque: "Pago parcial a proveedor." },
  { id: "corregir-talle", grupo: "correccion", mensaje: "no, era talle M no S", historial: TRAS_VENTA_ROPA, esperado: [["ANULAR_VENTA", "REGISTRAR_VENTA"], ["CORREGIR_VENTA"], []], prohibido: ["CREAR_PRODUCTO"], porque: "Otro producto: anular y volver a cargar, o preguntar." },
  { id: "corregir-precio", grupo: "correccion", mensaje: "era a 170, le hice precio", historial: TRAS_VENTA_ROPA, esperado: [["CORREGIR_VENTA"]], prohibido: ["REGISTRAR_VENTA"], porque: "Precio mal dictado." },
  { id: "anular", grupo: "correccion", mensaje: "borrá esa, al final no lo llevó", historial: TRAS_VENTA_ROPA, esperado: [["ANULAR_VENTA"]], porque: "La venta no ocurrió." },
  { id: "devolucion", grupo: "correccion", mensaje: "Camila me devolvió el conjunto porque no le quedaba", historial: TRAS_VENTA_ROPA, esperado: [[], ["AJUSTAR_STOCK"], ["ANULAR_VENTA"]], porque: "Devolución: puede preguntar cómo registrarla." },
  { id: "pregunta-mas-vendido", grupo: "pregunta", mensaje: "¿qué es lo que más vendo?", esperado: LECTURA, porque: "Lectura." },
  { id: "pregunta-ganancia", grupo: "pregunta", mensaje: "¿cuánto le gano a cada conjunto?", esperado: LECTURA, porque: "Lectura del margen." },
  { id: "pregunta-deben", grupo: "pregunta", mensaje: "¿quién me debe?", esperado: LECTURA, porque: "Lectura de cartera." },
  { id: "contacto", grupo: "contacto", mensaje: "agendá a Paola, su número es 0982 555 111", esperado: [["CREAR_CONTACTO"]], porque: "Clienta nueva." },
  { id: "tarea", grupo: "otro", mensaje: "recordame el viernes pedir más tops", esperado: [["CREAR_TAREA"]], porque: "Recordatorio." },
  { id: "memoria", grupo: "otro", mensaje: "acordate que Lorena usa talle S", esperado: [["GUARDAR_MEMORIA"]], porque: "Una preferencia sí es memoria." },
  { id: "personal", grupo: "personal", mensaje: "saqué 300 mil de la caja para mi casa", esperado: [["REGISTRAR_MOVIMIENTO_PERSONAL"], []], prohibido: ["REGISTRAR_COMPRA"], porque: "Retiro personal: no es un gasto del negocio." },
  { id: "saludo", grupo: "pregunta", mensaje: "holaa", esperado: NADA, porque: "Saludo." },
  { id: "excel", grupo: "otro", mensaje: "haceme una planilla con lo que vendí este mes", esperado: [["DOCUMENTO"], ["GENERAR_EXCEL"]], porque: "Documento." },
  { id: "jopara", grupo: "venta", mensaje: "oho peteĩ top blanco 65 milpe", esperado: V, porque: "Jopara: salió un top a 65 mil." },
]);

// ---------------------------------------------------------------------------
// Ferretería: cantidades grandes, clientes empresa, compras a crédito
// ---------------------------------------------------------------------------

const TRAS_VENTA_FERRE = tras(
  "vendí 20 bolsas de cemento a la constructora",
  "Listo: registré la venta de 20 Cemento bolsa 50 kg a Constructora Ñandutí por ₲ 1.160.000.",
);
const TRAS_COMPRA_FERRE = tras(
  "compré 100 bolsas de cemento a 49 mil a Distribuidora Central",
  "Registré la compra de 100 Cemento bolsa 50 kg a Distribuidora Central por ₲ 4.900.000.",
);

const FERRETERIA = delRubro("ferreteria", [
  { id: "venta-bolsas", grupo: "venta", mensaje: "vendí 12 bolsas de cemento", esperado: V, porque: "Venta típica." },
  { id: "venta-empresa-credito", grupo: "venta", mensaje: "la constructora se llevó 50 varillas, a 30 días", esperado: V, porque: "Crédito a empresa." },
  { id: "venta-mezcla", grupo: "venta", mensaje: "vendí 2 pinturas y 3 cajas de tornillos a Don Ramón", esperado: V, porque: "Varios ítems con cliente." },
  { id: "venta-producto-nuevo", grupo: "venta", mensaje: "vendí una carretilla a 450 mil", esperado: V, porque: "Producto que no está." },
  { id: "venta-precio-mayorista", grupo: "venta", mensaje: "le dejé el cemento a 55 mil a la constructora, 40 bolsas", esperado: V, porque: "Precio mayorista." },
  { id: "venta-contado", grupo: "venta", mensaje: "salieron 6 varillas al contado", esperado: V, porque: "Contado explícito." },
  { id: "compra-credito", grupo: "compra", mensaje: "compré a crédito 200 varillas a 35 mil a Distribuidora Central, pago en 30 días", esperado: C, porque: "Compra a crédito con plazo." },
  { id: "compra-contado", grupo: "compra", mensaje: "compré 10 pinturas a 250 mil", esperado: C, porque: "Reposición." },
  { id: "gasto-flete", grupo: "compra", mensaje: "pagué 150 mil de flete", esperado: C, porque: "Flete." },
  { id: "gasto-fijo-sueldo", grupo: "compra", mensaje: "el sueldo del ayudante es 2.500.000 por mes", esperado: [["REGISTRAR_GASTO_FIJO"]], porque: "Fijo mensual." },
  { id: "stock-rotura", grupo: "producto", mensaje: "se rompieron 3 bolsas de cemento", esperado: [["AJUSTAR_STOCK"]], prohibido: ["REGISTRAR_VENTA"], porque: "Pérdida, no venta." },
  { id: "producto-precio", grupo: "producto", mensaje: "subí el cemento a 60 mil", esperado: [["ACTUALIZAR_PRODUCTO"]], porque: "Cambio de precio." },
  { id: "producto-nuevo", grupo: "producto", mensaje: "cargá pala punta a 85 mil, me cuesta 60, tengo 15", esperado: [["CREAR_PRODUCTO"]], porque: "Alta completa." },
  { id: "producto-costo-tornillo", grupo: "producto", mensaje: "la caja de tornillos me cuesta 18 mil", esperado: [["ACTUALIZAR_PRODUCTO"]], prohibido: ["GUARDAR_MEMORIA"], porque: "Costo al producto." },
  { id: "cobro-empresa", grupo: "cobro", mensaje: "la constructora pagó 1 millón a cuenta", esperado: [["REGISTRAR_COBRO"]], porque: "Cobro parcial." },
  { id: "cobro-total", grupo: "cobro", mensaje: "Don Ramón pagó todo lo que debía", esperado: [["REGISTRAR_COBRO"]], porque: "Cobro total." },
  { id: "pago-proveedor", grupo: "cobro", mensaje: "le pagué a Distribuidora Central 2 millones", esperado: [["REGISTRAR_PAGO_COMPRA"]], prohibido: ["REGISTRAR_COMPRA"], porque: "Hay deuda con el proveedor: es pago, no compra." },
  { id: "corregir-cantidad", grupo: "correccion", mensaje: "eran 25 bolsas, no 20", historial: TRAS_VENTA_FERRE, esperado: [["CORREGIR_VENTA"]], prohibido: ["REGISTRAR_VENTA"], porque: "Cantidad." },
  { id: "anular-venta", grupo: "correccion", mensaje: "anulá esa, se cayó el pedido", historial: TRAS_VENTA_FERRE, esperado: [["ANULAR_VENTA"]], porque: "Pedido caído." },
  { id: "corregir-compra", grupo: "correccion", mensaje: "no, fueron 80 bolsas", historial: TRAS_COMPRA_FERRE, esperado: [["CORREGIR_COMPRA"]], prohibido: ["REGISTRAR_COMPRA"], porque: "Corregir compra." },
  { id: "oportunidad", grupo: "contacto", mensaje: "la constructora me pidió presupuesto para 300 bolsas de cemento", esperado: [["REGISTRAR_OPORTUNIDAD"]], prohibido: ["REGISTRAR_VENTA"], porque: "Presupuesto, no venta." },
  { id: "contacto-ruc", grupo: "contacto", mensaje: "agendá a Constructora Yvaga, RUC 80099887", esperado: [["CREAR_CONTACTO"]], porque: "Contacto con RUC." },
  { id: "pregunta-stock", grupo: "pregunta", mensaje: "¿cuánto cemento me queda?", esperado: LECTURA, porque: "Lectura." },
  { id: "pregunta-deuda", grupo: "pregunta", mensaje: "¿cuánto le debo a Distribuidora Central?", esperado: LECTURA, porque: "Lectura." },
  { id: "pregunta-margen", grupo: "pregunta", mensaje: "¿qué producto me deja más?", esperado: LECTURA, porque: "Lectura." },
  { id: "tarea", grupo: "otro", mensaje: "recordame el lunes cobrarle a la constructora", esperado: [["CREAR_TAREA"]], porque: "Recordatorio." },
  { id: "memoria", grupo: "otro", mensaje: "anotá que Don Ramón siempre paga a fin de mes", esperado: [["GUARDAR_MEMORIA"]], porque: "Una costumbre sí es memoria." },
  { id: "excel", grupo: "otro", mensaje: "pasame un excel con lo que me deben", esperado: [["DOCUMENTO"], ["GENERAR_EXCEL"]], porque: "Documento." },
  { id: "gracias", grupo: "pregunta", mensaje: "joya, gracias", historial: TRAS_VENTA_FERRE, esperado: NADA, prohibido: ["REGISTRAR_VENTA"], porque: "Un gracias no repite la venta." },
  { id: "jopara", grupo: "venta", mensaje: "osẽ 10 varilla ko'ẽme", esperado: V, porque: "Jopara: salieron 10 varillas a la mañana." },
]);

// ---------------------------------------------------------------------------
// Cría de cerdos: montos grandes, insumos sin catálogo, capataz por quincena
// ---------------------------------------------------------------------------

const TRAS_VENTA_AGRO = tras(
  "vendí 4 lechones a la carnicería",
  "Listo: registré la venta de 4 Lechón a Carnicería La Paz por ₲ 1.400.000.",
);

const AGRO = delRubro("agro", [
  { id: "venta-lechones", grupo: "venta", mensaje: "vendí 6 lechones a 350 mil", esperado: V, porque: "Venta típica." },
  { id: "venta-terminado", grupo: "venta", mensaje: "vendí 2 cerdos terminados al frigorífico a 1.900.000 cada uno", esperado: V, porque: "Montos grandes." },
  { id: "venta-credito", grupo: "venta", mensaje: "la carnicería se llevó 3 lechones, me paga el 15", esperado: V, porque: "Crédito con día." },
  { id: "venta-por-kilo", grupo: "venta", mensaje: "vendí un cerdo de 110 kilos a 17 mil el kilo", esperado: V, porque: "Precio por kilo: la cuenta la hace el sistema o el modelo." },
  { id: "venta-producto-nuevo", grupo: "venta", mensaje: "vendí 20 kilos de chorizo casero a 30 mil el kilo", esperado: V, porque: "Producto que no está." },
  { id: "compra-balanceado", grupo: "compra", mensaje: "compré 15 bolsas de balanceado a 68 mil a Agro Sur", esperado: C, porque: "Insumo sin catálogo: entra como concepto." },
  { id: "compra-veterinaria", grupo: "compra", mensaje: "pagué 240 mil de vacunas en la veterinaria", esperado: C, porque: "Insumo." },
  { id: "compra-varios", grupo: "compra", mensaje: "gasté 600 mil de combustible, 180 mil de vitamina y 90 mil de antiparasitario", esperado: C, porque: "Varios conceptos: una compra." },
  { id: "compra-lechones", grupo: "compra", mensaje: "compré 5 lechones a 250 mil para engorde", esperado: C, porque: "Compra de animales." },
  { id: "capataz-pagado", grupo: "compra", mensaje: "le pagué 1.500.000 al capataz", esperado: C, prohibido: ["REGISTRAR_GASTO_FIJO"], porque: "Ya está como fijo: esto es lo pagado." },
  { id: "fijo-nuevo", grupo: "compra", mensaje: "el alquiler del campo es 3 millones por mes", esperado: [["REGISTRAR_GASTO_FIJO"]], porque: "Fijo nuevo." },
  { id: "stock-nacimiento", grupo: "producto", mensaje: "nacieron 9 lechones", esperado: [["AJUSTAR_STOCK"]], porque: "Suma al stock sin compra." },
  { id: "stock-muerte", grupo: "producto", mensaje: "se me murió un lechón", esperado: [["AJUSTAR_STOCK"]], prohibido: ["REGISTRAR_VENTA"], porque: "Pérdida." },
  { id: "producto-precio", grupo: "producto", mensaje: "el lechón ahora lo vendo a 380 mil", esperado: [["ACTUALIZAR_PRODUCTO"]], porque: "Precio." },
  { id: "producto-costo", grupo: "producto", mensaje: "calculamos que cada lechón me cuesta 240 mil, guardalo", esperado: [["ACTUALIZAR_PRODUCTO"]], prohibido: ["GUARDAR_MEMORIA"], porque: "El caso del 7/09: el costo va al producto." },
  { id: "cobro", grupo: "cobro", mensaje: "la carnicería me pagó 2 millones", esperado: [["REGISTRAR_COBRO"]], porque: "Cobro parcial." },
  { id: "pago-proveedor", grupo: "cobro", mensaje: "le pagué a Agro Sur lo del balanceado", esperado: [["REGISTRAR_PAGO_COMPRA"]], prohibido: ["REGISTRAR_COMPRA"], porque: "Pago de deuda con proveedor." },
  { id: "corregir-precio", grupo: "correccion", mensaje: "era a 330 cada uno", historial: TRAS_VENTA_AGRO, esperado: [["CORREGIR_VENTA"]], prohibido: ["REGISTRAR_VENTA"], porque: "Precio." },
  { id: "corregir-cantidad-jopara", grupo: "correccion", mensaje: "nahániri, mbohapy añoite", historial: TRAS_VENTA_AGRO, esperado: [["CORREGIR_VENTA"]], prohibido: ["REGISTRAR_VENTA"], porque: "Jopara: no, eran solo 3." },
  { id: "anular", grupo: "correccion", mensaje: "anulá esa venta", historial: TRAS_VENTA_AGRO, esperado: [["ANULAR_VENTA"]], porque: "Anular." },
  { id: "pregunta-rinde", grupo: "pregunta", mensaje: "¿me está rindiendo criar lechones?", esperado: LECTURA, porque: "Lectura." },
  { id: "pregunta-gastos", grupo: "pregunta", mensaje: "¿cuánto gasté en balanceado este mes?", esperado: LECTURA, porque: "Lectura." },
  { id: "pregunta-consejo", grupo: "pregunta", mensaje: "¿me conviene vender ahora o engordar más?", esperado: NADA, porque: "Consejo." },
  { id: "tarea", grupo: "otro", mensaje: "recordame vacunar el jueves", esperado: [["CREAR_TAREA"]], porque: "Recordatorio." },
  { id: "tarea-repite", grupo: "otro", mensaje: "el 5 de cada mes tengo que pagar el alquiler del campo, avisame", esperado: [["CREAR_TAREA"]], porque: "Tarea que se repite." },
  { id: "memoria", grupo: "otro", mensaje: "anotá que el frigorífico paga a 30 días siempre", esperado: [["GUARDAR_MEMORIA"]], porque: "Costumbre." },
  { id: "objetivo", grupo: "otro", mensaje: "quiero facturar 100 millones este año con los cerdos", esperado: [["CREAR_OBJETIVO"]], porque: "Meta del negocio." },
  { id: "contacto", grupo: "contacto", mensaje: "agendá a Frigorífico Sur, el que atiende es Carlos, 0971 222 333", esperado: [["CREAR_CONTACTO"], ["CREAR_CONTACTO", "GUARDAR_MEMORIA"]], porque: "Contacto. Quién atiende no tiene campo: guardarlo como memoria está bien." },
  { id: "saludo", grupo: "pregunta", mensaje: "mba'éichapa", esperado: NADA, porque: "Saludo en guaraní." },
  { id: "venta-y-compra", grupo: "otro", mensaje: "vendí 2 lechones a 350 y compré 5 bolsas de balanceado a 68", esperado: [["REGISTRAR_VENTA", "REGISTRAR_COMPRA"]], porque: "Dos acciones." },
]);

// ---------------------------------------------------------------------------
// Lomitería: muchas ventas chicas, platos sin stock, insumos del día
// ---------------------------------------------------------------------------

const TRAS_VENTA_COMIDA = tras(
  "vendí 3 lomitos y 2 gaseosas",
  "Listo: registré la venta de 3 Lomito árabe y 2 Gaseosa 2 L por ₲ 135.000.",
);

const COMIDA = delRubro("comida", [
  { id: "venta-combo", grupo: "venta", mensaje: "salieron 4 lomitos y 2 gaseosas", esperado: V, porque: "Pedido típico." },
  { id: "venta-noche", grupo: "venta", mensaje: "esta noche vendí 22 hamburguesas", esperado: V, porque: "Resumen de la noche." },
  { id: "venta-empanadas", grupo: "venta", mensaje: "vendí una docena de empanadas", esperado: V, porque: "Docena." },
  { id: "venta-delivery", grupo: "venta", mensaje: "pedido de delivery: 2 lomitos, 1 hamburguesa y 1 gaseosa", esperado: V, porque: "Pedido con varios ítems." },
  { id: "venta-cuenta-oficina", grupo: "venta", mensaje: "la oficina de Tigo pidió 10 hamburguesas, me pagan el viernes", esperado: [["REGISTRAR_VENTA"], ["REGISTRAR_VENTA", "CREAR_TAREA"]], porque: "A crédito a empresa. La venta no tiene vencimiento por día de la semana: sumar el recordatorio del viernes está bien." },
  { id: "venta-producto-nuevo", grupo: "venta", mensaje: "vendí 3 pizzas a 45 mil", esperado: V, porque: "Plato nuevo." },
  { id: "venta-total-dia", grupo: "venta", mensaje: "hoy hice 1.200.000 en total", esperado: [["REGISTRAR_VENTA"], []], porque: "Solo el total: puede anotarlo o preguntar el detalle." },
  { id: "compra-carne", grupo: "compra", mensaje: "compré 15 kilos de carne a 42 mil el kilo al frigorífico", esperado: C, porque: "Insumo." },
  { id: "compra-bebidas", grupo: "compra", mensaje: "compré 24 gaseosas de 2 litros a 10 mil cada una", esperado: C, porque: "Reposición con catálogo." },
  { id: "compra-pan", grupo: "compra", mensaje: "pan 80 mil, lechuga y tomate 45 mil", esperado: C, porque: "Insumos del día." },
  { id: "gasto-gas", grupo: "compra", mensaje: "cambié la garrafa, 130 mil", esperado: C, porque: "Gasto del local." },
  { id: "gasto-delivery-fijo", grupo: "compra", mensaje: "al delivery le pago 100 mil por semana", esperado: [["REGISTRAR_GASTO_FIJO"]], porque: "Fijo semanal." },
  { id: "producto-precio", grupo: "producto", mensaje: "el lomito ahora sale 38 mil", esperado: [["ACTUALIZAR_PRODUCTO"]], porque: "Precio." },
  { id: "producto-nuevo", grupo: "producto", mensaje: "agregá el lomito especial a 45 mil", esperado: [["CREAR_PRODUCTO"]], porque: "Alta." },
  { id: "producto-costo", grupo: "producto", mensaje: "la hamburguesa me cuesta 17 mil ahora", esperado: [["ACTUALIZAR_PRODUCTO"]], prohibido: ["GUARDAR_MEMORIA"], porque: "Costo." },
  { id: "stock-gaseosas", grupo: "producto", mensaje: "me quedan 6 gaseosas", esperado: [["AJUSTAR_STOCK"]], porque: "Conteo." },
  { id: "cobro", grupo: "cobro", mensaje: "Tigo pagó lo que debía", esperado: [["REGISTRAR_COBRO"]], porque: "Cobro." },
  { id: "corregir-cantidad", grupo: "correccion", mensaje: "eran 4 lomitos, no 3", historial: TRAS_VENTA_COMIDA, esperado: [["CORREGIR_VENTA"]], prohibido: ["REGISTRAR_VENTA"], porque: "Cantidad." },
  { id: "anular", grupo: "correccion", mensaje: "cancelaron el pedido, borralo", historial: TRAS_VENTA_COMIDA, esperado: [["ANULAR_VENTA"]], porque: "Pedido cancelado." },
  { id: "agregar-al-pedido", grupo: "correccion", mensaje: "y una empanada más", historial: TRAS_VENTA_COMIDA, esperado: [["REGISTRAR_VENTA"], ["CORREGIR_VENTA"]], porque: "Agregado: venta nueva o corrección, las dos dejan bien la plata." },
  { id: "pregunta-hoy", grupo: "pregunta", mensaje: "¿cuánto vendí hoy?", esperado: LECTURA, porque: "Lectura." },
  { id: "pregunta-mejor", grupo: "pregunta", mensaje: "¿qué plato me deja más ganancia?", esperado: LECTURA, porque: "Lectura." },
  { id: "pregunta-precio", grupo: "pregunta", mensaje: "¿a cuánto debería vender el lomito para ganar el doble?", esperado: NADA, prohibido: ["ACTUALIZAR_PRODUCTO"], porque: "Pregunta, no pedido de cambio." },
  { id: "tarea", grupo: "otro", mensaje: "mañana a las 9 tengo que pedir carne, recordame", esperado: [["CREAR_TAREA"]], porque: "Con hora." },
  { id: "memoria", grupo: "otro", mensaje: "anotá que los viernes vendo el doble", esperado: [["GUARDAR_MEMORIA"]], porque: "Nota del negocio." },
  { id: "oportunidad", grupo: "contacto", mensaje: "un colegio me pidió presupuesto por 80 hamburguesas para una fiesta", esperado: [["REGISTRAR_OPORTUNIDAD"], ["CREAR_CONTACTO", "REGISTRAR_OPORTUNIDAD"]], prohibido: ["REGISTRAR_VENTA"], porque: "Presupuesto." },
  { id: "personal", grupo: "personal", mensaje: "pagué 450 mil del colegio de mi hijo", esperado: [["REGISTRAR_MOVIMIENTO_PERSONAL"]], prohibido: ["REGISTRAR_COMPRA"], porque: "Gasto personal." },
  { id: "gracias", grupo: "pregunta", mensaje: "👍", historial: TRAS_VENTA_COMIDA, esperado: NADA, prohibido: ["REGISTRAR_VENTA"], porque: "Un pulgar no repite la venta." },
  { id: "excel", grupo: "otro", mensaje: "pasame en pdf las ventas de la semana", esperado: [["DOCUMENTO"], ["GENERAR_PDF"]], porque: "Documento." },
  { id: "jopara", grupo: "venta", mensaje: "osẽ 5 empanada ha 2 gaseosa", esperado: V, porque: "Jopara." },
]);

// ---------------------------------------------------------------------------
// Peluquería: servicios sin stock, clientas fijas, productos de reventa
// ---------------------------------------------------------------------------

const TRAS_VENTA_PELU = tras(
  "le hice color a Laura",
  "Listo: registré la venta de 1 Color completo a Laura por ₲ 180.000.",
);

const SERVICIOS = delRubro("servicios", [
  { id: "venta-servicio", grupo: "venta", mensaje: "le hice un corte a Marisa", esperado: V, porque: "Un servicio es una venta." },
  { id: "venta-varios", grupo: "venta", mensaje: "hoy hice 5 cortes y 2 manicuras", esperado: V, porque: "Resumen del día." },
  { id: "venta-producto", grupo: "venta", mensaje: "le vendí un shampoo a Doña Chiquita", esperado: V, porque: "Producto de reventa." },
  { id: "venta-fiado", grupo: "venta", mensaje: "Marisa se hizo color, me paga el sábado", esperado: V, porque: "Fiado." },
  { id: "venta-servicio-nuevo", grupo: "venta", mensaje: "hice un alisado a 250 mil", esperado: V, porque: "Servicio que no está." },
  { id: "venta-precio-distinto", grupo: "venta", mensaje: "corte a Laura, le cobré 50 mil", esperado: V, porque: "Precio distinto." },
  { id: "compra-productos", grupo: "compra", mensaje: "compré 6 shampoos a 60 mil a Belleza Total", esperado: C, porque: "Reposición." },
  { id: "compra-insumos", grupo: "compra", mensaje: "gasté 320 mil en tinturas", esperado: C, porque: "Insumo sin catálogo." },
  { id: "gasto-fijo", grupo: "compra", mensaje: "el alquiler del salón es 2.800.000 por mes", esperado: [["REGISTRAR_GASTO_FIJO"]], porque: "Fijo." },
  { id: "gasto-comision", grupo: "compra", mensaje: "le pagué 400 mil de comisión a la manicura", esperado: C, porque: "Pago a personal." },
  { id: "producto-precio", grupo: "producto", mensaje: "el corte de dama ahora es 70 mil", esperado: [["ACTUALIZAR_PRODUCTO"]], porque: "Precio de un servicio." },
  { id: "producto-nuevo", grupo: "producto", mensaje: "agregá pedicura a 50 mil", esperado: [["CREAR_PRODUCTO"]], porque: "Servicio nuevo." },
  { id: "stock", grupo: "producto", mensaje: "me quedan 4 shampoos", esperado: [["AJUSTAR_STOCK"]], porque: "Conteo." },
  { id: "cobro", grupo: "cobro", mensaje: "Laura me pagó el color", esperado: [["REGISTRAR_COBRO"]], prohibido: ["REGISTRAR_VENTA"], porque: "Cobro de lo fiado." },
  { id: "cobro-parcial", grupo: "cobro", mensaje: "Laura me dio 100 mil a cuenta", esperado: [["REGISTRAR_COBRO"]], porque: "Pago parcial." },
  { id: "corregir-servicio", grupo: "correccion", mensaje: "no era color, era corte", historial: TRAS_VENTA_PELU, esperado: [["ANULAR_VENTA", "REGISTRAR_VENTA"], []], prohibido: ["CREAR_PRODUCTO"], porque: "Otro servicio: anular y volver a cargar, o preguntar." },
  { id: "corregir-precio", grupo: "correccion", mensaje: "le cobré 160, no 180", historial: TRAS_VENTA_PELU, esperado: [["CORREGIR_VENTA"]], prohibido: ["REGISTRAR_VENTA"], porque: "Precio." },
  { id: "anular", grupo: "correccion", mensaje: "anulá eso, al final no vino", historial: TRAS_VENTA_PELU, esperado: [["ANULAR_VENTA"]], porque: "No ocurrió." },
  { id: "turno", grupo: "otro", mensaje: "Marisa viene el jueves a las 4 para color", esperado: [["CREAR_TAREA"]], prohibido: ["REGISTRAR_VENTA"], porque: "Un turno es agenda, no venta." },
  { id: "turno-repite", grupo: "otro", mensaje: "Doña Chiquita viene todos los viernes a las 10", esperado: [["CREAR_TAREA"]], porque: "Turno que se repite." },
  { id: "memoria", grupo: "otro", mensaje: "anotá que Laura es alérgica a la tintura con amoníaco", esperado: [["GUARDAR_MEMORIA"]], porque: "Dato de la clienta." },
  { id: "pregunta-dia", grupo: "pregunta", mensaje: "¿cuánto hice hoy?", esperado: LECTURA, porque: "Lectura." },
  { id: "pregunta-clientas", grupo: "pregunta", mensaje: "¿quién es mi mejor clienta?", esperado: LECTURA, porque: "Lectura." },
  { id: "pregunta-consejo", grupo: "pregunta", mensaje: "¿me conviene subir los precios?", esperado: NADA, prohibido: ["ACTUALIZAR_PRODUCTO"], porque: "Consejo." },
  { id: "contacto", grupo: "contacto", mensaje: "agendá a Nati, 0985 444 000", esperado: [["CREAR_CONTACTO"]], porque: "Clienta nueva." },
  { id: "personal", grupo: "personal", mensaje: "me pagaron el alquiler del departamento, 2 millones", esperado: [["REGISTRAR_MOVIMIENTO_PERSONAL"]], prohibido: ["REGISTRAR_VENTA"], porque: "Ingreso personal." },
  { id: "objetivo", grupo: "otro", mensaje: "quiero juntar 8 millones para renovar el salón en marzo", esperado: [["CREAR_OBJETIVO"], []], porque: "Meta con monto y fecha (puede preguntar si es del negocio)." },
  { id: "saludo", grupo: "pregunta", mensaje: "buenas tardes EOS", esperado: NADA, porque: "Saludo." },
  { id: "excel", grupo: "otro", mensaje: "necesito una planilla de lo que me deben las clientas", esperado: [["DOCUMENTO"], ["GENERAR_EXCEL"]], porque: "Documento." },
  { id: "jopara", grupo: "venta", mensaje: "ajapo 3 corte ko pyharevépe", esperado: V, porque: "Jopara: hice 3 cortes esta mañana." },
]);

export const FRASES_RUBROS: Frase[] = [...ROPA, ...FERRETERIA, ...AGRO, ...COMIDA, ...SERVICIOS];
