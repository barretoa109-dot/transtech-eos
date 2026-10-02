/**
 * Aprobar por WhatsApp una acción que quedó esperando (01/10/2026).
 *
 * Una acción queda esperando aprobación cuando la persona configuró que la
 * quiere aprobar, o cuando el día ya pasó el presupuesto de acciones
 * automáticas (40 acciones o 240 puntos de riesgo). Antes la única salida era
 * abrir /eos/autonomy en la web; en ago-sep vencieron 8 de 9 sin decidir.
 *
 * ============================================================
 * CÓMO SE APRUEBA: "sí" o "no", sin códigos
 * ============================================================
 *
 * Decisión del dueño (01/10/2026): pedir un código por acción sobra, porque el
 * número ya está vinculado. Ahora:
 *   - una acción esperando: "sí" (o "dale", "ok", "listo") la hace; "no" la descarta;
 *   - varias: van numeradas; "sí" hace todas, "sí 2" solo la segunda, "no" descarta todas.
 *
 * ============================================================
 * POR QUÉ SIGUE SIENDO SEGURO
 * ============================================================
 *
 * - IDENTIDAD: solo llega acá un mensaje de un número VINCULADO, con la firma
 *   de Meta comprobada; la aprobación se busca con el usuario de ese vínculo.
 * - CONTEXTO: un "sí" suelto cuenta como aprobación SOLO si lo último que EOS
 *   le mandó fue el pedido de OK (lleva `MARCA_PEDIDO_OK`). Si EOS había
 *   preguntado otra cosa ("¿querés que lo anote?"), ese "sí" responde a eso y
 *   va al chat: nunca aprueba algo por accidente.
 * - UNA SOLA VEZ: la decisión y la ejecución son las del panel
 *   (`lib/autonomia/resolver-aprobacion.ts`): `pending → approved` una vez y
 *   el Worker Gate consume la aprobación de forma atómica.
 * - AUDITORÍA: "accion_autorizada" / "accion_rechazada" con canal whatsapp.
 * - VENCIMIENTO: el mismo de la aprobación (60 min por defecto).
 */

export type AprobacionPendiente = {
  id: string;
  accion: string;
  payload_snapshot: unknown;
  expires_at: string;
};

/** Lo que identifica al mensaje que pide el OK (el "sí" siguiente se lee como aprobación). */
export const MARCA_PEDIDO_OK = "esperando tu OK";

export type RespuestaDeAprobacion = {
  decision: "approved" | "rejected";
  /** "sí 2": solo la segunda de la lista. Sin número: todas. */
  numero: number | null;
};

const SI = "si|dale|ok|okey|okay|listo|aprobado|apruebo|aprobar|confirmo|confirmado|hacelo|de una|va|claro";
const NO = "no|cancela|cancelar|descarta|descartar|rechazo|rechazar|no gracias|mejor no";

/**
 * "sí", "Sí!", "dale", "sí a todo", "sí 2", "no", "no 1". Tiene que ser el
 * mensaje entero: dentro de una frase más larga ("sí, y además vendí 3…") no
 * es una aprobación y va al chat como siempre.
 */
export function leerRespuestaDeAprobacion(texto: string): RespuestaDeAprobacion | null {
  const limpio = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[.!¡,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = limpio.match(new RegExp(`^(${SI}|${NO})(?: (?:a )?(todo|todas|todos)| ([0-9]{1,6}))?$`));
  if (!m) return null;
  const decision = new RegExp(`^(${NO})$`).test(m[1]) ? "rejected" : "approved";
  // Un número de 3 o más cifras es un código de antes (respuestas a avisos
  // viejos): vale como "sí"/"no" sin número.
  const numero = m[3] && m[3].length <= 2 ? Number(m[3]) : null;
  return { decision, numero };
}

const NOMBRES: Record<string, string> = {
  REGISTRAR_VENTA: "Registrar una venta",
  REGISTRAR_COMPRA: "Registrar una compra",
  AJUSTAR_STOCK: "Ajustar stock",
  CREAR_CONTACTO: "Crear un contacto",
  CREAR_PRODUCTO: "Cargar productos",
  ACTUALIZAR_PRODUCTO: "Actualizar un producto",
  REGISTRAR_GASTO_FIJO: "Anotar un gasto fijo",
  REGISTRAR_MOVIMIENTO_PERSONAL: "Anotar un movimiento personal",
  REGISTRAR_TRANSFERENCIA: "Anotar una transferencia",
  REGISTRAR_DEUDA: "Anotar una deuda",
  REGISTRAR_PAGO_DEUDA: "Anotar un pago de deuda",
  REGISTRAR_COBRO: "Anotar un cobro",
  REGISTRAR_PAGO_COMPRA: "Anotar un pago a proveedor",
  REGISTRAR_TARJETA: "Actualizar una tarjeta",
  REGISTRAR_COMPRA_TARJETA: "Anotar una compra con tarjeta",
  REGISTRAR_OPORTUNIDAD: "Anotar una oportunidad",
  CORREGIR_MOVIMIENTO: "Corregir un movimiento",
  CORREGIR_VENTA: "Corregir una venta",
  CORREGIR_COMPRA: "Corregir una compra",
  ANULAR_VENTA: "Anular una venta",
  ANULAR_COMPRA: "Anular una compra",
  DECLARAR_SALDO: "Declarar un saldo",
  ENVIAR_WHATSAPP_CLIENTE: "Mandar un WhatsApp a un cliente",
  CREAR_TAREA: "Crear una tarea",
  CREAR_OBJETIVO: "Crear un objetivo",
  GUARDAR_MEMORIA: "Guardar un dato",
};

function texto(valor: unknown, max = 60): string {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor.toLocaleString("es-PY");
  if (typeof valor !== "string") return "";
  const t = valor.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Una línea que dice QUÉ se aprueba, con los datos que trae la acción. */
export function resumenDeAccion(accion: string, payload: unknown): string {
  const tipo = accion.trim().toUpperCase();
  const nombre = NOMBRES[tipo] ?? tipo.toLowerCase().replace(/_/g, " ");
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const d = (p.datos && typeof p.datos === "object" ? p.datos : p) as Record<string, unknown>;

  const partes: string[] = [];
  if (Array.isArray(d.items)) {
    const items = (d.items as Record<string, unknown>[])
      .slice(0, 3)
      .map((i) => [texto(i.cantidad), texto(i.producto ?? i.nombre ?? i.concepto, 30)].filter(Boolean).join(" "))
      .filter(Boolean);
    if (items.length) partes.push(items.join(", ") + ((d.items as unknown[]).length > 3 ? "…" : ""));
  }
  for (const campo of ["titulo", "concepto", "descripcion", "acreedor", "tarjeta", "producto", "nombre"]) {
    const v = texto(d[campo]);
    if (v && partes.length < 2) partes.push(v);
  }
  const quien = texto(d.contacto ?? d.cliente ?? d.proveedor, 40);
  if (quien) partes.push(`con ${quien}`);
  const monto = d.monto ?? d.total;
  if (monto !== undefined && monto !== null && texto(monto)) partes.push(`₲ ${texto(monto)}`);

  return partes.length ? `${nombre}: ${partes.join(" · ")}` : nombre;
}

/** El mensaje de WhatsApp con lo que espera aprobación y cómo aprobarlo. */
export function textoDeAprobaciones(pendientes: AprobacionPendiente[], ahora = Date.now()): string {
  const vigentes = pendientes.filter((p) => new Date(p.expires_at).getTime() > ahora).slice(0, 5);
  if (vigentes.length === 0) return "";

  const minutos = Math.max(1, Math.round((Math.min(...vigentes.map((p) => new Date(p.expires_at).getTime())) - ahora) / 60_000));

  if (vigentes.length === 1) {
    const p = vigentes[0];
    return `Esto quedó ${MARCA_PEDIDO_OK} antes de hacerlo:

• ${resumenDeAccion(p.accion, p.payload_snapshot)}

Respondé *sí* para hacerlo o *no* para descartarlo (vence en ${minutos} min).`;
  }

  const lista = vigentes.map((p, i) => `${i + 1}. ${resumenDeAccion(p.accion, p.payload_snapshot)}`).join("\n");
  return `Estas ${vigentes.length} cosas quedaron ${MARCA_PEDIDO_OK} antes de hacerlas:

${lista}

Respondé *sí* para hacer todo, *sí 2* para hacer solo una, o *no* para descartar todo (vence en ${minutos} min).`;
}

/** La línea del enlace web a /eos/autonomy, que por WhatsApp se reemplaza. */
export const LINEA_ENLACE_AUTONOMIA = /^.*\/eos\/autonomy.*$/m;

/** La respuesta de EOS con las instrucciones de WhatsApp en lugar del enlace a la web. */
export function conInstruccionesDeWhatsapp(respuesta: string, instrucciones: string): string {
  if (!instrucciones) return respuesta;
  if (LINEA_ENLACE_AUTONOMIA.test(respuesta)) {
    return respuesta.replace(LINEA_ENLACE_AUTONOMIA, instrucciones).trim();
  }
  return `${respuesta.trim()}\n\n${instrucciones}`;
}

/** Lo que se le contesta después de que decidió. */
export function textoDelResultado(tipo: string, accion: string): string {
  const nombre = (NOMBRES[accion.toUpperCase()] ?? "La acción").replace(/^(\p{Lu})/u, (l) => l);
  switch (tipo) {
    case "ejecutada":
      return `Hecho: ${nombre.charAt(0).toLowerCase()}${nombre.slice(1)} quedó aprobado y registrado.`;
    case "rechazada":
      return "Listo, lo descarté. No se registró nada.";
    case "vencida":
      return "Esa aprobación ya venció, así que no se hizo nada. Si todavía querés hacerlo, pedímelo de nuevo.";
    case "ya_resuelta":
      return "Esa acción ya estaba resuelta: no hice nada nuevo.";
    case "no_revalidada":
    case "no_ejecutada":
    case "sin_ejecutor":
      return "Quedó tu OK anotado, pero no se pudo completar ahora. No está registrado: revisalo en la app, en Autonomía, o pedímelo de nuevo.";
    default:
      return "No pude registrar tu respuesta. Probá de nuevo en un momento o aprobalo desde la app, en Autonomía.";
  }
}

/** Cuando se resolvieron varias: una línea por acción con lo que pasó de verdad. */
export function textoDeVariosResultados(items: { tipo: string; resumen: string }[]): string {
  const estado = (tipo: string) =>
    tipo === "ejecutada"
      ? "hecho"
      : tipo === "rechazada"
        ? "descartado"
        : tipo === "vencida"
          ? "venció, no se hizo"
          : tipo === "ya_resuelta"
            ? "ya estaba resuelto"
            : "no se pudo completar, no está registrado";
  return items.map((i) => `• ${i.resumen}: ${estado(i.tipo)}`).join("\n");
}

/** ¿Lo último que EOS le mandó fue el pedido de OK? Solo entonces un "sí" suelto aprueba. */
export function esRespuestaAlPedidoDeOk(ultimoMensajeDeEOS: string | null | undefined): boolean {
  return typeof ultimoMensajeDeEOS === "string" && ultimoMensajeDeEOS.includes(MARCA_PEDIDO_OK);
}
