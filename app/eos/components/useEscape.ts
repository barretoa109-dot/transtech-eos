"use client";

import { useEffect, useRef } from "react";

/**
 * Escape cierra lo que está abierto.
 *
 * ============================================================
 * NO ES UNA COMODIDAD
 * ============================================================
 *
 * Los formularios que se abren en el lugar del botón —el "Conté y hay…" de una
 * caja, el alta de un contacto, el detalle de una oportunidad— se cierran con
 * un botón "Cancelar" que hay que ir a buscar. Con mouse es un gesto; con
 * teclado son varios Tab en una dirección que la persona no puede prever,
 * porque no sabe cuántos campos hay entre donde está y el botón.
 *
 * Escape es la tecla que todo el mundo ya prueba primero, y no funcionaba. Es
 * el mismo hueco que ya se había corregido en el cajón de navegación del
 * celular (se abría y no se podía cerrar con teclado): esto lo cierra para el
 * resto de los paneles.
 *
 * ============================================================
 * SE ESCUCHA EN EL DOCUMENTO, NO EN EL PANEL
 * ============================================================
 *
 * Un `onKeyDown` en el contenedor solo funciona mientras el foco esté adentro.
 * Alcanza para el caso feliz y falla justo en el que importa: quien abrió el
 * panel, hizo clic en otro lado y quiere volver atrás.
 *
 * A cambio hay que ser cuidadoso con dos cosas, y las dos están contempladas:
 * el efecto solo engancha el oyente cuando `activo` es cierto —un panel
 * cerrado no escucha nada— y no toca el evento, así que un `select` o un
 * autocompletado abierto se cierran ellos primero, como corresponde.
 */
export function useEscape(activo: boolean, alCerrar: () => void) {
  /*
   * El callback en un ref.
   *
   * Quien llama pasa casi siempre una flecha nueva en cada render
   * (`() => setAbierto(false)`). Si entrara como dependencia, el oyente se
   * desengancharía y reengancharía en cada tecla que se escribe adentro del
   * panel. Con el ref, el oyente se suscribe cuando el panel se abre y se va
   * cuando se cierra —que es cuando importa— y siempre llama a la versión
   * última, sin quedarse con una vieja.
   */
  const cerrarRef = useRef(alCerrar);

  useEffect(() => {
    cerrarRef.current = alCerrar;
  }, [alCerrar]);

  useEffect(() => {
    if (!activo) return;

    function alPresionar(evento: KeyboardEvent) {
      if (evento.key === "Escape") cerrarRef.current();
    }

    document.addEventListener("keydown", alPresionar);
    return () => document.removeEventListener("keydown", alPresionar);
  }, [activo]);
}
