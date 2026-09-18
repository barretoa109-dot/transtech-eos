/**
 * ¿Se le puede escribir a este cliente, ahora, de esta manera?
 *
 * ============================================================
 * POR QUÉ ES UNA FUNCIÓN PURA Y ES LO PRIMERO QUE SE EVALÚA
 * ============================================================
 *
 * WhatsApp Business no es un canal libre. Las reglas que importan:
 *
 *   1. Quien recibe tiene que haber dado su consentimiento, o haber escrito
 *      primero. Un opt-out revoca todo, siempre.
 *   2. Cuando el cliente escribe, se abre una ventana de 24 horas en la que se
 *      puede responder con texto libre. Pasada la ventana, solo se puede
 *      iniciar con una PLANTILLA aprobada por Meta.
 *   3. El número tiene un límite diario de conversaciones y una calidad que
 *      Meta mide: si muchos clientes bloquean o reportan, el canal se limita.
 *
 * Esto NO reemplaza a las políticas de Meta —esas se aplican del otro lado—:
 * las anticipa, para que EOS no intente lo que sabe que va a ser rechazado y
 * para que cada bloqueo quede explicado en el historial con su motivo.
 *
 * Toda decisión devuelve un `motivo` legible. "No se envió" sin motivo es el
 * peor estado posible: el dueño no sabe si EOS falló o si hizo bien en callar.
 *
 * ============================================================
 * QUIÉN AUTORIZÓ
 * ============================================================
 *
 * Un mensaje que EOS manda por su cuenta a un cliente es una decisión con
 * consecuencias comerciales. Sin autorización explícita —el "Sí, escribile"
 * del dueño o una regla de autonomía que lo cubra— no sale: queda pendiente
 * de aprobación. Responder a un cliente que acaba de escribir sí puede
 * hacerlo EOS, porque el cliente lo inició y lo esperaba.
 */

export type EstadoCanal = "pendiente" | "activo" | "pausado" | "desconectado";
export type Consentimiento = "otorgado" | "revocado" | "sin_registro";
export type Autorizacion = "aprobada" | "regla_autonomia" | "ninguna";

export type EntradaPolitica = {
  /** Cuándo se evalúa. ISO con zona. */
  ahora: string;
  canal: {
    estado: EstadoCanal;
    limite_diario: number;
    enviados_hoy: number;
    /** Tope de mensajes automáticos por cliente por día. */
    limite_por_contacto_dia: number;
    /** Hora local de Paraguay en que arranca y termina el silencio. */
    silencio_desde_hora: number;
    silencio_hasta_hora: number;
  };
  consentimiento: Consentimiento;
  /** Cuándo escribió el cliente por última vez. Null si nunca. */
  ultimo_entrante_en: string | null;
  enviados_a_este_contacto_hoy: number;
  /** ¿Se manda una plantilla? Si no, es texto libre. */
  es_plantilla: boolean;
  plantilla_aprobada: boolean;
  origen: "usuario" | "eos_autonomo";
  autorizacion: Autorizacion;
};

export type Decision =
  | { permitido: true; motivo: "ok"; via: "ventana_abierta" | "plantilla" }
  | {
      permitido: false;
      motivo:
        | "canal_inactivo"
        | "opt_out"
        | "sin_consentimiento"
        | "fuera_de_ventana_requiere_plantilla"
        | "plantilla_no_aprobada"
        | "limite_diario_del_canal"
        | "limite_por_contacto"
        | "horario_de_silencio"
        | "requiere_aprobacion";
      /** Frase para mostrarle al dueño, sin jerga. */
      explicacion: string;
    };

const VENTANA_HORAS = 24;
/** Responder dentro de esta ventana corta no se considera "molestar de noche". */
const RESPUESTA_INMEDIATA_MIN = 30;

const EXPLICACIONES: Record<Exclude<Decision, { permitido: true }>["motivo"], string> = {
  canal_inactivo: "El WhatsApp de la empresa no está activo.",
  opt_out: "El cliente pidió no recibir más mensajes.",
  sin_consentimiento:
    "El cliente nunca escribió ni dio su consentimiento: no se le puede iniciar una conversación.",
  fuera_de_ventana_requiere_plantilla:
    "Pasaron más de 24 horas desde que el cliente escribió: solo se puede retomar con una plantilla aprobada.",
  plantilla_no_aprobada: "Esa plantilla todavía no está aprobada por WhatsApp.",
  limite_diario_del_canal: "Se llegó al límite diario de mensajes del número de la empresa.",
  limite_por_contacto: "A este cliente ya se le escribió lo permitido por hoy.",
  horario_de_silencio: "Es horario de silencio: el mensaje se prepara para mañana.",
  requiere_aprobacion: "Este mensaje necesita que el dueño lo apruebe antes de salir.",
};

/** La hora local de Paraguay (UTC-3, sin horario de verano desde 2024). */
export function horaEnParaguay(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 12;
  return new Date(t - 3 * 3_600_000).getUTCHours();
}

function bloquear(motivo: Exclude<Decision, { permitido: true }>["motivo"]): Decision {
  return { permitido: false, motivo, explicacion: EXPLICACIONES[motivo] };
}

function enSilencio(hora: number, desde: number, hasta: number): boolean {
  // El silencio cruza la medianoche (ej. 21 → 7): dentro si es >= desde o < hasta.
  return desde > hasta ? hora >= desde || hora < hasta : hora >= desde && hora < hasta;
}

export function evaluarEnvio(e: EntradaPolitica): Decision {
  // 1. Lo que no se negocia.
  if (e.canal.estado !== "activo") return bloquear("canal_inactivo");
  if (e.consentimiento === "revocado") return bloquear("opt_out");

  const ahora = Date.parse(e.ahora);
  const ultimo = e.ultimo_entrante_en ? Date.parse(e.ultimo_entrante_en) : null;

  const horasDesdeEntrante =
    ultimo !== null && Number.isFinite(ultimo) && Number.isFinite(ahora)
      ? (ahora - ultimo) / 3_600_000
      : null;

  const ventanaAbierta = horasDesdeEntrante !== null && horasDesdeEntrante >= 0 && horasDesdeEntrante < VENTANA_HORAS;

  // 2. Consentimiento: escribió él (ventana abierta) o lo dio por escrito.
  if (!ventanaAbierta && e.consentimiento !== "otorgado") return bloquear("sin_consentimiento");

  // 3. Texto libre solo dentro de la ventana.
  if (!ventanaAbierta && !e.es_plantilla) return bloquear("fuera_de_ventana_requiere_plantilla");
  if (e.es_plantilla && !e.plantilla_aprobada) return bloquear("plantilla_no_aprobada");

  // 4. Autorización: lo que EOS inicia por su cuenta, no sale sin permiso.
  const esRespuesta = ventanaAbierta && e.origen === "eos_autonomo";
  if (e.origen === "eos_autonomo" && !esRespuesta && e.autorizacion === "ninguna") {
    return bloquear("requiere_aprobacion");
  }

  // 5. Límites.
  if (e.canal.enviados_hoy >= e.canal.limite_diario) return bloquear("limite_diario_del_canal");
  if (e.origen === "eos_autonomo" && e.enviados_a_este_contacto_hoy >= e.canal.limite_por_contacto_dia) {
    return bloquear("limite_por_contacto");
  }

  // 6. Silencio nocturno para lo que EOS inicia. Contestar al instante a quien
  //    acaba de escribir no es molestar, aunque sea tarde.
  if (e.origen === "eos_autonomo") {
    const respondeYa = horasDesdeEntrante !== null && horasDesdeEntrante * 60 <= RESPUESTA_INMEDIATA_MIN;
    if (!respondeYa && enSilencio(horaEnParaguay(e.ahora), e.canal.silencio_desde_hora, e.canal.silencio_hasta_hora)) {
      return bloquear("horario_de_silencio");
    }
  }

  return { permitido: true, motivo: "ok", via: ventanaAbierta && !e.es_plantilla ? "ventana_abierta" : "plantilla" };
}
