/**
 * Offline-first (ítem 24), primera pieza: ver los últimos números conocidos
 * sin conexión. Ver `docs/arquitectura-offline-first-2026-11-07.md`.
 *
 * Guarda en `indexedDB` del navegador la ÚLTIMA respuesta que una pantalla
 * ya mostró con éxito, con la hora en que se guardó. Cuando la próxima
 * carga falla por falta de red, la pantalla puede mostrar esto en vez de un
 * error — siempre marcado como viejo, nunca como el estado actual.
 *
 * Solo para LEER, nunca para escribir una acción financiera: esto no es una
 * cola de cambios pendientes, es una fotografía de lo que ya se vio.
 *
 * `indexedDB` puede no existir (navegador viejo, modo privado estricto) o
 * fallar: en los dos casos se devuelve `null`/no se guarda nada, y quien
 * llama sigue con el comportamiento de siempre —sin esta caché, la pantalla
 * es igual de útil que antes de que existiera.
 */

const DB_NOMBRE = "eos-offline";
const DB_VERSION = 1;
const ALMACEN = "snapshots";

export type Snapshot<T> = { datos: T; guardado_en: string };

function abrirDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("sin indexedDB"));
      return;
    }

    const pedido = indexedDB.open(DB_NOMBRE, DB_VERSION);
    pedido.onupgradeneeded = () => {
      if (!pedido.result.objectStoreNames.contains(ALMACEN)) {
        pedido.result.createObjectStore(ALMACEN);
      }
    };
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
}

/** Guarda la última respuesta buena. Nunca lanza: si falla, no se guardó, y listo. */
export async function guardarSnapshot<T>(clave: string, datos: T): Promise<void> {
  try {
    const db = await abrirDb();
    const snapshot: Snapshot<T> = { datos, guardado_en: new Date().toISOString() };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ALMACEN, "readwrite");
      tx.objectStore(ALMACEN).put(snapshot, clave);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Sin caché: la pantalla sigue funcionando igual, solo que sin respaldo offline.
  }
}

/** Lee la última respuesta guardada, o `null` si nunca se guardó una o algo falló. */
export async function leerSnapshot<T>(clave: string): Promise<Snapshot<T> | null> {
  try {
    const db = await abrirDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(ALMACEN, "readonly");
      const pedido = tx.objectStore(ALMACEN).get(clave);
      pedido.onsuccess = () => resolve((pedido.result as Snapshot<T> | undefined) ?? null);
      pedido.onerror = () => reject(pedido.error);
    });
  } catch {
    return null;
  }
}

/** "hace 3 horas", "hace 2 días" — para decir sin ambigüedad qué tan viejo es un número cacheado. */
export function hace(iso: string, ahora: Date = new Date()): string {
  const diferencia = ahora.getTime() - Date.parse(iso);
  const minutos = Number.isFinite(diferencia) ? Math.max(0, Math.round(diferencia / 60_000)) : 0;

  if (minutos < 1) return "hace un momento";
  if (minutos < 60) return minutos === 1 ? "hace 1 minuto" : `hace ${minutos} minutos`;

  const horas = Math.round(minutos / 60);
  if (horas < 24) return horas === 1 ? "hace 1 hora" : `hace ${horas} horas`;

  const dias = Math.round(horas / 24);
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}
