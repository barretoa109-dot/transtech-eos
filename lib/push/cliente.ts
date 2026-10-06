"use client";

/**
 * Notificaciones push de la app nativa. Solo tiene efecto dentro de la app
 * (iOS y Android); en la web todas las funciones no hacen nada.
 *
 * El permiso se pide después del primer momento de valor (la primera respuesta
 * de EOS), no al abrir la app. Por eso `activarPushNativo` se llama desde el
 * chat y no desde el arranque.
 */

import { Capacitor } from "@capacitor/core";
import { estaEnAppNativa, pushNativo } from "@/lib/app-nativa/cliente";

let activacion: Promise<void> | null = null;
let tokenActual: string | null = null;

function plataformaActual(): "ios" | "android" | null {
  const plataforma = Capacitor.getPlatform();
  return plataforma === "ios" || plataforma === "android" ? plataforma : null;
}

async function enviarToken(metodo: "POST" | "DELETE", token: string, plataforma: "ios" | "android") {
  await fetch("/api/push/dispositivo", {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plataforma, token }),
    credentials: "same-origin",
  });
}

/**
 * Pide permiso y registra el teléfono. Se hace una sola vez por sesión de la
 * app. Si la persona dice que no, no se vuelve a pedir en esta sesión; el
 * sistema operativo recuerda la decisión.
 */
export function activarPushNativo(): Promise<void> {
  if (!estaEnAppNativa()) return Promise.resolve();
  activacion ??= registrar().catch(() => {});
  return activacion;
}

async function registrar(): Promise<void> {
  const plataforma = plataformaActual();
  if (!plataforma) return;

  const plugin = pushNativo();
  const escucha = await plugin.addListener("registration", ({ value }) => {
    tokenActual = value;
    void enviarToken("POST", value, plataforma).catch(() => {});
  });

  const permiso = await plugin.requestPermissions();
  if (permiso.receive !== "granted") {
    await escucha.remove();
    return;
  }

  await plugin.register();
}

/**
 * Al cerrar sesión, el teléfono deja de recibir avisos de esa persona. Si el
 * token nunca se registró, no hace nada.
 */
export async function desactivarPushNativo(): Promise<void> {
  const plataforma = plataformaActual();
  if (!tokenActual || !plataforma) return;

  const token = tokenActual;
  tokenActual = null;
  activacion = null;
  await enviarToken("DELETE", token, plataforma).catch(() => {});
}
