"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Claro u oscuro, y quién lo decide.
 *
 * ============================================================
 * EL SISTEMA PROPONE; LA PERSONA DISPONE
 * ============================================================
 *
 * Hay tres estados, no dos:
 *
 *   "sistema"  — nunca eligió. Sigue lo que diga el teléfono o la computadora,
 *                y cambia solo cuando ese ajuste cambia (al anochecer, por
 *                ejemplo).
 *   "claro"    — lo eligió.
 *   "oscuro"   — lo eligió.
 *
 * El tercero importa. Con solo dos, la primera visita tendría que arrancar en
 * uno de los dos y esa elección arbitraria sería la que la persona ve; con
 * "sistema" como punto de partida, quien tiene el teléfono en oscuro abre EOS
 * en oscuro sin haber tocado nada, que es lo que espera.
 *
 * Y una vez que eligió, manda su elección aunque el sistema diga otra cosa.
 * Resolverlo solo con `@media (prefers-color-scheme: dark)` habría hecho
 * imposible ese caso: quien tiene todo en oscuro pero quiere EOS en claro
 * —porque está al sol, o porque le cuesta leer texto claro sobre negro— no
 * tendría forma de pedirlo.
 *
 * ============================================================
 * POR QUÉ NO PARPADEA
 * ============================================================
 *
 * El tema se aplica sobre el elemento `.eos-app`, que es cliente, y arranca en
 * "claro" durante el render del servidor. Si el efecto que lee la preferencia
 * corriera tarde, quien usa oscuro vería un fogonazo blanco en cada carga.
 *
 * Por eso el efecto no hace nada más que leer `localStorage` y correr antes de
 * pintar. El fogonazo real —el de la primera carga de la página, antes de que
 * React exista— no se puede evitar desde acá: necesitaría un script en el
 * `<head>`, y esta hoja de estilos solo gobierna el shell logueado.
 */

export type Tema = "sistema" | "claro" | "oscuro";

const CLAVE = "eos-tema";

function esTema(valor: unknown): valor is Tema {
  return valor === "sistema" || valor === "claro" || valor === "oscuro";
}

/*
 * La copia en memoria, para cuando `localStorage` no está.
 *
 * En navegación privada, con las cookies bloqueadas o dentro de un iframe sin
 * permisos, tanto leer como escribir tiran. Sin esta copia el botón del tema
 * quedaría muerto justo ahí: se aprieta, no se guarda nada, se vuelve a leer
 * lo de antes y la pantalla no cambia. Con ella, el tema funciona toda la
 * sesión y lo único que se pierde es que lo recuerde mañana.
 */
let enMemoria: Tema | null = null;

function leerGuardado(): Tema {
  try {
    const guardado = window.localStorage.getItem(CLAVE);
    if (esTema(guardado)) return guardado;
    // Sin nada guardado gana la copia en memoria: puede haberse elegido en
    // esta misma sesión sin que el navegador dejara escribirlo.
    return enMemoria ?? "sistema";
  } catch {
    return enMemoria ?? "sistema";
  }
}

export type ControlTema = {
  /** Lo que eligió la persona, incluido "sistema". Es lo que muestra el menú. */
  preferencia: Tema;
  /** Lo que se está viendo ahora. Nunca es "sistema". */
  aplicado: "claro" | "oscuro";
  elegir: (tema: Tema) => void;
  /** Claro ⇄ oscuro, para el botón de un solo toque. */
  alternar: () => void;
};

/*
 * Los dos valores son estado EXTERNO a React —uno vive en `localStorage`, el
 * otro en el sistema operativo—, así que se leen con `useSyncExternalStore` y
 * no con `useState` dentro de un efecto. Además de ser lo que corresponde,
 * evita el render de más al montar, que en un tema es un fogonazo.
 *
 * El `Set` de suscriptores existe para que la elección hecha en un componente
 * llegue a todos los que usan el hook. También escucha el evento `storage`:
 * quien tiene EOS abierto en dos pestañas y cambia el tema en una, ve la otra
 * cambiar sola.
 */
const suscriptores = new Set<() => void>();

function avisar() {
  for (const s of suscriptores) s();
}

function suscribirPreferencia(alCambiar: () => void) {
  suscriptores.add(alCambiar);
  window.addEventListener("storage", alCambiar);

  return () => {
    suscriptores.delete(alCambiar);
    window.removeEventListener("storage", alCambiar);
  };
}

function suscribirSistema(alCambiar: () => void) {
  const consulta = window.matchMedia("(prefers-color-scheme: dark)");
  consulta.addEventListener("change", alCambiar);
  return () => consulta.removeEventListener("change", alCambiar);
}

const sistemaEnOscuro = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

/*
 * En el servidor no hay ni `localStorage` ni preferencia de sistema, así que
 * el HTML se arma siempre en claro y el cliente lo corrige al hidratar.
 */
const sinPreferencia = (): Tema => "sistema";
const sinSistemaOscuro = () => false;

export function useTema(): ControlTema {
  const preferencia = useSyncExternalStore(suscribirPreferencia, leerGuardado, sinPreferencia);
  const sistemaOscuro = useSyncExternalStore(suscribirSistema, sistemaEnOscuro, sinSistemaOscuro);

  const aplicado: "claro" | "oscuro" =
    preferencia === "sistema" ? (sistemaOscuro ? "oscuro" : "claro") : preferencia;

  const elegir = useCallback((tema: Tema) => {
    enMemoria = tema === "sistema" ? null : tema;

    try {
      if (tema === "sistema") window.localStorage.removeItem(CLAVE);
      else window.localStorage.setItem(CLAVE, tema);
    } catch {
      // Igual que al leer: se pierde entre sesiones y se sigue usando.
    }

    avisar();
  }, []);

  /*
   * Alternar parte de lo que se VE, no de la preferencia guardada.
   *
   * Quien está en "sistema" viendo claro y aprieta el botón quiere oscuro. Si
   * el cambio se calculara sobre la preferencia —"sistema" no es ni claro ni
   * oscuro— habría que inventar hacia dónde va, y una de cada dos veces el
   * botón no haría nada visible.
   */
  const alternar = useCallback(() => {
    elegir(aplicado === "oscuro" ? "claro" : "oscuro");
  }, [aplicado, elegir]);

  return { preferencia, aplicado, elegir, alternar };
}
