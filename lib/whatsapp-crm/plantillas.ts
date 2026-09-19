import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { consultarPlantilla, crearPlantilla as crearEnMeta, estadoDePlantilla, type Fetcher } from "./meta.ts";

/**
 * Las plantillas de mensaje de WhatsApp: crearlas, mandarlas a revisión de Meta y
 * mantener su estado al día.
 *
 * ============================================================
 * POR QUÉ HACEN FALTA
 * ============================================================
 *
 * Pasadas las 24 horas desde que el cliente escribió, WhatsApp solo deja retomar la
 * conversación con una PLANTILLA que Meta ya aprobó. Sin ellas, EOS solo puede
 * contestar a quien acaba de escribir: no puede hacer ningún seguimiento.
 *
 * ============================================================
 * EL ORDEN
 * ============================================================
 *
 * Primero se manda a Meta; recién con su respuesta se guarda la fila. Una plantilla
 * "en revisión" que Meta nunca recibió confundiría a la persona durante días.
 */

export type DatosPlantilla = {
  nombre: string;
  idioma: string;
  categoria: "utilidad" | "marketing" | "autenticacion";
  cuerpo: string;
  ejemplos: string[];
};

type Validacion = { ok: true; datos: DatosPlantilla } | { ok: false; error: string; campo: string };

const CATEGORIAS = new Set(["utilidad", "marketing", "autenticacion"]);

/** Cuántas variables distintas usa el cuerpo ({{1}}, {{2}}…), o -1 si están mal numeradas. */
export function cantidadDeVariables(cuerpo: string): number {
  const usadas = [...cuerpo.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  if (usadas.length === 0) return 0;

  const distintas = [...new Set(usadas)].sort((a, b) => a - b);
  // Meta exige {{1}}, {{2}}… seguidas y sin saltos.
  return distintas.every((n, i) => n === i + 1) ? distintas.length : -1;
}

export function validarPlantilla(cuerpo: unknown): Validacion {
  const c = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;

  const nombre = String(c.nombre ?? "").trim();
  if (!/^[a-z0-9_]{1,60}$/.test(nombre)) {
    return { ok: false, campo: "nombre", error: "El nombre va en minúsculas, sin espacios ni tildes: solo letras, números y guion bajo (ej. seguimiento_propuesta)." };
  }

  const texto = String(c.cuerpo ?? "").trim();
  if (texto.length < 1 || texto.length > 1024) {
    return { ok: false, campo: "cuerpo", error: "El mensaje tiene que tener entre 1 y 1024 caracteres." };
  }

  const categoria = String(c.categoria ?? "utilidad");
  if (!CATEGORIAS.has(categoria)) {
    return { ok: false, campo: "categoria", error: "La categoría es utilidad, marketing o autenticación." };
  }

  const variables = cantidadDeVariables(texto);
  if (variables < 0) {
    return { ok: false, campo: "cuerpo", error: "Las variables van numeradas en orden: {{1}}, {{2}}, {{3}}… sin saltear ninguna." };
  }
  if (/^\s*\{\{|\}\}\s*$/.test(texto)) {
    return { ok: false, campo: "cuerpo", error: "Meta no aprueba un mensaje que empieza o termina con una variable: sumale texto antes y después." };
  }

  const ejemplos = Array.isArray(c.ejemplos) ? c.ejemplos.map((e) => String(e ?? "").trim().slice(0, 100)) : [];
  if (ejemplos.length !== variables || ejemplos.some((e) => !e)) {
    return {
      ok: false,
      campo: "ejemplos",
      error: variables === 0
        ? "Sin variables no hacen falta ejemplos."
        : `Meta pide un ejemplo por cada variable: faltan ${variables} ejemplo(s), ninguno vacío.`,
    };
  }

  return {
    ok: true,
    datos: { nombre, idioma: "es", categoria: categoria as DatosPlantilla["categoria"], cuerpo: texto, ejemplos },
  };
}

export type ResultadoPlantilla =
  | { ok: true; plantilla: { id: string; estado: string } }
  | { ok: false; error: string; estado: number; campo?: string };

type CanalFila = { id: string; waba_id: string | null; estado: string };

export async function crearPlantilla(
  admin: ClienteSinTipos,
  usuarioId: string,
  canalId: string,
  datos: DatosPlantilla,
  fetcher: Fetcher = fetch,
): Promise<ResultadoPlantilla> {
  const { data: canalData } = await admin
    .from("eos_wa_canales")
    .select("id, waba_id, estado")
    .eq("id", canalId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  if (!canalData) return { ok: false, estado: 404, error: "Canal no encontrado." };
  const canal = canalData as CanalFila;

  if (!canal.waba_id) {
    return {
      ok: false,
      estado: 409,
      error: "Para crear plantillas hace falta el ID de la cuenta de WhatsApp Business. Volvé a conectar el canal y completalo.",
    };
  }

  const { data: token } = await admin.rpc("eos_wa_leer_secreto_v185", { p_canal_id: canalId, p_tipo: "token" });
  if (typeof token !== "string" || !token) {
    return { ok: false, estado: 409, error: "Este canal no tiene el acceso de Meta guardado. Conectalo de nuevo con su token." };
  }

  // Una plantilla con el mismo nombre e idioma ya existe: Meta la rechazaría igual.
  const { data: repetida } = await admin
    .from("eos_wa_plantillas")
    .select("id")
    .eq("canal_id", canalId)
    .eq("usuario_id", usuarioId)
    .eq("nombre", datos.nombre)
    .eq("idioma", datos.idioma)
    .maybeSingle();

  if (repetida) {
    return { ok: false, estado: 409, campo: "nombre", error: "Ya tenés una plantilla con ese nombre. Elegí otro." };
  }

  const r = await crearEnMeta(token, canal.waba_id, datos, fetcher);
  if (!r.ok) return { ok: false, estado: r.transitorio ? 502 : 400, error: r.mensaje };

  const { data, error } = await admin
    .from("eos_wa_plantillas")
    .insert({
      usuario_id: usuarioId,
      canal_id: canalId,
      nombre: datos.nombre,
      idioma: datos.idioma,
      categoria: datos.categoria,
      cuerpo: datos.cuerpo,
      cantidad_variables: datos.ejemplos.length,
      estado: estadoDePlantilla(r.datos.status ?? "PENDING"),
      meta_template_id: r.datos.id,
    })
    .select("id, estado")
    .single();

  if (error || !data) {
    // Meta ya la tiene: se avisa con claridad en vez de dejarla huérfana en silencio.
    console.error("WhatsApp empresa: la plantilla se creó en Meta pero no se pudo guardar:", error);
    return { ok: false, estado: 500, error: "La plantilla se envió a Meta pero no pudimos guardarla acá. Usá «Sincronizar» para traerla." };
  }

  return { ok: true, plantilla: data as { id: string; estado: string } };
}

/** Trae de Meta el estado actual de una plantilla y lo guarda. */
export async function sincronizarPlantilla(
  admin: ClienteSinTipos,
  usuarioId: string,
  plantillaId: string,
  fetcher: Fetcher = fetch,
): Promise<ResultadoPlantilla> {
  const { data } = await admin
    .from("eos_wa_plantillas")
    .select("id, nombre, canal_id")
    .eq("id", plantillaId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  if (!data) return { ok: false, estado: 404, error: "Plantilla no encontrada." };
  const p = data as { id: string; nombre: string; canal_id: string };

  const { data: canalData } = await admin
    .from("eos_wa_canales")
    .select("id, waba_id, estado")
    .eq("id", p.canal_id)
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  const canal = canalData as CanalFila | null;
  if (!canal?.waba_id) return { ok: false, estado: 409, error: "Falta el ID de la cuenta de WhatsApp Business del canal." };

  const { data: token } = await admin.rpc("eos_wa_leer_secreto_v185", { p_canal_id: p.canal_id, p_tipo: "token" });
  if (typeof token !== "string" || !token) return { ok: false, estado: 409, error: "Este canal no tiene el acceso de Meta guardado." };

  const r = await consultarPlantilla(token, canal.waba_id, p.nombre, fetcher);
  if (!r.ok) return { ok: false, estado: r.transitorio ? 502 : 400, error: r.mensaje };
  if (!r.datos) return { ok: false, estado: 404, error: "Meta no encuentra esa plantilla. Puede que la hayan eliminado allá." };

  const estado = estadoDePlantilla(r.datos.status);

  const { error } = await admin
    .from("eos_wa_plantillas")
    .update({
      estado,
      meta_template_id: r.datos.id,
      motivo_rechazo: estado === "rechazada" ? (r.datos.rejected_reason ?? "").slice(0, 300) || null : null,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", p.id)
    .eq("usuario_id", usuarioId);

  if (error) return { ok: false, estado: 500, error: "No pudimos guardar el estado de la plantilla." };
  return { ok: true, plantilla: { id: p.id, estado } };
}
