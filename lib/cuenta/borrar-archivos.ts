/**
 * Los archivos de una cuenta que se da de baja.
 *
 * ============================================================
 * POR QUÉ EXISTE
 * ============================================================
 *
 * /privacidad promete que al eliminar la cuenta "se borra todo". Hasta el
 * 30/09/2026 se borraban las filas de la base (`eos_borrar_mis_datos_v55`), la
 * tarjeta en Bancard y el usuario de Auth, pero no los ARCHIVOS: las fotos que
 * la persona mandó al chat y los documentos que subió seguían en Storage, con
 * su id como carpeta, después de irse.
 *
 * Qué se borra y qué no:
 *
 *  - `eos-chat-imagenes` (fotos, videos del chat) y `eos-documents`
 *    (documentos subidos): todo lo que cuelga de `<usuario_id>/`.
 *  - `comprobantes-pago` NO: son comprobantes de pagos, y van con los
 *    registros de facturación que se conservan por ley (ver la v182 y
 *    docs/privacidad-retencion-de-datos.md). La política lo dice.
 *
 * Es "mejor esfuerzo", como las tarjetas de Bancard: si Storage falla, la baja
 * sigue (no se deja a nadie atrapado en una cuenta que quiere cerrar) y lo que
 * quedó se registra para limpiarlo a mano.
 */

export const BUCKETS_DE_LA_CUENTA = ["eos-chat-imagenes", "eos-documents"] as const;

type Entrada = { name: string; id: string | null };

export type ClienteStorage = {
  storage: {
    from(bucket: string): {
      list(
        carpeta: string,
        opciones: { limit: number; offset: number },
      ): Promise<{ data: Entrada[] | null; error: { message: string } | null }>;
      remove(rutas: string[]): Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
};

const POR_PAGINA = 1000;
const POR_TANDA = 100;

/** Todas las rutas de archivo debajo de `carpeta`, recorriendo subcarpetas. */
export async function rutasDebajoDe(cliente: ClienteStorage, bucket: string, carpeta: string): Promise<string[]> {
  const rutas: string[] = [];
  for (let offset = 0; ; offset += POR_PAGINA) {
    const { data, error } = await cliente.storage.from(bucket).list(carpeta, { limit: POR_PAGINA, offset });
    if (error) throw new Error(`${bucket}/${carpeta}: ${error.message}`);
    const entradas = data ?? [];
    for (const e of entradas) {
      const ruta = `${carpeta}/${e.name}`;
      // Storage devuelve las carpetas con id null.
      if (e.id === null) rutas.push(...(await rutasDebajoDe(cliente, bucket, ruta)));
      else rutas.push(ruta);
    }
    if (entradas.length < POR_PAGINA) return rutas;
  }
}

export type ResultadoBucket = { bucket: string; borrados: number; error?: string };

export async function borrarArchivosDeLaCuenta(cliente: ClienteStorage, usuarioId: string): Promise<ResultadoBucket[]> {
  if (!/^[0-9a-f-]{36}$/i.test(usuarioId)) throw new Error("usuarioId inválido");

  const resultados: ResultadoBucket[] = [];
  for (const bucket of BUCKETS_DE_LA_CUENTA) {
    let borrados = 0;
    try {
      const rutas = await rutasDebajoDe(cliente, bucket, usuarioId);
      for (let i = 0; i < rutas.length; i += POR_TANDA) {
        const tanda = rutas.slice(i, i + POR_TANDA);
        const { error } = await cliente.storage.from(bucket).remove(tanda);
        if (error) throw new Error(error.message);
        borrados += tanda.length;
      }
      resultados.push({ bucket, borrados });
    } catch (error) {
      resultados.push({ bucket, borrados, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return resultados;
}
