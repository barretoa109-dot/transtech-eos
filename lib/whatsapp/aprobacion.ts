/**
 * Aprobar por WhatsApp una acción que quedó esperando (01/10/2026).
 *
 * Una acción queda esperando aprobación cuando la persona configuró que la
 * quiere aprobar, o cuando el día ya pasó el presupuesto de acciones
 * automáticas (40 acciones o 240 puntos de riesgo: un comercio que anota
 * muchas ventas por WhatsApp llega). Hasta hoy la única salida era abrir
 * /eos/autonomy en la web. Desde WhatsApp eso no se hacía, y la aprobación
 * vencía: en agosto-septiembre vencieron 8 de 9 sin que nadie las aprobara.
 *
 * ============================================================
 * POR QUÉ ES SEGURO
 * ============================================================
 *
 * - IDENTIDAD: solo llega acá un mensaje de un número VINCULADO y verificado a
 *   la cuenta, con la firma de Meta comprobada por el webhook. La aprobación
 *   se busca con el `usuario_id` de ese vínculo: nadie aprueba lo de otro.
 * - QUÉ SE APRUEBA: cada aprobación tiene su código de 6 dígitos, derivado de
 *   su id con HMAC y un secreto del servidor. "Sí" suelto no aprueba nada: la
 *   persona tiene que contestar "SÍ" con el código de ESA acción, que va junto
 *   a su resumen. No hace falta guardarlo: se recalcula.
 * - UNA SOLA VEZ: la decisión y la ejecución son las del panel
 *   (`lib/autonomia/resolver-aprobacion.ts`): `pending → approved` una vez, y
 *   el Worker Gate consume la aprobación de forma atómica. Un reenvío de Meta
 *   ni siquiera llega (índice único por `wa_id`).
 * - AUDITORÍA: queda "accion_autorizada" / "accion_rechazada" con canal
 *   whatsapp y el `wa_id` del mensaje.
 * - VENCIMIENTO: el mismo de la aprobación (60 min por defecto).
 */
import { createHmac } from "node:crypto";

export type AprobacionPendiente = {
  id: string;
  accion: string;
  payload_snapshot: unknown;
  expires_at: string;
};

/** El código de 6 dígitos de una aprobación. Sin secreto no hay código. */
export function codigoDeAprobacion(id: string, secreto: string): string {
  const hmac = createHmac("sha256", `eos-aprobacion-whatsapp:${secreto}`).update(id).digest();
  return String(hmac.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

export type RespuestaDeAprobacion = { decision: "approved" | "rejected"; codigo: string };

/**
 * "SÍ 482913", "si 482913", "Sí, 482913", "NO 482913", "aprobar 482913".
 * Tiene que ser el mensaje entero: dentro de una frase más larga ("sí, y
 * además vendí 3…") no es una aprobación y va al chat como siempre.
 */
export function leerRespuestaDeAprobacion(texto: string): RespuestaDeAprobacion | null {
  const limpio = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[.!¡]+$/g, "");
  const m = limpio.match(/^(si|sí|aprobar|apruebo|ok|no|rechazar|rechazo)[\s,:-]+(\d{6})$/);
  if (!m) return null;
  const decision = /^(no|rechazar|rechazo)$/.test(m[1]) ? "rejected" : "approved";
  return { decision, codigo: m[2] };
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
export function textoDeAprobaciones(pendientes: AprobacionPendiente[], secreto: string, ahora = Date.now()): string {
  const vigentes = pendientes.filter((p) => new Date(p.expires_at).getTime() > ahora);
  if (vigentes.length === 0) return "";

  const lineas = vigentes.slice(0, 5).map((p) => {
    const codigo = codigoDeAprobacion(p.id, secreto);
    const minutos = Math.max(1, Math.round((new Date(p.expires_at).getTime() - ahora) / 60_000));
    return `• ${resumenDeAccion(p.accion, p.payload_snapshot)}\n  Para hacerlo respondé *SÍ ${codigo}* · para descartarlo, *NO ${codigo}* (vence en ${minutos} min)`;
  });

  const encabezado =
    vigentes.length === 1
      ? "Esto quedó esperando tu OK antes de hacerlo:"
      : `Estas ${vigentes.length} cosas quedaron esperando tu OK antes de hacerlas:`;
  const resto = vigentes.length > 5 ? `\n\nHay ${vigentes.length - 5} más en la app, en Autonomía.` : "";

  return `${encabezado}\n\n${lineas.join("\n\n")}${resto}`;
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
