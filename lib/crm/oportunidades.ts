import { esFechaISOValida } from "../fecha.ts";

/**
 * Los campos de una oportunidad que se pueden editar, validados.
 *
 * Solo entra lo que VINO en el cuerpo: rellenar lo que falta con un valor por defecto
 * borraría datos que la persona no tocó. Un campo que viene vacío ("" o null) es
 * "quitar este dato"; un campo que no viene es "no lo toques".
 *
 * Los tres campos de la v185 (`probabilidad`, `producto_servicio`, `proxima_accion_en`)
 * van aparte de los de siempre para poder saber si hay que escribirlos: contra una base
 * que todavía no tiene las columnas, escribirlas rompería la oportunidad entera.
 */

export type CambiosOportunidad = {
  base: Record<string, unknown>;
  nuevos: Record<string, unknown>;
};

export type ValidacionCambios = { ok: true; cambios: CambiosOportunidad } | { ok: false; error: string; campo: string };

const texto = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export function validarCambios(cuerpo: Record<string, unknown>): ValidacionCambios {
  const base: Record<string, unknown> = {};
  const nuevos: Record<string, unknown> = {};

  if (cuerpo.titulo !== undefined) {
    const titulo = texto(cuerpo.titulo, 200);
    if (!titulo) return { ok: false, campo: "titulo", error: "La oportunidad necesita un título." };
    base.titulo = titulo;
  }

  if (cuerpo.detalle !== undefined) base.detalle = texto(cuerpo.detalle, 2000) || null;

  if (cuerpo.monto !== undefined) {
    const monto = Number(cuerpo.monto);
    if (!Number.isFinite(monto) || monto < 0) {
      return { ok: false, campo: "monto", error: "El monto tiene que ser un número mayor o igual a cero." };
    }
    base.monto = monto;
  }

  if (cuerpo.cierre_estimado !== undefined) {
    const v = cuerpo.cierre_estimado;
    if (v === null || v === "") base.cierre_estimado = null;
    else if (esFechaISOValida(v)) base.cierre_estimado = v;
    else return { ok: false, campo: "cierre_estimado", error: "La fecha de cierre no es válida." };
  }

  // ---------------------------------------------------------------- v185

  if (cuerpo.probabilidad !== undefined) {
    const v = cuerpo.probabilidad;
    if (v === null || v === "") {
      nuevos.probabilidad = null;
    } else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 100) {
        return { ok: false, campo: "probabilidad", error: "La probabilidad es un número entero de 0 a 100." };
      }
      nuevos.probabilidad = n;
    }
  }

  if (cuerpo.producto_servicio !== undefined) nuevos.producto_servicio = texto(cuerpo.producto_servicio, 200) || null;

  if (cuerpo.proxima_accion_en !== undefined) {
    const v = cuerpo.proxima_accion_en;
    if (v === null || v === "") nuevos.proxima_accion_en = null;
    else if (esFechaISOValida(v)) nuevos.proxima_accion_en = v;
    else return { ok: false, campo: "proxima_accion_en", error: "La fecha del próximo paso no es válida." };
  }

  return { ok: true, cambios: { base, nuevos } };
}

/** ¿Este error de Postgres/PostgREST es "la columna todavía no existe" (v185 sin aplicar)? */
export function faltaLaColumna(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}
