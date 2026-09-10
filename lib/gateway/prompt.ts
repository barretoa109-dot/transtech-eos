/**
 * Etapa 1: armar el prompt del usuario.
 *
 * Puerto del nodo `03 GW Construir Prompt Rápido`. La forma del texto se
 * conserva exactamente —los mismos encabezados, el mismo orden, los mismos
 * saltos de línea— porque el modelo aprende a leer esa estructura y cambiarla
 * cambia las respuestas sin que nadie haya tocado el prompt del sistema.
 *
 * Lo que se prueba acá es lo que se puede romper sin darse cuenta: que el
 * historial venga en el orden correcto y con el rol bien puesto, que el bloque
 * del negocio NO aparezca cuando no hay datos, y que la imagen se anuncie solo
 * cuando de verdad viaja.
 */

import type { Entrada, HistorialItem } from "./entrada.ts";

export type ParteOpenAI =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

export type Prompt = {
  prompt_eos: string;
  tiene_imagen: boolean;
  contenido: ParteOpenAI[];
};

export const SIN_HISTORIAL = "Sin historial previo.";

/**
 * El historial como texto plano.
 *
 * Cualquier rol que no sea exactamente "eos" se muestra como Usuario. Es
 * deliberado: ante la duda, atribuirle el turno a la persona es el error
 * inofensivo — el otro haría que el modelo crea que ya dijo algo que nunca
 * dijo, y siga hablando desde ahí.
 */
export function historialComoTexto(historial: HistorialItem[]): string {
  const lineas = historial
    .map((h) => {
      const rol = String(h.rol ?? h.role ?? "").toLowerCase() === "eos" ? "EOS" : "Usuario";
      const texto = String(h.texto ?? h.mensaje ?? h.content ?? "").trim();
      return texto ? `${rol}: ${texto}` : "";
    })
    .filter(Boolean);

  return lineas.length > 0 ? lineas.join("\n") : SIN_HISTORIAL;
}

/**
 * El bloque con los números del negocio y con lo que ya se sabe de la persona.
 *
 * Vacío cuando la persona todavía no cargó nada o no tiene ERP ni CRM. Es
 * importante que quede FUERA y no en cero: un bloque lleno de ceros hace que
 * el modelo hable de un negocio parado, cuando lo que pasa es que recién
 * empieza.
 *
 * Desde el 6 de septiembre de 2026 lo que llega acá son dos cosas pegadas: las
 * cifras del mes y, debajo, la memoria guardada de conversaciones anteriores
 * (`lib/eos/memoria-contexto.ts`). El encabezado dice las dos porque decir
 * solamente "cómo va su negocio" haría que el modelo leyera "le dicen Guto"
 * como si fuera un dato contable.
 */
export function bloqueDeNegocio(contexto: string): string {
  const limpio = contexto.trim();
  if (!limpio) return "";

  return `

Lo que sabés de esta persona y de su negocio (datos reales, de hoy):
${limpio}

Usá estas cifras cuando vengan al caso. Son las de verdad: no las
redondees, no las inventes y no las mezcles entre monedas. Si te
preguntan algo que no está acá, decí que no lo tenés a mano en vez
de estimarlo.

Lo guardado de conversaciones anteriores ya lo sabés: usalo cuando
venga al caso, sin anunciar que lo recordás y sin repetírselo a la
persona que te lo contó.`;
}

/**
 * El fragmento sobre el que la persona está preguntando.
 *
 * Se dice explícitamente de quién es. Sin esa línea, el modelo ve un texto
 * arriba de la pregunta y lo trata como un dato que le pasaron: vuelve a
 * calcular el margen en vez de explicar de dónde salió el que él mismo
 * escribió, que es justo lo que le están preguntando.
 */
export function bloqueDeCita(cita: string): string {
  const limpio = cita.trim();
  if (!limpio) return "";

  return `

La persona está preguntando sobre ESTE PEDAZO de una respuesta tuya
anterior:
"""
${limpio}
"""
Contestá sobre eso. Si el número o la afirmación salieron de una cuenta,
explicá la cuenta; no la rehagas con otros datos.`;
}

export function armarPrompt(e: Entrada): Prompt {
  const tieneImagen = e.tiene_archivo && e.archivo_categoria === "imagen" && e.imagen_data_url !== "";

  const prompt_eos = `
Usuario: ${e.nombre || "Usuario"}
Plan: ${e.plan || "free"}
Origen: ${e.origen || "eos-web"}${bloqueDeNegocio(e.contexto_negocio)}

Conversación reciente:
${historialComoTexto(e.historial)}${bloqueDeCita(e.cita)}

Mensaje actual:
${e.mensaje}

${
  tieneImagen
    ? `El usuario adjuntó una imagen llamada "${e.archivo_nombre}". Analizá realmente el contenido visual de la imagen que acompaña este mensaje.`
    : ""
}
`.trim();

  const contenido: ParteOpenAI[] = [{ type: "input_text", text: prompt_eos }];
  if (tieneImagen) contenido.push({ type: "input_image", image_url: e.imagen_data_url });

  return { prompt_eos, tiene_imagen: tieneImagen, contenido };
}
