import { detectarBaja } from "./baja.ts";

/**
 * Qué quiere el cliente, leído de su mensaje.
 *
 * ============================================================
 * QUÉ ES ESTO Y QUÉ NO
 * ============================================================
 *
 * Es el piso determinístico: reglas sobre palabras que un cliente paraguayo
 * usa de verdad, sin llamar a ningún modelo. Sirve para dos cosas que no
 * pueden depender de que una API responda:
 *
 *   · registrar la BAJA (ver `baja.ts`), que es un tema legal y de reputación
 *     del canal, no de comodidad;
 *   · dejar SIEMPRE una intención en el historial, aunque el modelo esté caído
 *     o sin crédito —ya pasó: EOS estuvo mudo por falta de saldo—.
 *
 * El modelo puede afinar la lectura por encima (contexto de la conversación,
 * ironía, mensajes largos). Lo que no puede es bajar de lo que ya detectó
 * esto: una baja o un pedido de hablar con una persona nunca se pierden.
 *
 * ============================================================
 * EL ORDEN ES LA POLÍTICA
 * ============================================================
 *
 * Cuando un mensaje dice dos cosas, gana la más costosa de ignorar:
 * baja > pide una persona > confirma la compra > lo va a pensar > precio >
 * interés. "Quiero comprar, pero antes sáquenme de la lista" es una baja.
 */

export type Intencion =
  | "baja"
  | "pide_persona"
  | "confirma_compra"
  | "lo_pensara"
  | "consulta_precio"
  | "interes"
  | "otro";

export type AccionSugerida =
  | "registrar_baja"
  | "avisar_al_dueno"
  | "crear_oportunidad_ganada"
  | "crear_seguimiento"
  | "crear_oportunidad"
  | "ninguna";

function limpiar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PIDE_PERSONA = [
  "hablar con una persona",
  "hablar con alguien",
  "hablar con un asesor",
  "hablar con el dueno",
  "hablar con la duena",
  "quiero hablar con",
  "pasame con",
  "pasenme con",
  "un humano",
  "una persona real",
  "reclamo",
  "queja",
  "estoy molesto",
  "estoy molesta",
  "no me llego",
  "me cobraron mal",
  "problema con mi",
];

const CONFIRMA = [
  "lo quiero",
  "la quiero",
  "lo compro",
  "la compro",
  "me lo llevo",
  "me la llevo",
  "quiero comprar",
  "quiero contratar",
  "confirmo",
  "confirmado",
  "hagamoslo",
  "cerramos",
  "trato hecho",
  "ya pague",
  "ya te pague",
  "hice el pago",
  "hice la transferencia",
  "te hago la transferencia",
  "mandame los datos para pagar",
  "pasame los datos para pagar",
];

const LO_PENSARA = [
  "lo voy a pensar",
  "lo tengo que pensar",
  "lo pienso",
  "lo estoy pensando",
  "lo voy a consultar",
  "lo consulto",
  "te aviso",
  "te confirmo",
  "despues te confirmo",
  "mas adelante",
  "en unos dias",
  "el mes que viene",
  "por ahora no",
  "lo veo con",
  "hablo con mi socio",
  "hablo con mi esposo",
  "hablo con mi esposa",
];

const PRECIO = [
  "cuanto cuesta",
  "cuanto sale",
  "cuanto es",
  "cuanto vale",
  "cuanto me sale",
  "que precio",
  "el precio",
  "precios",
  "presupuesto",
  "cotizacion",
  "tarifa",
  "cuanto cobran",
];

const INTERES = [
  "me interesa",
  "estoy interesado",
  "estoy interesada",
  "quisiera saber",
  "quiero saber",
  "quiero informacion",
  "mas informacion",
  "catalogo",
  "tienen disponible",
  "tienen stock",
  "hay disponible",
  "como funciona",
  "que incluye",
  "me podrian contar",
  "me pueden contar",
  "me gustaria",
];

const contiene = (t: string, lista: string[]) => lista.some((f) => t.includes(f));

export function clasificarIntencion(texto: string | null | undefined): Intencion {
  if (!texto) return "otro";
  if (detectarBaja(texto)) return "baja";

  const t = limpiar(texto);
  if (!t) return "otro";

  if (contiene(t, PIDE_PERSONA)) return "pide_persona";
  if (contiene(t, CONFIRMA)) return "confirma_compra";
  if (contiene(t, LO_PENSARA)) return "lo_pensara";
  if (contiene(t, PRECIO)) return "consulta_precio";
  if (contiene(t, INTERES)) return "interes";

  return "otro";
}

/**
 * Qué se hace con esa intención.
 *
 * `confirma_compra` NO cierra una venta sola: crea la oportunidad como ganada
 * en el CRM para que la persona la vea, pero la venta —que mueve inventario y
 * plata— la registra una acción de EOS con su propia autorización. Una
 * conversación de WhatsApp no es un comprobante.
 */
export function accionSugerida(intencion: Intencion): AccionSugerida {
  switch (intencion) {
    case "baja":
      return "registrar_baja";
    case "pide_persona":
      return "avisar_al_dueno";
    case "confirma_compra":
      return "crear_oportunidad_ganada";
    case "lo_pensara":
      return "crear_seguimiento";
    case "consulta_precio":
    case "interes":
      return "crear_oportunidad";
    default:
      return "ninguna";
  }
}
