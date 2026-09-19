import { randomBytes } from "node:crypto";

import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { verificarCredenciales, type Fetcher } from "./meta.ts";

/**
 * Conectar y administrar el WhatsApp Business de una empresa.
 *
 * ============================================================
 * EL ORDEN QUE PROTEGE
 * ============================================================
 *
 *   1. Se VALIDA lo que llegó (formas, largos).
 *   2. Se PRUEBA el token contra Meta. Si Meta lo rechaza, no se guarda nada: un
 *      canal "conectado" con un token que no sirve es peor que ninguno, porque
 *      parece andar y falla recién cuando un cliente escribe.
 *   3. Recién ahí se crea el canal y el token va a Vault.
 *   4. Si guardar el token falla, el canal recién creado se borra: no queda una
 *      fila a medias.
 *
 * El token NUNCA se escribe en la tabla ni se devuelve: `eos_wa_canales` solo
 * guarda una referencia (`secreto_ref`) y todo lo demás lo hace `service_role`
 * dentro del servidor (v185).
 *
 * DE QUIÉN SON LOS DATOS: cada consulta lleva `usuario_id` como filtro. Se usa la
 * clave de servicio, así que ese filtro escrito a mano es la única frontera.
 */

// ---------------------------------------------------------------- validación

export type DatosConexion = {
  phone_number_id: string;
  waba_id: string | null;
  token: string;
  app_secret: string | null;
  nombre_visible: string | null;
};

type Validacion<T> = { ok: true; datos: T } | { ok: false; error: string; campo: string };

const ID_META = /^[0-9]{5,30}$/;

const texto = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export function validarConexion(cuerpo: unknown): Validacion<DatosConexion> {
  const c = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;

  const phone = texto(c.phone_number_id, 40);
  if (!ID_META.test(phone)) {
    return {
      ok: false,
      campo: "phone_number_id",
      error: "El ID del número son solo dígitos. Lo encontrás en Meta, en WhatsApp Manager → Configuración de la API.",
    };
  }

  const waba = texto(c.waba_id, 40);
  if (waba && !ID_META.test(waba)) {
    return { ok: false, campo: "waba_id", error: "El ID de la cuenta de WhatsApp Business son solo dígitos." };
  }

  const token = texto(c.token, 1200);
  if (token.length < 20 || /\s/.test(token)) {
    return {
      ok: false,
      campo: "token",
      error: "El token de acceso parece incompleto: pegalo entero, sin espacios ni saltos de línea.",
    };
  }

  const secreto = texto(c.app_secret, 200);
  if (secreto && (secreto.length < 16 || /\s/.test(secreto))) {
    return { ok: false, campo: "app_secret", error: "El secreto de la app parece incompleto." };
  }

  return {
    ok: true,
    datos: {
      phone_number_id: phone,
      waba_id: waba || null,
      token,
      app_secret: secreto || null,
      nombre_visible: texto(c.nombre_visible, 120) || null,
    },
  };
}

export type Ajustes = {
  limite_diario?: number;
  limite_por_contacto_dia?: number;
  silencio_desde_hora?: number;
  silencio_hasta_hora?: number;
  respuesta_automatica?: boolean;
};

const entre = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export function validarAjustes(cuerpo: unknown): Validacion<Ajustes> {
  const c = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;
  const a: Ajustes = {};

  const reglas: [keyof Ajustes, number, number, string][] = [
    ["limite_diario", 1, 100000, "El límite diario va de 1 a 100.000 mensajes."],
    ["limite_por_contacto_dia", 1, 10, "Los mensajes por cliente por día van de 1 a 10."],
    ["silencio_desde_hora", 0, 23, "La hora de inicio del silencio va de 0 a 23."],
    ["silencio_hasta_hora", 0, 23, "La hora de fin del silencio va de 0 a 23."],
  ];

  for (const [campo, min, max, mensaje] of reglas) {
    if (c[campo] === undefined) continue;
    const n = entre(c[campo], min, max);
    if (n === null) return { ok: false, campo, error: mensaje };
    (a as Record<string, number>)[campo] = n;
  }

  if (c.respuesta_automatica !== undefined) {
    if (typeof c.respuesta_automatica !== "boolean") {
      return { ok: false, campo: "respuesta_automatica", error: "Es sí o no." };
    }
    a.respuesta_automatica = c.respuesta_automatica;
  }

  if (Object.keys(a).length === 0) {
    return { ok: false, campo: "", error: "No hay nada que cambiar." };
  }

  return { ok: true, datos: a };
}

// ------------------------------------------------------------------ conectar

export type CanalConectado = {
  id: string;
  telefono: string | null;
  nombre: string | null;
  estado: string;
  /** El que hay que pegar en Meta al configurar el webhook. No es un secreto fuerte. */
  verify_token: string;
};

export type ResultadoCanal<T = CanalConectado> =
  | { ok: true; canal: T }
  | { ok: false; error: string; campo?: string; estado: number };

async function evento(
  admin: ClienteSinTipos,
  usuarioId: string,
  canalId: string,
  tipo: string,
  actor: "usuario" | "sistema",
  resumen: string,
) {
  const { error } = await admin
    .from("eos_wa_eventos")
    .insert({ usuario_id: usuarioId, canal_id: canalId, evento: tipo, actor, resumen });

  // La bitácora es un registro, no una condición: si falla no se deshace lo hecho.
  if (error) console.error("WhatsApp empresa: no se pudo asentar el evento del canal:", error);
}

export async function conectarCanal(
  admin: ClienteSinTipos,
  usuarioId: string,
  datos: DatosConexion,
  fetcher: Fetcher = fetch,
): Promise<ResultadoCanal> {
  // Sin filtro de dueño A PROPÓSITO: hay que saber si el número ya está en OTRA
  // cuenta. Solo se lee quién es el dueño; no se devuelve ningún dato del canal.
  const { data: existente, error: errorLectura } = await admin
    .from("eos_wa_canales")
    .select("id, usuario_id")
    .eq("phone_number_id", datos.phone_number_id)
    .maybeSingle();

  if (errorLectura) {
    console.error("WhatsApp empresa: no se pudo consultar el canal:", errorLectura);
    return { ok: false, estado: 503, error: "No pudimos verificar el número. Reintentá en un momento." };
  }

  if (existente && (existente as { usuario_id: string }).usuario_id !== usuarioId) {
    return { ok: false, estado: 409, campo: "phone_number_id", error: "Ese número ya está conectado en otra cuenta de EOS." };
  }

  // 2. La prueba contra Meta, ANTES de guardar nada.
  const verificado = await verificarCredenciales(datos.token, datos.phone_number_id, fetcher);
  if (!verificado.ok) {
    return { ok: false, estado: verificado.transitorio ? 502 : 400, campo: "token", error: verificado.mensaje };
  }

  const telefono = verificado.datos.display_phone_number.replace(/\D/g, "");
  const nombre = datos.nombre_visible ?? (verificado.datos.verified_name || null);

  const comunes = {
    waba_id: datos.waba_id,
    telefono: /^[0-9]{8,15}$/.test(telefono) ? telefono : null,
    nombre_visible: nombre,
    estado: "activo",
    ultimo_error: null,
    verificado_en: new Date().toISOString(),
    conectado_en: new Date().toISOString(),
  };

  let canalId: string;
  let verifyToken: string;
  let esNuevo = false;

  if (existente) {
    canalId = (existente as { id: string }).id;
    verifyToken = randomBytes(24).toString("hex");

    const { error } = await admin
      .from("eos_wa_canales")
      .update({ ...comunes, verify_token: verifyToken, actualizado_en: new Date().toISOString() })
      .eq("id", canalId)
      .eq("usuario_id", usuarioId);

    if (error) {
      console.error("WhatsApp empresa: no se pudo actualizar el canal:", error);
      return { ok: false, estado: 500, error: "No pudimos guardar el canal. Reintentá en un momento." };
    }
  } else {
    verifyToken = randomBytes(24).toString("hex");
    esNuevo = true;

    const { data, error } = await admin
      .from("eos_wa_canales")
      .insert({ usuario_id: usuarioId, phone_number_id: datos.phone_number_id, verify_token: verifyToken, ...comunes })
      .select("id")
      .single();

    if (error || !data) {
      console.error("WhatsApp empresa: no se pudo crear el canal:", error);
      return { ok: false, estado: 500, error: "No pudimos guardar el canal. Reintentá en un momento." };
    }
    canalId = (data as { id: string }).id;
  }

  // 3. Los secretos, a Vault.
  const token = await admin.rpc("eos_wa_guardar_secreto_v185", { p_canal_id: canalId, p_valor: datos.token, p_tipo: "token" });
  const app = datos.app_secret
    ? await admin.rpc("eos_wa_guardar_secreto_v185", { p_canal_id: canalId, p_valor: datos.app_secret, p_tipo: "app" })
    : { error: null };

  if (token.error || app.error) {
    console.error("WhatsApp empresa: no se pudo guardar un secreto:", token.error ?? app.error);

    // Un canal a medias no sirve: el nuevo se borra; el que ya existía queda pausado.
    if (esNuevo) {
      await admin.from("eos_wa_canales").delete().eq("id", canalId).eq("usuario_id", usuarioId);
    } else {
      await admin.from("eos_wa_canales").update({ estado: "pausado" }).eq("id", canalId).eq("usuario_id", usuarioId);
    }
    return { ok: false, estado: 500, error: "No pudimos guardar el acceso de forma segura. No se conectó nada: reintentá." };
  }

  await evento(admin, usuarioId, canalId, "canal_conectado", "usuario", `Se conectó el WhatsApp de la empresa${nombre ? ` (${nombre})` : ""}.`);

  return {
    ok: true,
    canal: { id: canalId, telefono: comunes.telefono, nombre, estado: "activo", verify_token: verifyToken },
  };
}

// ---------------------------------------------------------------- administrar

export type AccionCanal =
  | { accion: "pausar" }
  | { accion: "reanudar" }
  | { accion: "desconectar" }
  | { accion: "configurar"; ajustes: Ajustes };

export async function administrarCanal(
  admin: ClienteSinTipos,
  usuarioId: string,
  canalId: string,
  pedido: AccionCanal,
): Promise<ResultadoCanal<{ id: string; estado: string }>> {
  const { data, error } = await admin
    .from("eos_wa_canales")
    .select("id, estado, secreto_ref")
    .eq("id", canalId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  if (error) return { ok: false, estado: 503, error: "No pudimos leer el canal. Reintentá en un momento." };
  if (!data) return { ok: false, estado: 404, error: "Canal no encontrado." };

  const canal = data as { id: string; estado: string; secreto_ref: string | null };

  const cambiar = async (cambios: Record<string, unknown>) => {
    const { error: e } = await admin
      .from("eos_wa_canales")
      .update({ ...cambios, actualizado_en: new Date().toISOString() })
      .eq("id", canalId)
      .eq("usuario_id", usuarioId);
    return e;
  };

  switch (pedido.accion) {
    case "pausar": {
      if (canal.estado === "desconectado") return { ok: false, estado: 409, error: "Ese canal está desconectado." };
      if (await cambiar({ estado: "pausado" })) return { ok: false, estado: 500, error: "No pudimos pausar el canal." };
      await evento(admin, usuarioId, canalId, "canal_pausado", "usuario", "Se pausó el WhatsApp de la empresa: no sale ningún mensaje hasta reanudarlo.");
      return { ok: true, canal: { id: canalId, estado: "pausado" } };
    }

    case "reanudar": {
      // Sin token no hay nada que reanudar: quedaría "activo" sin poder enviar.
      if (!canal.secreto_ref) {
        return { ok: false, estado: 409, error: "Este canal no tiene el acceso de Meta guardado. Conectalo de nuevo con su token." };
      }
      if (await cambiar({ estado: "activo", ultimo_error: null })) return { ok: false, estado: 500, error: "No pudimos reanudar el canal." };
      await evento(admin, usuarioId, canalId, "canal_reanudado", "usuario", "Se reanudó el WhatsApp de la empresa.");
      return { ok: true, canal: { id: canalId, estado: "activo" } };
    }

    case "desconectar": {
      const borrado = await admin.rpc("eos_wa_borrar_secreto_v185", { p_canal_id: canalId });
      if (borrado.error) {
        console.error("WhatsApp empresa: no se pudieron borrar los secretos:", borrado.error);
        return { ok: false, estado: 500, error: "No pudimos borrar el acceso guardado. No se desconectó: reintentá." };
      }
      // El historial y los clientes se conservan: solo se corta el canal.
      if (await cambiar({ estado: "desconectado", verify_token: null })) return { ok: false, estado: 500, error: "No pudimos desconectar el canal." };
      await evento(admin, usuarioId, canalId, "canal_desconectado", "usuario", "Se desconectó el WhatsApp de la empresa y se borró el acceso guardado. El historial se conserva.");
      return { ok: true, canal: { id: canalId, estado: "desconectado" } };
    }

    case "configurar": {
      if (await cambiar(pedido.ajustes)) return { ok: false, estado: 500, error: "No pudimos guardar los ajustes." };
      return { ok: true, canal: { id: canalId, estado: canal.estado } };
    }
  }
}
