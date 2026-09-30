/**
 * Que EOS no se olvide de una imagen en el mensaje siguiente (v197).
 *
 * El caso real (24/09/2026, WhatsApp): una clienta mandó la captura de un pedido
 * con prendas y precios en dólares, EOS la leyó bien, y un mensaje después
 * —"sumale el envío al costo de cada prenda", "estos"— preguntó "¿a qué
 * productos?". La imagen existía para un solo mensaje; en la conversación
 * quedaba el pie de foto y nada de lo que se veía.
 *
 * Tres piezas:
 *
 *   - `leerImagen`: una llamada al modelo con visión que devuelve, en texto, lo
 *     que tiene datos (ítems, cantidades, precios, moneda, envío, total).
 *   - `guardarLecturas`: la deja atada a la conversación.
 *   - `lecturasRecientes`: lo que el motor le pasa al modelo en los mensajes
 *     siguientes, para que "estos" tenga a qué referirse.
 *
 * Ninguna lanza: si la lectura falla, todo sigue igual que antes (el modelo
 * igual ve la imagen en ESE mensaje). La lectura corre en paralelo y se guarda
 * después de responder: no demora la respuesta.
 */

import { MODELO } from "../gateway/sistema.ts";
import { costoDelMensaje, tarifasDelEntorno, tokensDeUsage } from "./costo-mensaje.ts";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const TIMEOUT_MS = 25_000;
/** Cuánto del historial de imágenes vuelve al modelo. */
export const LECTURAS_RECIENTES = 3;
/** Una imagen de hace más de un día ya no es "estos": es otra conversación. */
const VENTANA_MS = 24 * 3_600_000;
const MAX_CONTENIDO = 4_000;

export type ImagenParaLeer = { nombre: string; tipo: string; base64: string };

export const INSTRUCCION_LECTURA = [
  "Transcribí lo que se ve en esta imagen para el sistema de gestión de un negocio.",
  "Si es un pedido, factura, ticket, carrito o lista: cada ítem en una línea con",
  "nombre o descripción tal como aparece, color/talle si figura, cantidad, precio",
  "unitario y moneda. Después, en líneas aparte: subtotal, envío, descuentos,",
  "impuestos, total, comercio y fecha, si aparecen.",
  "Copiá los números exactamente como se ven. No inventes ni completes nada que",
  "no se lea. Si la imagen no tiene datos de negocio, describila en una línea.",
  "Solo el texto, sin comentarios ni introducción.",
].join("\n");

/**
 * `alCosto` recibe lo que costó la lectura en dólares, para sumarlo al consumo
 * del mes (v202): es una llamada al modelo aparte del mensaje.
 */
export async function leerImagen(
  imagen: ImagenParaLeer,
  opciones: { alCosto?: (usd: number) => void } = {},
): Promise<string | null> {
  const clave = process.env.OPENAI_API_KEY;
  if (!clave || !imagen.tipo.startsWith("image/") || !imagen.base64) return null;

  const controlador = new AbortController();
  const reloj = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const respuesta = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
      body: JSON.stringify({
        model: MODELO,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: INSTRUCCION_LECTURA },
              { type: "input_image", image_url: `data:${imagen.tipo};base64,${imagen.base64}` },
            ],
          },
        ],
      }),
      signal: controlador.signal,
      cache: "no-store",
    });

    if (!respuesta.ok) {
      console.error("Imagen: la lectura falló con status", respuesta.status);
      return null;
    }

    const datos = (await respuesta.json()) as { usage?: unknown };
    const costo = costoDelMensaje(tokensDeUsage(datos?.usage), tarifasDelEntorno());
    if (costo > 0) opciones.alCosto?.(costo);

    return textoDeRespuesta(datos);
  } catch (error) {
    console.error(
      "Imagen: no se pudo leer:",
      error instanceof Error && error.name === "AbortError" ? "timeout" : "error de red",
    );
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

/** El texto de una respuesta de la Responses API. */
export function textoDeRespuesta(datos: unknown): string | null {
  const d = (datos && typeof datos === "object" ? datos : {}) as Record<string, unknown>;
  if (typeof d.output_text === "string" && d.output_text.trim()) {
    return d.output_text.trim().slice(0, MAX_CONTENIDO);
  }

  const partes: string[] = [];
  for (const item of Array.isArray(d.output) ? d.output : []) {
    const contenido = (item as { content?: unknown })?.content;
    for (const c of Array.isArray(contenido) ? contenido : []) {
      const texto = (c as { text?: unknown })?.text;
      if (typeof texto === "string") partes.push(texto);
    }
  }

  const texto = partes.join("\n").trim();
  return texto ? texto.slice(0, MAX_CONTENIDO) : null;
}

export type Lectura = { contenido: string; creado_en?: string | null; anotada?: boolean };

/** "hace 5 minutos", "hace 3 horas". Sin fecha, nada. */
export function antiguedad(creadoEn: string | null | undefined, ahora = Date.now()): string {
  const t = creadoEn ? new Date(creadoEn).getTime() : Number.NaN;
  if (!Number.isFinite(t)) return "";
  const minutos = Math.max(0, Math.round((ahora - t) / 60_000));
  if (minutos < 2) return "recién";
  if (minutos < 60) return `hace ${minutos} minutos`;
  const horas = Math.round(minutos / 60);
  return horas === 1 ? "hace una hora" : `hace ${horas} horas`;
}

/**
 * Cómo entran las imágenes de mensajes anteriores al contexto.
 *
 * Hasta el 29/09/2026 la regla era "si pide cargar algo sin nombrarlo, se
 * refiere a esto", sin decir de cuándo era la imagen ni si ya se había
 * anotado. La persona escribió "gasté 46.000 en Punto Farma con la Green" y EOS
 * agregó un débito de ₲22.650 que sacó de una captura de dos días antes. Ahora
 * cada imagen dice cuándo llegó y si lo que tenía ya se anotó, y un mensaje que
 * trae sus propios datos manda sobre cualquier imagen vieja.
 */
export function bloqueDeContexto(lecturas: Lectura[], ahora = Date.now()): string {
  if (lecturas.length === 0) return "";
  return [
    "IMÁGENES QUE LA PERSONA MANDÓ ANTES EN ESTA CONVERSACIÓN (la más reciente primero).",
    "Usalas SOLO si el mensaje actual se refiere a una imagen (\"estos\", \"los de la foto\",",
    "\"la captura\") o pide sumar, convertir o cargar algo sin decir qué: ahí usalo directamente,",
    "no le pidas que repita datos que ya están acá. Si el mensaje trae sus propios datos (monto,",
    "lugar, producto), esos mandan: no le agregues nada de una imagen anterior. Lo que dice",
    "\"ya se anotó\" no se vuelve a anotar.",
    ...lecturas.map((l, i) => {
      const notas = [antiguedad(l.creado_en, ahora), l.anotada ? "lo que tenía ya se anotó" : ""]
        .filter(Boolean)
        .join("; ");
      return `--- Imagen ${i + 1}${notas ? ` (${notas})` : ""} ---\n${l.contenido}`;
    }),
  ].join("\n");
}

type Admin = ReturnType<typeof import("../supabase/sin-tipos.ts").adminSinTipos>;

export async function guardarLecturas(
  admin: Admin,
  datos: {
    usuarioId: string;
    conversacionId: string | null;
    requestId: string;
    lecturas: { nombre: string; contenido: string }[];
  },
): Promise<void> {
  if (datos.lecturas.length === 0) return;
  try {
    const { error } = await admin.from("eos_imagenes_leidas_v197").insert(
      datos.lecturas.map((l) => ({
        usuario_id: datos.usuarioId,
        conversacion_id: datos.conversacionId || null,
        request_id: datos.requestId,
        nombre: l.nombre.slice(0, 200),
        contenido: l.contenido.slice(0, MAX_CONTENIDO),
      })),
    );
    if (error) console.error("Imagen: no se pudo guardar la lectura:", error.message ?? error);
  } catch (error) {
    console.error("Imagen: no se pudo guardar la lectura:", error);
  }
}

export async function lecturasRecientes(
  admin: Admin,
  usuarioId: string,
  conversacionId: string | null,
): Promise<Lectura[]> {
  if (!conversacionId) return [];
  try {
    const { data, error } = await admin
      .from("eos_imagenes_leidas_v197")
      .select("contenido, creado_en, request_id")
      .eq("usuario_id", usuarioId)
      .eq("conversacion_id", conversacionId)
      .gte("creado_en", new Date(Date.now() - VENTANA_MS).toISOString())
      .order("creado_en", { ascending: false })
      .limit(LECTURAS_RECIENTES);
    if (error) return [];
    const filas = (data ?? []) as { contenido: string; creado_en: string | null; request_id: string | null }[];

    // ¿Lo que tenía cada imagen ya quedó anotado? La primera acción de cada
    // tipo conserva el request_id del mensaje que trajo la imagen.
    const ids = [...new Set(filas.map((f) => f.request_id).filter((x): x is string => Boolean(x)))];
    let anotados = new Set<string>();
    if (ids.length > 0) {
      const { data: hechas } = await admin
        .from("eos_action_commands")
        .select("request_id")
        .eq("usuario_id", usuarioId)
        .eq("estado", "completada")
        .in("request_id", ids);
      anotados = new Set(((hechas ?? []) as { request_id: string }[]).map((h) => h.request_id));
    }

    return filas.map((f) => ({
      contenido: f.contenido,
      creado_en: f.creado_en,
      anotada: Boolean(f.request_id && anotados.has(f.request_id)),
    }));
  } catch {
    return [];
  }
}
