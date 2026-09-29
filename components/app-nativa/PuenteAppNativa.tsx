"use client";

import { useEffect } from "react";
import {
  eventosDeLaApp,
  navegadorDelSistema,
  puedeAbrirNavegadorDelSistema,
} from "@/lib/app-nativa/cliente";
import { callbackDesdeEnlaceApp } from "@/lib/app-nativa/plataforma";

/**
 * Escucha el enlace con el que el sistema reabre la app después de iniciar
 * sesión con Google o Apple en el navegador del sistema, y lo lleva al
 * callback web de siempre.
 *
 * Google no deja iniciar sesión dentro de un WebView embebido
 * (`disallowed_useragent`), así que en la app ese paso se hace afuera y
 * vuelve por `com.transtech.eos://auth/callback`. En la web no hace nada.
 */
export default function PuenteAppNativa() {
  useEffect(() => {
    if (!puedeAbrirNavegadorDelSistema()) return;

    let vigente = true;
    let escucha: { remove(): Promise<void> } | null = null;

    eventosDeLaApp()
      .addListener("appUrlOpen", ({ url }) => {
        const destino = callbackDesdeEnlaceApp(url, window.location.origin);
        if (!destino) return;

        // En Android la pestaña del sistema no se puede cerrar desde la app: se ignora.
        navegadorDelSistema().close().catch(() => {});
        window.location.assign(destino);
      })
      .then((e) => {
        if (vigente) escucha = e;
        else void e.remove();
      })
      .catch(() => {});

    return () => {
      vigente = false;
      void escucha?.remove();
    };
  }, []);

  return null;
}
