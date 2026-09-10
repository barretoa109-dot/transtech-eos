"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  ESPERA_MAXIMA_MS,
  IDIOMA_DICTADO,
  leerResultados,
  siguienteEstado,
  soportaDictado,
  type EstadoDictado,
  type EventoDictado,
} from "@/lib/eos/dictado";

/**
 * El micrófono del compositor, atado al reconocedor del navegador.
 *
 * Toda la lógica que se puede probar sin un navegador vive en
 * `lib/eos/dictado.ts` y tiene sus tests —incluida la máquina de estados—. Acá
 * queda solo lo que es inevitablemente del DOM: crear el reconocedor, escuchar
 * sus eventos y apagarlo.
 *
 * ============================================================
 * SE APAGA SOLO, SIEMPRE, POR UN SOLO CAMINO
 * ============================================================
 *
 * El bug que esto arregla, reportado desde un teléfono el 9 de septiembre de
 * 2026: micrófono sin permiso, aparece el aviso, y el botón se queda rojo
 * latiendo con "Escuchando…" para siempre. Había que recargar la página.
 *
 * La versión anterior repartía el apagado entre `onend` —que con el permiso
 * denegado NO llega en iOS ni en varios Android— y nada más. `onerror` solo
 * escribía el mensaje. Y `alternar` sobre un reconocedor ya muerto llamaba a
 * `stop()`, que no hace nada y no dispara ningún evento: el segundo toque
 * tampoco salía.
 *
 * Ahora hay UN solo lugar que apaga —`aplicar`, con la transición que decide
 * `siguienteEstado`— y todos los caminos pasan por ahí: el error, el fin, el
 * botón, el temporizador y el desmontaje. Si el navegador no dice nada en
 * `ESPERA_MAXIMA_MS`, se apaga igual.
 *
 * ============================================================
 * LOS EVENTOS TARDÍOS NO PISAN LA SESIÓN NUEVA
 * ============================================================
 *
 * Un `onend` del reconocedor anterior puede llegar después de que la persona
 * arrancó otro. Sin el número de sesión, ese evento apagaría el micrófono
 * recién abierto y el síntoma sería "a veces no arranca". Cada reconocedor
 * lleva su número y los eventos de un número viejo se descartan.
 */

type ReconocedorMinimo = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onstart: (() => void) | null;
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
  estado: EstadoDictado;
  /** Solo `true` con el micrófono abierto de verdad, nunca por optimismo. */
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

  const [estado, setEstado] = useState<EstadoDictado>("inactivo");
  const [provisorio, setProvisorio] = useState("");
  const [error, setError] = useState("");

  const reconocedorRef = useRef<ReconocedorMinimo | null>(null);
  const estadoRef = useRef<EstadoDictado>("inactivo");
  const sesionRef = useRef(0);
  const relojRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  /**
   * Soltar el micrófono, pase lo que pase.
   *
   * Le saca los callbacks ANTES de abortar: `abort()` dispara `onend`, y sin
   * desconectarlo ese `onend` volvería a entrar acá en medio del apagado.
   * `abort` y `stop` van los dos y adentro de un try: `abort` no existe en
   * todos los navegadores, y `stop` sobre un reconocedor que nunca arrancó
   * lanza en algunos.
   */
  const soltar = useCallback(() => {
    if (relojRef.current !== null) {
      clearTimeout(relojRef.current);
      relojRef.current = null;
    }

    const reconocedor = reconocedorRef.current;
    reconocedorRef.current = null;

    if (!reconocedor) return;

    reconocedor.onstart = null;
    reconocedor.onresult = null;
    reconocedor.onerror = null;
    reconocedor.onend = null;

    try {
      reconocedor.abort?.();
    } catch {
      // Nada que hacer: lo importante es que ya no está referenciado.
    }

    try {
      reconocedor.stop();
    } catch {
      // Idem. `stop()` sobre uno que no arrancó lanza en algunos navegadores.
    }
  }, []);

  /** El único lugar donde cambia el estado. Todos los caminos pasan por acá. */
  const aplicar = useCallback(
    (evento: EventoDictado) => {
      const transicion = siguienteEstado(estadoRef.current, evento);

      estadoRef.current = transicion.estado;
      setEstado(transicion.estado);

      if (transicion.soltar) {
        soltar();
        setProvisorio("");
      }

      // El mensaje vacío también se escribe: al arrancar de nuevo hay que
      // borrar el error anterior, o queda colgado abajo del campo.
      setError(transicion.error);
    },
    [soltar],
  );

  // Al desmontar, el micrófono se cierra igual. Un punto rojo de grabación que
  // quedó de una pestaña que ya no existe no lo puede explicar nadie.
  useEffect(() => () => soltar(), [soltar]);

  const alternar = useCallback(() => {
    if (estadoRef.current !== "inactivo") {
      /*
       * Cortar NO espera a `onend`.
       *
       * Es el segundo toque del bug: sobre un reconocedor muerto, `stop()` no
       * hace nada y `onend` no llega nunca. Se apaga acá mismo y se suelta;
       * si `onend` llega después, su sesión ya no es la actual y se descarta.
       */
      aplicar({ tipo: "cancelar" });
      return;
    }

    const Reconocedor = constructorDeVoz();
    if (!Reconocedor) return;

    const sesion = sesionRef.current + 1;
    sesionRef.current = sesion;

    /** Los eventos de un reconocedor viejo no tocan la sesión nueva. */
    const vigente = () => sesionRef.current === sesion;

    let reconocedor: ReconocedorMinimo;
    try {
      reconocedor = new Reconocedor();
      reconocedor.lang = IDIOMA_DICTADO;
      reconocedor.continuous = true;
      reconocedor.interimResults = true;
    } catch {
      aplicar({ tipo: "error", codigo: null });
      return;
    }

    // `onstart` es el único aviso de que el micrófono se abrió DE VERDAD.
    // Antes se daba por abierto apenas se llamaba a `start()`, y por eso
    // "Escuchando…" aparecía incluso cuando el permiso estaba denegado.
    reconocedor.onstart = () => {
      if (vigente()) aplicar({ tipo: "abrio" });
    };

    reconocedor.onresult = (evento) => {
      if (!vigente()) return;

      // Hay navegadores que entregan resultados sin haber emitido `onstart`.
      // Si llegó texto, el micrófono está abierto: no hay nada más que probar.
      if (estadoRef.current !== "escuchando") aplicar({ tipo: "abrio" });

      const { definitivo, provisorio: enVuelo } = leerResultados(
        evento.results,
        evento.resultIndex ?? 0,
      );

      setProvisorio(enVuelo);
      if (definitivo) agregarRef.current(definitivo);
    };

    reconocedor.onerror = (evento) => {
      if (vigente()) aplicar({ tipo: "error", codigo: evento?.error });
    };

    reconocedor.onend = () => {
      if (vigente()) aplicar({ tipo: "fin" });
    };

    reconocedorRef.current = reconocedor;
    aplicar({ tipo: "pedir" });

    /*
     * La red que atrapa lo que no avisa.
     *
     * Si en `ESPERA_MAXIMA_MS` no llegó ni `onstart`, ni `onerror`, ni `onend`
     * —que es lo que pasa en algunos WebView y con ciertos permisos
     * denegados— se apaga igual. Sin esto, el botón rojo depende de que el
     * navegador se acuerde de avisar.
     */
    relojRef.current = setTimeout(() => {
      if (vigente() && estadoRef.current === "pidiendo_permiso") {
        aplicar({ tipo: "vencio" });
      }
    }, ESPERA_MAXIMA_MS);

    try {
      reconocedor.start();
    } catch {
      /*
       * `start()` lanza si ya había uno corriendo, y también si el navegador
       * lo rechaza de entrada. En los dos casos hay que apagar: la versión
       * anterior hacía `return` y dejaba el estado prendido esperando un
       * `onend` que no iba a llegar.
       */
      aplicar({ tipo: "error", codigo: null });
    }
  }, [aplicar]);

  return {
    soportado,
    estado,
    escuchando: estado === "escuchando",
    provisorio,
    error,
    alternar,
  };
}
