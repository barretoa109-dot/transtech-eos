import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { leerSeguimientos } from "./seguimientos-datos.ts";
import type { Seguimiento } from "./seguimientos.ts";

/**
 * A quién hay que retomar, para que el chat lo sepa.
 *
 * ============================================================
 * POR QUÉ
 * ============================================================
 *
 * EOS le propone a la persona escribirle a un cliente ("Marcos no contesta hace 4 días, ¿le
 * escribo esto?") y la respuesta natural es "sí, escribile" en el chat. Para que esa frase
 * signifique algo, el chat tiene que saber CUÁL es el mensaje propuesto y a quién. Sin esto, el
 * modelo tendría que inventarlo — justo lo que un mensaje a un tercero no permite.
 *
 * ============================================================
 * LO QUE COSTÓ Y CÓMO SE ACOTA
 * ============================================================
 *
 * Esto va en el camino crítico de CADA mensaje. Por eso:
 *   · solo para quien tiene el módulo CRM (una consulta);
 *   · con un plazo: si el cálculo tarda más de `plazoMs`, el chat sigue SIN esta sección. Quedarse
 *     sin contestar por no poder listar seguimientos sería peor que contestar sin listarlos;
 *   · corto: los cinco más importantes, sin los de prioridad 3, con el borrador recortado.
 */

const MAX_ITEMS = 5;
const MAX_BORRADOR = 280;
const PLAZO_MS = 800;

/** Por qué se lo menciona, en pocas palabras. */
function motivo(s: Seguimiento): string {
  switch (s.tipo) {
    case "vencido":
      return "seguimiento vencido";
    case "vence_hoy":
      return "seguimiento de hoy";
    case "sin_respuesta":
      return `no contesta hace ${s.dias} días`;
    case "estancada":
      return `oportunidad estancada hace ${s.dias} días`;
    case "lead_sin_contactar":
      return "todavía no lo contactaste";
    case "cierre_proximo":
      return "se acerca el cierre";
  }
}

function recortar(texto: string, max: number): string {
  const t = texto.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** El bloque de texto; vacío si no hay nada que valga la pena decirle al modelo. */
export function textoSeguimientos(seguimientos: Seguimiento[]): string {
  const importantes = seguimientos.filter((s) => s.prioridad <= 2).slice(0, MAX_ITEMS);
  if (importantes.length === 0) return "";

  const lineas = importantes.map((s) => {
    const cabeza = `- ${s.contacto_nombre}: ${motivo(s)}.`;

    if (s.accion === "escribir" && s.puede_escribir && s.borrador) {
      return `${cabeza} Mensaje propuesto: «${recortar(s.borrador, MAX_BORRADOR)}»`;
    }
    if (s.accion === "escribir") {
      return `${cabeza} No se le puede escribir desde EOS (falta el canal de WhatsApp, su teléfono, o pidió la baja).`;
    }
    return `${cabeza} ${s.accion === "llamar" ? "Conviene llamarlo." : "Conviene revisarlo."}`;
  });

  return [
    "Clientes para retomar hoy (CRM):",
    ...lineas,
    "",
    "Si la persona te dice «sí, escribile» / «mandáselo» sobre uno de estos, usá ENVIAR_WHATSAPP_CLIENTE con",
    "ESE mensaje propuesto (o el que ella te corrija). Sin una confirmación suya, no lo mandes: proponelo.",
  ].join("\n");
}

type Opciones = {
  hoy: string;
  plazoMs?: number;
  leer?: typeof leerSeguimientos;
};

export async function contextoDeSeguimientos(admin: ClienteSinTipos, usuarioId: string, opciones: Opciones): Promise<string> {
  const leer = opciones.leer ?? leerSeguimientos;

  try {
    const { data: modulo } = await admin
      .from("eos_usuario_modulos")
      .select("usuario_id")
      .eq("usuario_id", usuarioId)
      .eq("modulo_codigo", "crm")
      .eq("estado", "activo")
      .maybeSingle();

    if (!modulo) return "";

    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const plazo = new Promise<null>((resolver) => {
      temporizador = setTimeout(() => resolver(null), opciones.plazoMs ?? PLAZO_MS);
    });

    try {
      const lista = await Promise.race([leer(admin, usuarioId, opciones.hoy), plazo]);
      return lista === null ? "" : textoSeguimientos(lista);
    } finally {
      clearTimeout(temporizador);
    }
  } catch (error) {
    // Sin esta sección el chat funciona igual.
    console.error("EOS: no se pudieron leer los seguimientos para el chat:", error);
    return "";
  }
}
