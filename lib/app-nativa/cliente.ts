"use client";

/**
 * Lo que el navegador necesita saber de la app nativa. La decisión vive en
 * `./plataforma` (pura y probada); acá solo se la conecta a React y a los
 * plugins de Capacitor.
 */

import { useSyncExternalStore } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { esAppNativa } from "./plataforma";

function detectar(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (Capacitor.isNativePlatform()) return true;
  } catch {
    // Sin puente de Capacitor: se decide por el user agent.
  }
  return esAppNativa(window.navigator.userAgent);
}

const sinSuscripcion = () => () => {};

/**
 * `true` dentro de la app de iOS o Android. En el servidor y en el primer
 * render del navegador es `false`, así que la web nunca cambia; la app corrige
 * en el render siguiente, antes de que la persona pueda tocar nada.
 */
export function useEsAppNativa(): boolean {
  return useSyncExternalStore(sinSuscripcion, detectar, () => false);
}

/** Lo mismo, fuera de React (en un manejador de eventos). */
export function estaEnAppNativa(): boolean {
  return detectar();
}

/*
 * Los plugins se registran por nombre, sin importar `@capacitor/browser` ni
 * `@capacitor/app`: el lado JavaScript de los dos es solo este puente, y así
 * la web no suma dependencias. El lado nativo sí hace falta: se instalan con
 * `npm i @capacitor/app@^8 @capacitor/browser@^8` y `npx cap sync` (ver
 * `docs/app-nativa/tiendas.md`). Mientras no estén, `puedeAbrirNavegadorDelSistema()`
 * da `false` y el inicio de sesión sigue el camino web de siempre.
 */
type NavegadorDelSistema = {
  open(opciones: { url: string }): Promise<void>;
  close(): Promise<void>;
};

type Escucha = { remove(): Promise<void> };

type EventosDeApp = {
  addListener(
    evento: "appUrlOpen",
    manejador: (datos: { url: string }) => void,
  ): Promise<Escucha>;
};

let navegador: NavegadorDelSistema | null = null;
let eventos: EventosDeApp | null = null;

export function navegadorDelSistema(): NavegadorDelSistema {
  const plugin = navegador ?? registerPlugin<NavegadorDelSistema>("Browser");
  navegador = plugin;
  return plugin;
}

export function eventosDeLaApp(): EventosDeApp {
  const plugin = eventos ?? registerPlugin<EventosDeApp>("App");
  eventos = plugin;
  return plugin;
}

type BarraDeEstadoNativa = {
  setStyle(opciones: { style: "DARK" | "LIGHT" }): Promise<void>;
  setBackgroundColor(opciones: { color: string }): Promise<void>;
};

type CompartirRecibido = {
  addListener(
    evento: "compartido",
    manejador: (datos: { texto: string | null }) => void,
  ): Promise<Escucha>;
};

let compartir: CompartirRecibido | null = null;

/** El texto que otra app le compartió a EOS (solo Android por ahora). */
export function compartirRecibidoNativo(): CompartirRecibido {
  const plugin = compartir ?? registerPlugin<CompartirRecibido>("CompartirRecibido");
  compartir = plugin;
  return plugin;
}

let barra: BarraDeEstadoNativa | null = null;

export function barraDeEstadoNativa(): BarraDeEstadoNativa {
  const plugin = barra ?? registerPlugin<BarraDeEstadoNativa>("StatusBar");
  barra = plugin;
  return plugin;
}

/** ¿Se puede abrir el inicio de sesión en el navegador del sistema y volver a la app? */
export function puedeAbrirNavegadorDelSistema(): boolean {
  if (!estaEnAppNativa()) return false;
  try {
    return Capacitor.isPluginAvailable("Browser") && Capacitor.isPluginAvailable("App");
  } catch {
    return false;
  }
}
