/**
 * Las excepciones del servidor, guardadas sin datos de nadie (punto 11).
 *
 * `instrumentation.ts` llama a `registrarErrorDeServidor` desde el hook
 * `onRequestError` de Next. Esto decide QUÉ se guarda y lo guarda en
 * `eos_errores_servidor_v194` (ver la migración para el porqué).
 *
 * ============================================================
 * TRES REGLAS
 * ============================================================
 *
 * 1. **Nunca lanza.** Un error al registrar un error no puede convertirse en
 *    un segundo error que tape al primero. Todo termina en `console.error`,
 *    que es exactamente lo que había antes de este archivo.
 * 2. **Nada privado.** Sin cuerpo, headers ni query string. El mensaje se
 *    recorta y se le borran correos y números largos (teléfonos, RUC,
 *    tarjetas, importes): una excepción de Postgres puede traer el valor que
 *    falló, y ese valor puede ser el dato de alguien.
 * 3. **No inunda.** Un bug en una ruta caliente puede tirar cientos de
 *    excepciones por minuto. Cada instancia guarda como mucho
 *    `MAX_POR_MINUTO` por minuto; el resto se cuenta solo en el log.
 */

import { createHash } from "node:crypto";

export const MAX_POR_MINUTO = 20;
const MAX_MENSAJE = 500;
const MAX_PILA = 1_500;
const LINEAS_DE_PILA = 8;

export type RegistroDeError = {
  huella: string;
  clase: string;
  mensaje: string;
  ruta: string | null;
  tipo_ruta: string | null;
  metodo: string | null;
  digest: string | null;
  pila: string | null;
};

type PedidoNext = { path?: unknown; method?: unknown };
type ContextoNext = { routePath?: unknown; routeType?: unknown };

/** Borra lo que puede ser un dato personal. */
export function limpiarTexto(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[correo]")
    .replace(/\b(?:eyJ[\w-]+\.){2}[\w-]+\b/g, "[token]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/\d[\d.,\s-]{4,}\d/g, "[número]");
}

function recortar(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}

/** La ruta sin query ni fragmento: ahí viajan tokens de enlaces y búsquedas. */
export function rutaSinQuery(ruta: unknown): string | null {
  if (typeof ruta !== "string" || !ruta) return null;
  return recortar(ruta.split(/[?#]/)[0], 300);
}

/** Mismo error = misma huella, aunque cambien los números o el id del mensaje. */
function huellaDe(clase: string, mensaje: string, ruta: string | null): string {
  const base = `${clase}|${mensaje.replace(/\[[^\]]+\]|\d+/g, "#")}|${ruta ?? ""}`;
  return createHash("sha256").update(base).digest("hex").slice(0, 16);
}

export function prepararRegistroDeError(
  error: unknown,
  pedido: PedidoNext | undefined,
  contexto: ContextoNext | undefined,
): RegistroDeError {
  const esError = error instanceof Error;
  const clase = recortar(esError ? error.name || "Error" : typeof error, 80);
  const crudo = esError ? error.message : String(error);
  const mensaje = recortar(limpiarTexto(crudo || "(sin mensaje)"), MAX_MENSAJE);

  const digest =
    error && typeof error === "object" && "digest" in error
      ? recortar(String((error as { digest: unknown }).digest), 100)
      : null;

  const pila =
    esError && error.stack
      ? recortar(limpiarTexto(error.stack.split("\n").slice(0, LINEAS_DE_PILA).join("\n")), MAX_PILA)
      : null;

  const rutaArchivo = typeof contexto?.routePath === "string" ? contexto.routePath : null;
  const ruta = rutaArchivo ? recortar(rutaArchivo, 300) : rutaSinQuery(pedido?.path);

  return {
    huella: huellaDe(clase, mensaje, ruta),
    clase,
    mensaje,
    ruta,
    tipo_ruta: typeof contexto?.routeType === "string" ? contexto.routeType : null,
    metodo: typeof pedido?.method === "string" ? recortar(pedido.method, 10) : null,
    digest,
    pila,
  };
}

/** Cuenta cuántos se guardaron en el minuto en curso. Uno por instancia. */
export class Limitador {
  private minuto = -1;
  private usados = 0;
  private readonly maximo: number;
  descartados = 0;

  constructor(maximo: number = MAX_POR_MINUTO) {
    this.maximo = maximo;
  }

  permitir(ahora: number = Date.now()): boolean {
    const minuto = Math.floor(ahora / 60_000);
    if (minuto !== this.minuto) {
      this.minuto = minuto;
      this.usados = 0;
    }
    if (this.usados >= this.maximo) {
      this.descartados += 1;
      return false;
    }
    this.usados += 1;
    return true;
  }
}

const limitador = new Limitador();

type Insertar = (fila: RegistroDeError) => Promise<{ error: { message?: string } | null }>;

async function insertarEnSupabase(fila: RegistroDeError) {
  const { adminSinTipos } = await import("../supabase/sin-tipos.ts");
  return adminSinTipos().from("eos_errores_servidor_v194").insert(fila);
}

export async function registrarErrorDeServidor(
  error: unknown,
  pedido: PedidoNext | undefined,
  contexto: ContextoNext | undefined,
  insertar: Insertar = insertarEnSupabase,
  limite: Limitador = limitador,
): Promise<void> {
  try {
    const fila = prepararRegistroDeError(error, pedido, contexto);
    console.error("EOS excepción del servidor:", JSON.stringify(fila));

    if (!limite.permitir()) return;

    const { error: fallo } = await insertar(fila);
    if (fallo) console.error("EOS: no se pudo guardar la excepción:", fallo.message ?? fallo);
  } catch (err) {
    console.error("EOS: no se pudo registrar la excepción:", err);
  }
}

/* ============================================================
   LO QUE LEE EL CHEQUEO DE SALUD
   ============================================================ */

export type FilaErrores24h = {
  huella: string;
  clase: string;
  mensaje: string;
  ruta: string | null;
  veces: number;
  ultima_vez: string;
};

/** Un error que se repite esta cantidad de veces y sigue pasando es un bug activo. */
export const REPETICIONES_ALARMA = 5;
/** "Sigue pasando" = la última vez fue hace menos de esto. */
const VENTANA_ACTIVA_MS = 60 * 60_000;

/**
 * Rojo solo si hay un error que se REPITE y sigue ACTIVO en la última hora.
 * Una excepción suelta de ayer se informa pero no tumba la salud: el monitor
 * externo la consulta cada 5 minutos, y parpadear por un error aislado
 * enseña a ignorarla.
 */
export function evaluarErroresServidor(
  filas: FilaErrores24h[],
  ahora: number = Date.now(),
): { ok: boolean; detalle: string } {
  if (filas.length === 0) return { ok: true, detalle: "ninguna en 24 h" };

  const ordenadas = [...filas].sort((a, b) => Number(b.veces) - Number(a.veces));
  const total = ordenadas.reduce((n, f) => n + Number(f.veces || 0), 0);
  const activas = ordenadas.filter(
    (f) =>
      Number(f.veces) >= REPETICIONES_ALARMA &&
      ahora - Date.parse(f.ultima_vez) <= VENTANA_ACTIVA_MS,
  );

  const describir = (f: FilaErrores24h) =>
    `${f.veces}× ${f.clase} en ${f.ruta ?? "?"}: ${f.mensaje.slice(0, 120)}`;

  return {
    ok: activas.length === 0,
    detalle:
      `${total} en 24 h, ${ordenadas.length} distinta(s)` +
      ` — ${(activas.length ? activas : ordenadas).slice(0, 3).map(describir).join(" | ")}`,
  };
}
