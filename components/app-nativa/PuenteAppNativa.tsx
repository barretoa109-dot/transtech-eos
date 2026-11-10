"use client";

import { useEffect } from "react";
import {
  anotarRapidoNativo,
  estaEnAppNativa,
  eventosDeLaApp,
  navegadorDelSistema,
  puedeAbrirNavegadorDelSistema,
} from "@/lib/app-nativa/cliente";
import { callbackDesdeEnlaceApp, rapidoDesdeEnlaceApp } from "@/lib/app-nativa/plataforma";

/**
 * Escucha los enlaces con los que el sistema reabre la app:
 *
 * - `auth/callback`, al volver de iniciar sesión con Google o Apple en el
 *   navegador del sistema — lo lleva al callback web de siempre.
 * - `rapido`, cuando algo (no los Atajos de iOS — ver más abajo) reabre la
 *   app con el enlace propio.
 *
 * Esto corre siempre que la app nativa está instalada, no solo cuando se
 * puede abrir el navegador del sistema — a diferencia del login, "rapido" no
 * depende de esa capacidad. En la web no hace nada en ningún caso.
 */
export default function PuenteAppNativa() {
  useEffect(() => {
    if (!estaEnAppNativa()) return;

    let vigente = true;
    let escucha: { remove(): Promise<void> } | null = null;

    eventosDeLaApp()
      .addListener("appUrlOpen", ({ url }) => {
        const destinoRapido = rapidoDesdeEnlaceApp(url, window.location.origin);
        if (destinoRapido) {
          window.location.assign(destinoRapido);
          return;
        }

        if (!puedeAbrirNavegadorDelSistema()) return;

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

  /*
   * El Atajo de Siri o el toque en la parte de atrás del teléfono (iOS) no
   * reabren la app con un enlace: probado en un iPhone real, `openAppWhenRun`
   * ya trae la app al frente, y un segundo enlace propio lanzado desde el
   * mismo Intent se perdía en el camino (ver AnotarRapidoIntent.swift). Dejan
   * el texto en el contenedor del App Group, y esto lo busca cada vez que la
   * app vuelve a primer plano — mismo mecanismo que "Compartir con EOS".
   */
  useEffect(() => {
    if (!estaEnAppNativa()) return;

    let vigente = true;
    let escucha: { remove(): Promise<void> } | null = null;

    anotarRapidoNativo()
      .addListener("anotarPendiente", ({ texto }) => {
        const destino = texto ? `/eos/rapido?texto=${encodeURIComponent(texto)}` : "/eos/rapido";
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
