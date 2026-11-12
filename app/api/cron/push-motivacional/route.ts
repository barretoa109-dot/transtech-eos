import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { claveApns } from "@/lib/push/apns";
import { cuentaDeServicio } from "@/lib/push/fcm";
import { avisarNativo } from "@/lib/push/nativo";
import { enviarMotivacionalesPush, FRANJAS, type Franja } from "@/lib/push/motivacionales";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/*
 * Push motivacional nativo, hasta 3 veces por día.
 *
 * NO es un cron de Vercel: el plan Hobby solo permite dos, y los dos ya están
 * usados (briefing-diario, bancard-renovaciones). Un workflow de GitHub
 * Actions (`.github/workflows/push-motivacional.yml`) llama a este endpoint
 * tres veces al día, cada vez con una franja distinta en la query
 * (`?franja=manana|mediodia|noche`), con el mismo `CRON_SECRET` que ya usan
 * los otros crons.
 */

function autorizado(request: Request) {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) return { ok: false, sinConfigurar: true };

  const header = request.headers.get("authorization") || "";
  const recibido = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!recibido) return { ok: false, sinConfigurar: false };

  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return { ok: false, sinConfigurar: false };

  return { ok: timingSafeEqual(a, b), sinConfigurar: false };
}

function franjaValida(valor: string | null): valor is Franja {
  return valor !== null && (FRANJAS as readonly string[]).includes(valor);
}

/**
 * Qué hay configurado y cuántos teléfonos hay, sin mandar nada.
 *
 * Devuelve SOLO contadores y booleanos: nunca un token, nunca una clave. Sirve
 * para distinguir "no está configurado" de "está configurado y falla", que es
 * exactamente lo que no se podía saber el 2026-11-10 (dos cuentas con
 * dispositivo y cero envíos, sin ningún error).
 */
async function diagnostico() {
  const admin = adminSinTipos();
  const { data, error } = await admin.from("dispositivos_push").select("plataforma").limit(2000);

  const porPlataforma = { ios: 0, android: 0 };
  for (const fila of (data ?? []) as { plataforma: string }[]) {
    if (fila.plataforma === "ios") porPlataforma.ios += 1;
    if (fila.plataforma === "android") porPlataforma.android += 1;
  }

  return {
    apns_configurado: Boolean(claveApns()),
    apns_entorno: process.env.APNS_ENTORNO === "sandbox" ? "sandbox" : "produccion",
    fcm_configurado: Boolean(cuentaDeServicio()),
    dispositivos: porPlataforma,
    error_leyendo_dispositivos: error ? String((error as { message?: string }).message ?? error) : null,
    forma_clave_apns: formaDeLaClave(process.env.APNS_CLAVE_PRIVADA),
    forma_json_fcm: formaDelJson(process.env.FCM_SERVICE_ACCOUNT_JSON),
    identificadores_apns: identificadoresApns(),
  };
}

/**
 * El Team ID y el Key ID tal cual están guardados.
 *
 * No son secretos: son identificadores. El Team ID viaja dentro de cada
 * perfil de aprovisionamiento de la app, y el Key ID nombra una clave sin
 * decir nada de su contenido; el secreto es el `.p8`, que este endpoint no
 * devuelve nunca. Hacen falta a la vista porque cuando Apple contesta
 * `InvalidProviderToken` —como el 2026-11-11— el problema es justamente que
 * alguno de los dos no se corresponde con la clave, y compararlos contra el
 * portal de Apple es la única forma de saber cuál.
 *
 * En Apple los dos son exactamente diez caracteres alfanuméricos: cuando no
 * lo son, el error está ahí y no hace falta ir a mirar a ningún lado.
 */
function identificadoresApns() {
  const team = process.env.APNS_TEAM_ID ?? "";
  const key = process.env.APNS_KEY_ID ?? "";
  const bienFormado = (valor: string) => /^[A-Z0-9]{10}$/.test(valor.trim());

  return {
    team_id: team.trim(),
    key_id: key.trim(),
    team_id_bien_formado: bienFormado(team),
    key_id_bien_formado: bienFormado(key),
    // Un espacio o un salto invisible al final es un clásico del copiar y pegar.
    team_id_tenia_espacios: team !== team.trim(),
    key_id_tenia_espacios: key !== key.trim(),
  };
}

/**
 * La FORMA del valor guardado, sin su contenido.
 *
 * El 2026-11-11 la clave de APNs se volvió a cargar dos veces, desde un
 * archivo sano, y seguía sin poder leerse — ni siquiera después de
 * reconstruir el PEM. Para saber qué está guardado realmente hay que mirarlo,
 * pero una clave privada no se mira: se describe.
 *
 * Todo lo que sale de acá son números y booleanos. El único texto que puede
 * devolver es el encabezado `-----BEGIN …-----`, que es público por
 * definición y es justo el que falta cuando el pegado salió mal.
 */
function formaDeLaClave(valor: string | undefined) {
  if (valor === undefined) return { cargada: false };

  const sinBom = valor.replace(/^﻿/, "");
  const cuerpo = sinBom
    .replace(/-----BEGIN [A-Z0-9 ]+?-----/g, "")
    .replace(/-----END [A-Z0-9 ]+?-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");

  return {
    cargada: true,
    longitud: valor.length,
    lineas: valor.split("\n").length,
    encabezado: /-----BEGIN [A-Z0-9 ]+?-----/.exec(sinBom)?.[0] ?? "(no tiene encabezado PEM)",
    tiene_cierre_end: /-----END [A-Z0-9 ]+?-----/.test(sinBom),
    tiene_barra_ene_literal: valor.includes("\\n"),
    empieza_con_bom: valor !== sinBom,
    caracteres_no_ascii: (valor.match(/[^\x20-\x7E\r\n\t]/g) ?? []).length,
    largo_del_cuerpo: cuerpo.length,
    cuerpo_es_base64: cuerpo.length > 0 && !/[^A-Za-z0-9+/=]/.test(cuerpo),
  };
}

/** Lo mismo para el JSON de FCM: forma, nunca contenido. */
function formaDelJson(valor: string | undefined) {
  if (valor === undefined) return { cargada: false };

  const limpio = valor.trim();
  return {
    cargada: true,
    longitud: valor.length,
    empieza_con_llave: limpio.startsWith("{"),
    termina_con_llave: limpio.endsWith("}"),
    envuelto_en_comillas: /^["']/.test(limpio),
    tiene_barra_ene_literal: valor.includes("\\n"),
    empieza_con_bom: /^﻿/.test(valor),
    caracteres_no_ascii: (valor.match(/[^\x20-\x7E\r\n\t]/g) ?? []).length,
  };
}

/**
 * Un envío DE VERDAD que devuelve por qué no salió.
 *
 * Va a las cuentas de `ADMIN_EMAILS` —quienes administran EOS— y a ninguna
 * otra: una notificación de prueba en el teléfono de un cliente no es un
 * diagnóstico, es una molestia.
 *
 * RECORRE TODAS, no solo la primera. La primera vez que corrió esto (2026-11-11)
 * probó únicamente `ADMIN_EMAILS[0]`, que resultó ser una cuenta sin ningún
 * teléfono: contestó "esta cuenta no tiene dispositivos" y pareció un
 * diagnóstico cuando en realidad era la cuenta equivocada.
 *
 * No reclama la franja del día (no escribe en `eos_push_motivacionales_v258`),
 * así que se puede repetir las veces que haga falta sin gastar el envío real
 * de esa franja.
 */
async function pruebaDeEnvio() {
  const correos = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);

  if (correos.length === 0) return { error: "No hay ADMIN_EMAILS configurado." };

  const admin = adminSinTipos();
  const porCuenta = [];

  for (const correo of correos) {
    const { data, error } = await admin.from("usuarios").select("id").eq("email", correo).maybeSingle();

    if (error) {
      porCuenta.push({ correo, error: String((error as { message?: string }).message ?? error) });
      continue;
    }
    if (!data) {
      porCuenta.push({ correo, error: "no tiene cuenta en EOS" });
      continue;
    }

    const resultado = await avisarNativo(admin, (data as { id: string }).id, {
      titulo: "Prueba de EOS",
      cuerpo: "Si ves esto, las notificaciones de EOS ya funcionan en este teléfono.",
      url: "/eos/chat",
    });

    porCuenta.push({
      correo,
      enviados: resultado.enviados,
      fallidos: resultado.fallidos,
      tokens_dados_de_baja: resultado.muertos.length,
      razones: resultado.razones,
    });
  }

  return { cuentas: porCuenta };
}

export async function GET(request: Request) {
  const permiso = autorizado(request);
  if (permiso.sinConfigurar) {
    return NextResponse.json({ error: "Cron no configurado." }, { status: 503 });
  }
  if (!permiso.ok) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const parametros = new URL(request.url).searchParams;

  if (parametros.get("diagnostico") === "1") {
    return NextResponse.json(await diagnostico(), { headers: { "Cache-Control": "no-store" } });
  }

  if (parametros.get("prueba") === "1") {
    return NextResponse.json(await pruebaDeEnvio(), { headers: { "Cache-Control": "no-store" } });
  }

  const franja = new URL(request.url).searchParams.get("franja");
  if (!franjaValida(franja)) {
    return NextResponse.json(
      { error: `Franja inválida. Usar una de: ${FRANJAS.join(", ")}.` },
      { status: 400 },
    );
  }

  const resumen = await enviarMotivacionalesPush(adminSinTipos(), franja);

  return NextResponse.json(resumen, { headers: { "Cache-Control": "no-store" } });
}
