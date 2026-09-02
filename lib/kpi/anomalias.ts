import { diasSinPoderCalcular, rachaDe, promedioReciente, MINIMO_PARA_RACHA } from "./historia.ts";
import { formatearValor } from "./formato.ts";
import type { PuntoHistoria } from "./historia.ts";
import type { Direccion, ResultadoKPI } from "./tipos.ts";

/**
 * Qué de todo esto es una noticia.
 *
 * ============================================================
 * TRES CLASES DE AFIRMACIÓN, Y NO SE MEZCLAN
 * ============================================================
 *
 * `hecho` es lo que salió de los datos: "el margen cayó 4,3 puntos". Se puede
 * comprobar.
 *
 * `hipotesis` es una explicación posible que EOS no puede confirmar con lo que
 * tiene. Va siempre redactada como pregunta o con "puede que", nunca como
 * causa.
 *
 * `estimacion` es una proyección: cierta solo si sigue pasando lo mismo.
 *
 * Mezclarlas es la forma más rápida de que el usuario deje de creer todo el
 * panel. Una causa inventada que resulta falsa quema también a los hechos que
 * estaban bien.
 *
 * ============================================================
 * LA CLAVE ES LO QUE EVITA EL RUIDO
 * ============================================================
 *
 * Mismo mecanismo que `lib/erp/riesgos-negocio.ts`: cada anomalía trae una
 * clave estable armada con lo que la compone. Misma clave, mismo problema, no
 * se vuelve a avisar. Es lo que separa un panel que se mira todos los días de
 * uno que se ignora a la semana.
 *
 * ============================================================
 * LO QUE NO DETECTA, Y POR QUÉ
 * ============================================================
 *
 * No hay detección de "gasto anormal" por desvío estadístico. Con pocos meses
 * de historia, cualquier regla razonable marca como anormal la compra anual
 * del seguro. Es la misma decisión —y por el mismo motivo— que ya tomó
 * `riesgos-negocio.ts`, y se sostiene hasta tener historia suficiente.
 */

export type Clase = "hecho" | "hipotesis" | "estimacion";

export type Severidad = "critico" | "atencion" | "oportunidad" | "info";

export type Anomalia = {
  /** Estable mientras el problema sea el mismo. Ver arriba. */
  clave: string;
  indicador: string;
  moneda: string;
  severidad: Severidad;
  clase: Clase;
  /** Qué pasó, en una línea. */
  titulo: string;
  /** Los números que lo sostienen. */
  evidencia: string;
  /**
   * Para ordenar. No es plata: es una nota de 0 a 1 que combina cuánto
   * importa, cuán urgente es y cuánto se confía en el dato.
   */
  prioridad: number;
};

/** Cuánto tiene que moverse algo contra su propio promedio para ser noticia. */
const DESVIO_NOTICIA = 0.25;

/** A partir de cuántos días sin poder calcular, eso mismo es el problema. */
const DIAS_SIN_CALCULAR_NOTICIA = 7;

const PESO_SEVERIDAD: Record<Severidad, number> = {
  critico: 1,
  atencion: 0.65,
  oportunidad: 0.4,
  info: 0.2,
};

/**
 * Impacto × urgencia × confianza, como pide el punto 24.
 *
 * La confianza entra multiplicando y no sumando a propósito: un hallazgo
 * calculado con la mitad de los datos vale literalmente la mitad, y no "un
 * poco menos". Es lo que evita que una alerta basada en tres ventas sin costo
 * encabece el panel.
 */
function prioridadDe(severidad: Severidad, confianza: number): number {
  return Number((PESO_SEVERIDAD[severidad] * Math.max(0, Math.min(1, confianza))).toFixed(3));
}

/** Si moverse en esa dirección es una mala noticia para ese indicador. */
function esMalo(direccion: Direccion, sube: boolean): boolean {
  if (direccion === "neutro") return false;
  return direccion === "mas_es_mejor" ? !sube : sube;
}

export type EntradaAnomalias = {
  resultado: ResultadoKPI;
  /** La serie del indicador, si se tiene. Sin ella solo se evalúa el hoy. */
  puntos?: PuntoHistoria[];
};

export function detectarAnomalias(entradas: EntradaAnomalias[]): Anomalia[] {
  const salida: Anomalia[] = [];

  for (const { resultado: r, puntos } of entradas) {
    const conf = r.confianza.nivel;

    // ---- 1. Cruzó su umbral. Es un hecho del día, no necesita historia. ----
    if (r.estado === "alerta" || r.estado === "atencion") {
      const severidad: Severidad = r.estado === "alerta" ? "critico" : "atencion";
      salida.push({
        clave: `umbral:${r.id}:${r.moneda}:${r.estado}`,
        indicador: r.id,
        moneda: r.moneda,
        severidad,
        clase: "hecho",
        titulo: `${r.nombre} está en zona de ${r.estado === "alerta" ? "alerta" : "atención"}.`,
        evidencia:
          r.valor === null
            ? (r.falta ?? "Sin valor.")
            : `Hoy: ${formatearValor(r.valor, r.unidad, r.moneda)}.`,
        prioridad: prioridadDe(severidad, conf),
      });
    }

    // ---- 2. Hace días que no se puede calcular. Eso mismo es el problema. ----
    if (puntos && puntos.length > 0) {
      const sin = diasSinPoderCalcular(puntos);
      if (sin >= DIAS_SIN_CALCULAR_NOTICIA) {
        salida.push({
          clave: `sin-datos:${r.id}:${r.moneda}`,
          indicador: r.id,
          moneda: r.moneda,
          severidad: "atencion",
          clase: "hecho",
          titulo: `Hace ${sin} días que no se puede calcular ${r.nombre.toLowerCase()}.`,
          evidencia: r.falta ?? "Falta cargar el dato que necesita.",
          prioridad: prioridadDe("atencion", 1),
        });
      }
    }

    // ---- 3. Viene sostenidamente para el lado malo. ----
    if (puntos && puntos.length > 0) {
      const racha = rachaDe(puntos);
      const sube = racha.direccion === "sube";

      if (
        (racha.direccion === "sube" || racha.direccion === "baja") &&
        racha.dias >= MINIMO_PARA_RACHA &&
        esMalo(r.direccion, sube)
      ) {
        salida.push({
          // Los días entran en la clave: que la racha se alargue ES una
          // noticia nueva, aunque el problema sea el mismo.
          clave: `racha:${r.id}:${r.moneda}:${racha.direccion}:${racha.dias}`,
          indicador: r.id,
          moneda: r.moneda,
          severidad: "atencion",
          clase: "hecho",
          titulo: `${r.nombre} viene ${sube ? "subiendo" : "bajando"} hace ${racha.dias} días seguidos.`,
          evidencia:
            r.valor === null
              ? "Sin valor hoy."
              : `Hoy: ${formatearValor(r.valor, r.unidad, r.moneda)}.`,
          prioridad: prioridadDe("atencion", conf),
        });
      }
    }

    // ---- 4. Se apartó de su propio promedio reciente. ----
    if (puntos && puntos.length >= 4 && r.valor !== null) {
      const promedio = promedioReciente(puntos.slice(0, -1), 14);

      if (promedio !== null && promedio !== 0) {
        const desvio = (r.valor - promedio) / Math.abs(promedio);

        if (Math.abs(desvio) >= DESVIO_NOTICIA) {
          const malo = esMalo(r.direccion, desvio > 0);
          const severidad: Severidad = malo ? "atencion" : "oportunidad";

          salida.push({
            clave: `desvio:${r.id}:${r.moneda}:${desvio > 0 ? "arriba" : "abajo"}`,
            indicador: r.id,
            moneda: r.moneda,
            severidad,
            clase: "hecho",
            titulo: `${r.nombre} está ${Math.abs(Math.round(desvio * 100))}% ${
              desvio > 0 ? "por encima" : "por debajo"
            } de su promedio.`,
            evidencia: `Hoy ${formatearValor(r.valor, r.unidad, r.moneda)} contra ${formatearValor(
              promedio,
              r.unidad,
              r.moneda,
            )} de promedio de los últimos días.`,
            prioridad: prioridadDe(severidad, conf),
          });
        }
      }
    }
  }

  return ordenar(salida);
}

/** Lo más prioritario primero; a igual prioridad, se conserva el orden de entrada. */
export function ordenar(anomalias: Anomalia[]): Anomalia[] {
  return [...anomalias]
    .map((a, i) => ({ a, i }))
    .sort((x, y) => y.a.prioridad - x.a.prioridad || x.i - y.i)
    .map(({ a }) => a);
}

/**
 * Las que todavía no se avisaron, comparando contra las claves ya vistas.
 *
 * Se separa de la detección para que la decisión "esto ya lo dije" sea
 * explícita y testeable, en vez de quedar escondida adentro del detector.
 */
export function novedosas(anomalias: Anomalia[], yaAvisadas: string[]): Anomalia[] {
  const vistas = new Set(yaAvisadas);
  return anomalias.filter((a) => !vistas.has(a.clave));
}
