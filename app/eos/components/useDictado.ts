"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  IDIOMA_DICTADO,
  leerResultados,
  mensajeDeErrorDeVoz,
  soportaDictado,
} from "@/lib/eos/dictado";

/**
 * El micrófono del compositor, atado al reconocedor del navegador.
 *
 * Toda la lógica que se puede probar sin un navegador vive en
 * `lib/eos/dictado.ts` y tiene sus tests. Acá queda solo lo que es
 * inevitablemente del DOM: crear el reconocedor, escuchar sus eventos y
 * apagarlo cuando el componente se va.
 *
 * ============================================================
 * SE APAGA SOLO, SIEMPRE
 * ============================================================
 *
 * Un micrófono que quedó prendido porque la persona cambió de pestaña es lo
 * peor que puede dejar esta función: el navegador muestra el punto rojo de
 * grabación y quien lo ve no tiene forma de saber qué lo dejó ahí. Por eso el
 * `stop` va en el cleanup del efecto y no solo en el botón.
 */

type ReconocedorMinimo = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((evento: { results: ArrayLike<never>; resultIndex?: number }) => void) | null;
  onerror: ((evento: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type ConstructorReconocedor = new () => ReconocedorMinimo;

function constructorDeVoz(): ConstructorReconocedor | null {
  if (typeof window === "undefined") return null;

  const w = window as unknown as {
    SpeechRecognition?: ConstructorReconocedor;
    webkitSpeechRecognition?: ConstructorReconocedor;
  };

  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type Dictado = {
  /** `false` en Firefox y en cualquier navegador sin reconocimiento. */
  soportado: boolean;
  escuchando: boolean;
  /** Lo que se está escuchando ahora y todavía puede cambiar. Solo para mostrar. */
  provisorio: string;
  error: string;
  alternar: () => void;
};

/*
 * El soporte del navegador se lee con `useSyncExternalStore` y no con un
 * `useState` en un efecto.
 *
 * Es una capacidad del entorno, no un estado que cambie: nunca se "suscribe" a
 * nada, y la snapshot del servidor es `false` porque durante el render del
 * servidor no hay `window`. Resuelto así, React sabe que el valor difiere entre
 * servidor y cliente y no hay ni parpadeo ni un render extra al montar.
 */
const SIN_CAMBIOS = () => () => {};
const hayVoz = () => soportaDictado(globalThis as never);
const noHayVozEnElServidor = () => false;

export function useDictado(agregarTexto: (texto: string) => void): Dictado {
  const soportado = useSyncExternalStore(SIN_CAMBIOS, hayVoz, noHayVozEnElServidor);

  const [escuchando, setEscuchando] = useState(false);
  const [provisorio, setProvisorio] = useState("");
  const [error, setError] = useState("");

  const reconocedorRef = useRef<ReconocedorMinimo | null>(null);

  /*
   * El callback en un ref y no en las dependencias del efecto.
   *
   * `agregarTexto` se recrea en cada render del compositor —depende del texto
   * actual—, así que si entrara como dependencia el efecto destruiría y
   * recrearía el reconocedor con cada tecla, cortando el dictado en el medio.
   *
   * La escritura va en un efecto: escribir un ref durante el render es lo que
   * rompe cuando React descarta un render a medias. El desfase de un render no
   * importa acá porque quien lo lee es un evento del micrófono, que ocurre
   * mucho después de que el render se confirmó.
   */
  const agregarRef = useRef(agregarTexto);

  useEffect(() => {
    agregarRef.current = agregarTexto;
  }, [agregarTexto]);

  useEffect(() => {
    return () => {
      reconocedorRef.current?.abort?.();
      reconocedorRef.current?.stop();
      reconocedorRef.current = null;
    };
  }, []);

  const alternar = useCallback(() => {
    if (reconocedorRef.current) {
      reconocedorRef.current.stop();
      return;
    }

    const Reconocedor = constructorDeVoz();
    if (!Reconocedor) return;

    const reconocedor = new Reconocedor();
    reconocedor.lang = IDIOMA_DICTADO;
    reconocedor.continuous = true;
    reconocedor.interimResults = true;

    reconocedor.onresult = (evento) => {
      const { definitivo, provisorio: enVuelo } = leerResultados(
        evento.results,
        evento.resultIndex ?? 0,
      );

      setProvisorio(enVuelo);
      if (definitivo) agregarRef.current(definitivo);
    };

    reconocedor.onerror = (evento) => {
      setError(mensajeDeErrorDeVoz(evento.error));
    };

    reconocedor.onend = () => {
      reconocedorRef.current = null;
      setEscuchando(false);
      setProvisorio("");
    };

    try {
      reconocedor.start();
    } catch {
      // `start()` tira si ya había uno corriendo. No es un error que le importe
      // a nadie: el estado se sincroniza igual en `onend`.
      return;
    }

    reconocedorRef.current = reconocedor;
    setError("");
    setEscuchando(true);
  }, []);

  return { soportado, escuchando, provisorio, error, alternar };
}
