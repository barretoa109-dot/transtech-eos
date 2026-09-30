/**
 * La batería de frases del cliente ideal (fila C1 del plan maestro y R4 de la
 * hoja de ruta de impacto): ¿el modelo elige el verbo correcto?
 *
 * A diferencia de `evals/casos/`, esto SÍ llama al modelo, así que no corre
 * en CI: se corre a mano con `npm run bateria` (ver `evals/bateria/correr.mts`)
 * y cuesta alrededor de un dólar. NO ejecuta nada: solo lee qué acciones
 * pidió el modelo. Probar "anulá la última" contra el chat real anularía una
 * venta de verdad.
 *
 * Cada caso dice qué verbos se aceptan (`esperado`: una o más combinaciones
 * válidas; `[]` = ninguna acción) y, opcionalmente, cuáles NO puede usar
 * nunca (`prohibido`). Las frases vienen del uso real (almacén, reventa de
 * ropa, porcicultura, ferretería) y de los errores que ya pasaron.
 */

import { CONTEXTOS_RUBRO, FRASES_RUBROS } from "./rubros.ts";

export type Turno = { rol: "usuario" | "eos"; texto: string };

export type Frase = {
  id: string;
  grupo: "venta" | "compra" | "producto" | "cobro" | "contacto" | "correccion" | "pregunta" | "personal" | "otro";
  mensaje: string;
  historial?: Turno[];
  /** Combinaciones aceptadas de verbos (sin RESPONDER). `[[]]` = ninguna acción. */
  esperado: string[][];
  prohibido?: string[];
  /**
   * Lo que la respuesta NO puede decir (expresiones regulares, sin importar
   * mayúsculas). Para los casos donde el dato está a la vista y EOS lo pide
   * igual —"necesito el tipo de cambio", "no tengo a mano el costo"—, que es
   * la queja más repetida del uso real y que mirar solo el verbo no ve.
   */
  noDebeDecir?: string[];
  porque: string;
  /** El rubro de la frase (evals/bateria/rubros.ts). Sin rubro, el almacén de CONTEXTO_NEGOCIO. */
  rubro?: string;
};

/** El negocio de prueba: lo mismo que vería el modelo de una cuenta real chica. */
export const CONTEXTO_NEGOCIO = [
  "Negocio: almacén y venta de balanceado en Luque.",
  "Productos: Balanceado (₲ 180.000, costo ₲ 140.000, stock 25), Harina (₲ 60.000, costo ₲ 45.000, stock 40), Remera básica (₲ 85.000, sin costo, stock 12).",
  "Clientes: Juan Pérez (debe ₲ 900.000), Rossana (debe ₲ 200.000), Ña Rosa.",
  "Proveedores: Agro Sur.",
].join("\n");

const TRAS_VENTA: Turno[] = [
  { rol: "usuario", texto: "vendí 3 bolsas de balanceado a 180 mil a Juan" },
  { rol: "eos", texto: "Listo: registré la venta de 3 Balanceado a Juan Pérez por ₲ 540.000. La ves en Negocio > Ventas." },
];

const TRAS_COMPRA: Turno[] = [
  { rol: "usuario", texto: "compré 20 bolsas de balanceado a 140 mil a Agro Sur" },
  { rol: "eos", texto: "Registré la compra de 20 Balanceado a Agro Sur por ₲ 2.800.000." },
];

const TRAS_GASTO: Turno[] = [
  { rol: "usuario", texto: "gasté 800 mil en nafta" },
  { rol: "eos", texto: "Anoté el gasto de ₲ 800.000 en nafta." },
];

const V = [["REGISTRAR_VENTA"]];
const NADA = [[]];

const FRASES_BASE: Frase[] = [
  // Ventas
  { id: "venta-simple", grupo: "venta", mensaje: "vendí 3 bolsas de balanceado a 180 mil", esperado: V, porque: "La frase más común del ICP." },
  { id: "venta-cliente", grupo: "venta", mensaje: "vendí 2 remeras a 85 mil cada una a Rossana", esperado: V, porque: "Venta con cliente." },
  { id: "venta-credito", grupo: "venta", mensaje: "le vendí a crédito a Juan 5 harinas a 60 mil, me paga el 30", esperado: V, porque: "Fiado con vencimiento." },
  { id: "venta-corta", grupo: "venta", mensaje: "salió 1 balanceado a 180", esperado: V, porque: "Como se dicta entre cliente y cliente." },
  { id: "venta-jopara-lucas", grupo: "venta", mensaje: "vendí 3 bolsa'i de balanceado a 150 lucas", esperado: V, porque: "Jopara y 'lucas' (foso F5)." },
  { id: "venta-jopara-koaga", grupo: "venta", mensaje: "ko'ãga vendí 4 harina a 60 mil", esperado: V, porque: "Jopara al principio de la frase." },
  { id: "venta-fiado", grupo: "venta", mensaje: "fiado a Ña Rosa 2 bolsas de balanceado a 180 mil", esperado: V, porque: "'Fiado' en vez de 'a crédito'." },
  { id: "venta-sin-precio", grupo: "venta", mensaje: "hoy salieron 4 harinas", esperado: V, porque: "Sin precio: sale del catálogo." },
  { id: "venta-producto-nuevo", grupo: "venta", mensaje: "vendí 10 kilos de carne a 45 mil el kilo", esperado: V, porque: "Producto que no está en el catálogo." },

  // Compras y gastos
  { id: "compra-proveedor", grupo: "compra", mensaje: "compré 20 bolsas de balanceado a 140 mil cada una a Agro Sur", esperado: [["REGISTRAR_COMPRA"]], porque: "Compra de mercadería." },
  { id: "gasto-luz", grupo: "compra", mensaje: "pagué 350 mil de luz del local", esperado: [["REGISTRAR_COMPRA"], ["REGISTRAR_GASTO_FIJO"]], porque: "Gasto del negocio sin catálogo." },
  { id: "gasto-fijo-alquiler", grupo: "compra", mensaje: "el alquiler del local es 2 millones por mes", esperado: [["REGISTRAR_GASTO_FIJO"]], porque: "Fijo mensual." },
  { id: "gasto-fijo-quincena", grupo: "compra", mensaje: "le pago al capataz 1.500.000 por quincena", esperado: [["REGISTRAR_GASTO_FIJO"]], porque: "El caso de la porcicultura (7/09)." },
  { id: "gasto-combustible", grupo: "compra", mensaje: "cargué 200 mil de combustible para la camioneta del negocio", esperado: [["REGISTRAR_COMPRA"]], porque: "Gasto variable del negocio." },

  // Productos
  { id: "producto-nuevo", grupo: "producto", mensaje: "agregá el producto alimento para cerdos a 190 mil", esperado: [["CREAR_PRODUCTO"]], porque: "Alta de producto." },
  { id: "producto-precio", grupo: "producto", mensaje: "el balanceado ahora está a 195 mil", esperado: [["ACTUALIZAR_PRODUCTO"]], porque: "Cambio de precio." },
  { id: "producto-costo", grupo: "producto", mensaje: "la remera me cuesta 50 mil", esperado: [["ACTUALIZAR_PRODUCTO"]], prohibido: ["GUARDAR_MEMORIA"], porque: "El costo que se guardaba como nota (7/09)." },
  { id: "producto-costos-varios", grupo: "producto", mensaje: "guardá los costos: harina 45 mil, balanceado 140 mil", esperado: [["ACTUALIZAR_PRODUCTO"]], prohibido: ["GUARDAR_MEMORIA"], porque: "Varios costos juntos: 'guardá' no es memoria." },
  { id: "stock-conteo", grupo: "producto", mensaje: "conté y me quedan 12 bolsas de balanceado", esperado: [["AJUSTAR_STOCK"]], porque: "Conteo físico." },

  // Cobros y pagos
  { id: "cobro-total", grupo: "cobro", mensaje: "Juan me pagó los 900 mil que me debía", esperado: [["REGISTRAR_COBRO"]], porque: "Cobro de fiado." },
  { id: "cobro-parcial", grupo: "cobro", mensaje: "Rossana me pagó la mitad, 100 mil", esperado: [["REGISTRAR_COBRO"]], porque: "Pago parcial (v107)." },
  { id: "pago-proveedor", grupo: "cobro", mensaje: "le pagué a Agro Sur lo que le debía", esperado: [["REGISTRAR_PAGO_COMPRA"]], porque: "Pago a proveedor." },

  // Contactos, tareas, oportunidades
  { id: "contacto-nuevo", grupo: "contacto", mensaje: "agendá a Pedro Gómez, su número es 0981 123456", esperado: [["CREAR_CONTACTO"]], porque: "Alta de contacto." },
  { id: "oportunidad", grupo: "contacto", mensaje: "la ferretería San José me pidió presupuesto por 50 bolsas", esperado: [["REGISTRAR_OPORTUNIDAD"], ["CREAR_CONTACTO", "REGISTRAR_OPORTUNIDAD"]], porque: "Venta posible, no hecha." },
  { id: "tarea", grupo: "otro", mensaje: "recordame mañana llamar al proveedor", esperado: [["CREAR_TAREA"]], porque: "Recordatorio." },
  { id: "whatsapp-cliente", grupo: "otro", mensaje: "mandale a Juan un mensaje que ya llegó su pedido", esperado: [["ENVIAR_WHATSAPP_CLIENTE"]], porque: "Escribirle a un cliente (v186)." },

  // Correcciones (R4: "si me equivoco, lo arreglás con una palabra")
  { id: "anular-ultima", grupo: "correccion", mensaje: "anulá la última", historial: TRAS_VENTA, esperado: [["ANULAR_VENTA"]], porque: "Promesa P2." },
  { id: "anular-estaba-mal", grupo: "correccion", mensaje: "esa venta estaba mal, borrala", historial: TRAS_VENTA, esperado: [["ANULAR_VENTA"]], porque: "Promesa P2." },
  { id: "anular-de-cliente", grupo: "correccion", mensaje: "anulá la venta de Rossana", historial: TRAS_VENTA, esperado: [["ANULAR_VENTA"]], porque: "Con referencia." },
  { id: "corregir-eran-5", grupo: "correccion", mensaje: "no, eran 5", historial: TRAS_VENTA, esperado: [["CORREGIR_VENTA"]], prohibido: ["REGISTRAR_VENTA"], porque: "La corrección más corta posible: no es una venta nueva." },
  { id: "corregir-precio", grupo: "correccion", mensaje: "me equivoqué, era a 150 mil no a 180", historial: TRAS_VENTA, esperado: [["CORREGIR_VENTA"]], prohibido: ["REGISTRAR_VENTA"], porque: "Precio mal dictado." },
  { id: "corregir-30-3", grupo: "correccion", mensaje: "eran 3, no 30", historial: TRAS_VENTA, esperado: [["CORREGIR_VENTA"]], prohibido: ["REGISTRAR_VENTA"], porque: "El ejemplo del prompt." },
  { id: "corregir-jopara", grupo: "correccion", mensaje: "nahániri, eran 2 nomás", historial: TRAS_VENTA, esperado: [["CORREGIR_VENTA"]], prohibido: ["REGISTRAR_VENTA"], porque: "Corrección en jopara." },
  { id: "anular-compra", grupo: "correccion", mensaje: "la compra estaba mal, anulala", historial: TRAS_COMPRA, esperado: [["ANULAR_COMPRA"]], porque: "Compra mal cargada." },
  { id: "corregir-compra", grupo: "correccion", mensaje: "eran 10 bolsas, no 20", historial: TRAS_COMPRA, esperado: [["CORREGIR_COMPRA"]], prohibido: ["REGISTRAR_COMPRA"], porque: "Cantidad de compra mal dictada." },
  { id: "anular-ultima-compra", grupo: "correccion", mensaje: "anulá la última compra", historial: TRAS_VENTA, esperado: [["ANULAR_COMPRA"]], prohibido: ["ANULAR_VENTA"], porque: "Después de una venta, igual pide la compra." },
  { id: "corregir-gasto", grupo: "correccion", mensaje: "era 80 mil, no 800", historial: TRAS_GASTO, esperado: [["CORREGIR_MOVIMIENTO"]], porque: "Gasto personal mal dictado (v148)." },
  { id: "devolucion", grupo: "correccion", mensaje: "me devolvieron una remera", historial: TRAS_VENTA, esperado: [[], ["AJUSTAR_STOCK"]], prohibido: ["ANULAR_VENTA"], porque: "Una devolución NO es anular: la venta existió." },

  // Preguntas: no se anota nada
  { id: "pregunta-semana", grupo: "pregunta", mensaje: "¿cuánto vendí esta semana?", esperado: [[], ["VER_DASHBOARD"]], porque: "Lectura." },
  { id: "pregunta-gane", grupo: "pregunta", mensaje: "¿cuánto gané este mes?", esperado: [[], ["VER_DASHBOARD"]], porque: "Lectura." },
  { id: "pregunta-reponer", grupo: "pregunta", mensaje: "¿qué me conviene reponer?", esperado: NADA, porque: "Consejo, no acción." },
  { id: "saludo", grupo: "pregunta", mensaje: "hola, buen día", esperado: NADA, porque: "No se anota un saludo." },
  { id: "gracias", grupo: "pregunta", mensaje: "gracias!", historial: TRAS_VENTA, esperado: NADA, prohibido: ["REGISTRAR_VENTA"], porque: "Un gracias no repite la venta." },

  // Personal
  { id: "personal-nafta", grupo: "personal", mensaje: "gasté 50 mil en nafta", esperado: [["REGISTRAR_MOVIMIENTO_PERSONAL"], ["REGISTRAR_COMPRA"]], porque: "Ambiguo negocio/persona: cualquiera de los dos anota." },
  { id: "personal-sueldo", grupo: "personal", mensaje: "cobré mi sueldo, 5 millones", esperado: [["REGISTRAR_MOVIMIENTO_PERSONAL"]], porque: "Ingreso personal." },
  { id: "personal-cuota", grupo: "personal", mensaje: "pagué la cuota del préstamo de la cooperativa, 1.200.000", esperado: [["REGISTRAR_PAGO_DEUDA"], ["REGISTRAR_MOVIMIENTO_PERSONAL"]], porque: "Pago de deuda." },
  { id: "objetivo-ambiguo", grupo: "personal", mensaje: "quiero juntar 10 millones para una camioneta", esperado: [["CREAR_OBJETIVO"], []], porque: "Meta de ahorro. Una camioneta puede ser del negocio o de la casa: la regla 3 del ámbito permite preguntar primero, sin acción." },
  { id: "objetivo-personal", grupo: "personal", mensaje: "quiero juntar 5 millones para mi viaje de vacaciones en diciembre", esperado: [["CREAR_OBJETIVO"]], porque: "Meta de ahorro sin ambigüedad: se crea." },

  // Otros
  { id: "excel", grupo: "otro", mensaje: "pasame en excel las ventas del mes", esperado: [["DOCUMENTO"], ["GENERAR_EXCEL"]], porque: "Documento a pedido: viaja en el campo documento." },
  { id: "venta-y-compra", grupo: "otro", mensaje: "vendí 2 balanceados a 180 y compré 10 harinas a 45 mil", esperado: [["REGISTRAR_VENTA", "REGISTRAR_COMPRA"]], porque: "Dos acciones en un mensaje." },
  { id: "memoria-legitima", grupo: "otro", mensaje: "anotá que Juan siempre paga tarde", esperado: [["GUARDAR_MEMORIA"]], porque: "Una nota de verdad sí es memoria." },

  // El dato está a la vista: no se pide (16/09 y 29/09, cuentas reales).
  {
    id: "sesion-larga-tipo-de-cambio",
    grupo: "producto",
    rubro: "ropa",
    historial: [
      { rol: "usuario", texto: "Pasar a guaranies, dolar 6.014,85" },
      { rol: "eos", texto: "Vestido rojo lino: USD 14,92 × 6.014,85 = ₲89.742\nBlusa crema: USD 12,37 × 6.014,85 = ₲74.404\nTotal: USD 27,29 = ₲164.146" },
      { rol: "usuario", texto: "pasar a guaranies dolar 5.917,48" },
      { rol: "eos", texto: "Top blanco bordado: USD 10,88 × 5.917,48 = ₲64.382" },
      { rol: "usuario", texto: "agregale el envio al top 16.496,5gs" },
      { rol: "eos", texto: "Top blanco bordado: ₲64.382 + ₲16.497 = ₲80.879 de costo final. Si querés cargarlo, decime a cuánto lo vendés." },
      { rol: "usuario", texto: "a cuanto deberia vender el top" },
      { rol: "eos", texto: "Con costo ₲80.879: al 35 % de margen, ₲125.000. Yo lo publicaría a ₲125.000." },
      { rol: "usuario", texto: "vendí un conjunto negro M a Lorena a 185 mil" },
      { rol: "eos", texto: "Registré la venta de 1 Conjunto deportivo negro talle M a Lorena por ₲185.000." },
      { rol: "usuario", texto: "agendá a Tamara, es clienta nueva" },
      { rol: "eos", texto: "El contacto quedó guardado. Lo ves en CRM > Contactos." },
    ],
    mensaje: "agregale el costo de envio al vestido rojo 35.503gs",
    esperado: [[], ["ACTUALIZAR_PRODUCTO"], ["CREAR_PRODUCTO"]],
    prohibido: ["REGISTRAR_VENTA"],
    noDebeDecir: ["tipo de cambio", "costo base", "no tengo (a mano )?(el|su) costo", "no me lleg"],
    porque: "La conversión estaba siete turnos atrás: con 10 mensajes de historial quedaba afuera y EOS pedía el tipo de cambio (29/09).",
  },
  {
    id: "margen-con-costo-a-la-vista",
    grupo: "pregunta",
    rubro: "ropa",
    mensaje: "cuanto gano con cada conjunto negro que vendo?",
    esperado: [[]],
    noDebeDecir: ["no tengo (a mano )?(el|su) costo", "pasame el costo", "decime (el|cu[aá]nto) (te )?cuesta"],
    porque: "El costo está en el catálogo: pedirlo es lo que se lee como que EOS no entiende (16/09).",
  },

  // Cambiar cuándo vence (28/09: ocho intentos por la pantalla y "no tengo una acción segura" por chat).
  {
    id: "vencimiento-fecha",
    grupo: "correccion",
    rubro: "ropa",
    historial: [
      { rol: "usuario", texto: "le vendí a crédito 5 conjuntos negros a Camila por 925 mil, me paga el 21" },
      { rol: "eos", texto: "Registré la venta a crédito a Camila por ₲925.000, con pago el 21." },
    ],
    mensaje: "pasale el vencimiento de la venta de Camila al 5 de noviembre",
    esperado: [["CORREGIR_VENTA"]],
    prohibido: ["ANULAR_VENTA", "REGISTRAR_VENTA"],
    noDebeDecir: ["no (tengo|hay) (una )?acci[oó]n", "soporte", "no (se )?puedo cambiar"],
    porque: "Cambiar la fecha no rehace la venta (v225): funciona aunque tenga seña.",
  },
  {
    id: "vencimiento-dias-mas",
    grupo: "correccion",
    rubro: "ropa",
    historial: [
      { rol: "usuario", texto: "le vendí a crédito 5 conjuntos negros a Camila por 925 mil, me paga el 21" },
      { rol: "eos", texto: "Registré la venta a crédito a Camila por ₲925.000, con pago el 21." },
    ],
    mensaje: "a Camila dale 15 días para pagar esa venta",
    esperado: [["CORREGIR_VENTA"]],
    prohibido: ["ANULAR_VENTA", "REGISTRAR_VENTA"],
    noDebeDecir: ["soporte", "no (se )?puedo cambiar"],
    porque: "Correr el plazo es cambiar el vencimiento, no rehacer la venta.",
  },

  // Tarjetas y lo ya anotado (29/09, finanzas personales).
  {
    id: "pago-tarjeta-minimo",
    grupo: "personal",
    mensaje: "ya pagué el mínimo de la Visa",
    esperado: [["REGISTRAR_PAGO_DEUDA"]],
    prohibido: ["REGISTRAR_MOVIMIENTO_PERSONAL", "REGISTRAR_COMPRA_TARJETA"],
    porque: "El pago del resumen va por REGISTRAR_PAGO_DEUDA con acreedor = la tarjeta (v222); como movimiento quedaría contado dos veces.",
  },
  {
    id: "no-lo-veo-no-reenviar",
    grupo: "personal",
    historial: [
      { rol: "usuario", texto: "compré unas zapatillas de 350 mil con la Visa" },
      { rol: "eos", texto: "Anoté la compra en la tarjeta. La ves en Personal, en Tarjetas (no en Movimientos: se paga con el resumen)." },
    ],
    mensaje: "no está, no anotaste nada",
    esperado: [[]],
    prohibido: ["REGISTRAR_COMPRA_TARJETA", "REGISTRAR_MOVIMIENTO_PERSONAL"],
    porque: "Cinco veces la misma compra el 29/09: si ya se confirmó, se dice dónde está y no se reenvía.",
  },
  {
    id: "es-otra-igual",
    grupo: "personal",
    historial: [
      { rol: "usuario", texto: "compré unas zapatillas de 350 mil con la Visa" },
      { rol: "eos", texto: "Anoté la compra en la tarjeta. La ves en Personal, en Tarjetas (no en Movimientos: se paga con el resumen)." },
    ],
    mensaje: "compré otras iguales para mi hijo, también con la Visa",
    esperado: [["REGISTRAR_COMPRA_TARJETA"]],
    porque: "Una segunda compra igual de verdad sí se anota (con repetir: true).",
  },

  // "Responder" en WhatsApp: el pedido es sobre el mensaje citado (29/09, Sofía).
  {
    id: "cita-envio-otro-tema",
    grupo: "correccion",
    rubro: "ropa",
    historial: [
      { rol: "usuario", texto: "vendí un conjunto negro M a Camila a 185 mil" },
      { rol: "eos", texto: "Registré la venta de 1 Conjunto deportivo negro talle M a Camila por ₲ 185.000." },
    ],
    mensaje: "En respuesta a este mensaje de EOS:\n> Calza negra sobrepedido: USD 12 × 5.917,7 = ₲71.012 de costo.\n\nSumale el envío 15.000gs",
    esperado: [["ACTUALIZAR_PRODUCTO"]],
    prohibido: ["REGISTRAR_VENTA", "CORREGIR_VENTA", "ANULAR_VENTA"],
    porque: "Sofía citó la gorra y EOS le sumó el envío a la venta de Sheyla, el último tema de la charla.",
  },
  {
    id: "cita-aqui-esta",
    grupo: "producto",
    rubro: "ropa",
    historial: [
      { rol: "usuario", texto: "agregale el envío de 20 mil a la calza negra" },
      { rol: "eos", texto: "Necesito el tipo de cambio o el costo base en guaraníes de la Calza negra para sumarle el envío." },
    ],
    mensaje: "En respuesta a este mensaje de EOS:\n> Calza negra: USD 12 × 5.917,7 = ₲71.012\n\nAquí está",
    esperado: [["ACTUALIZAR_PRODUCTO"]],
    prohibido: ["REGISTRAR_VENTA", "GUARDAR_MEMORIA"],
    porque: "\"Aquí está\" citando el dato: antes le llegaba solo \"Aquí está\" y contestaba \"no me llegó el dato\".",
  },
];

/** Todas: las del almacén y las de cada rubro. */
export const FRASES: Frase[] = [...FRASES_BASE, ...FRASES_RUBROS];

/** Lo que ve el modelo como negocio de quien escribe, según el rubro de la frase. */
export function contextoDe(frase: Frase): string {
  return (frase.rubro && CONTEXTOS_RUBRO[frase.rubro]) || CONTEXTO_NEGOCIO;
}
