/**
 * Guardar un turno de WhatsApp (lo que escribió la persona y lo que contestó
 * EOS) sin perderlo en silencio.
 *
 * ============================================================
 * EL CASO (29/09 → 05/10/2026)
 * ============================================================
 *
 * Desde el 29/09 a las 18:39 UTC no quedó guardado NINGÚN mensaje de WhatsApp
 * en `mensajes`, de ninguna cuenta. El chat seguía contestando, así que nadie
 * lo notó. El 01/10 Sofía citó "Costo final del zapato marrón mocha…" con
 * "Registra la venta de esto" y EOS contestó "No tengo el mensaje al que
 * respondés"; después le respondió "155.000gs" a "¿A cuánto lo cobraste [el
 * chaleco]?" y EOS le cambió el costo a la gorra Lacoste. Las dos cosas
 * salen de lo mismo: el modelo no veía la conversación. Lo último guardado
 * era del 29/09, y ahí EOS le pedía "el costo base de la gorra".
 *
 * La causa: el insert de los dos mensajes del turno mandaba `metadata` solo en
 * la fila de la persona (los ids de WhatsApp, para encontrarla si la citan).
 * `supabase-js` arma un insert de varias filas con la UNIÓN de las columnas y,
 * por defecto (`defaultToNull`), pone `NULL` en la que a una fila le falta.
 * `mensajes.metadata` es NOT NULL: error 23502 y no se guardaba ninguna de las
 * dos. Reproducido contra la base el 05/10/2026.
 *
 * ============================================================
 * LA REGLA
 * ============================================================
 *
 * Las dos filas salen de acá, con las MISMAS columnas, y se insertan con
 * `defaultToNull: false` (lo que falte toma el default de la tabla). Si aun así
 * el insert falla, se intenta fila por fila: perder la respuesta de EOS es
 * malo, perder además lo que dijo la persona es peor.
 */

export type FilaMensaje = {
  conversacion_id: string;
  usuario_id: string;
  rol: "usuario" | "eos";
  texto: string;
  origen: string;
  metadata: Record<string, unknown>;
};

export type Turno = {
  conversacionId: string;
  usuarioId: string;
  textoUsuario: string;
  textoEos: string;
  /** Los ids de WhatsApp de lo que mandó la persona (para encontrarlo si lo cita). */
  waIds?: string[];
  origen?: string;
};

/** Las dos filas del turno, con exactamente las mismas columnas. */
export function filasDelTurno(t: Turno): [FilaMensaje, FilaMensaje] {
  const origen = t.origen || "whatsapp";
  const waIds = (t.waIds ?? []).filter((id) => typeof id === "string" && id.trim() !== "");

  return [
    {
      conversacion_id: t.conversacionId,
      usuario_id: t.usuarioId,
      rol: "usuario",
      texto: t.textoUsuario || "[adjunto]",
      origen,
      metadata: waIds.length > 0 ? { wa_ids: waIds } : {},
    },
    {
      conversacion_id: t.conversacionId,
      usuario_id: t.usuarioId,
      rol: "eos",
      texto: t.textoEos,
      origen,
      // El id de la respuesta recién se sabe al mandarla: se agrega después.
      metadata: {},
    },
  ];
}

type ErrorDeBase = { code?: string; message?: string } | null;

/** Lo mínimo de `supabase-js` que hace falta, para poder probarlo sin red. */
export type ClienteMensajes = {
  from(tabla: "mensajes"): {
    insert(
      filas: FilaMensaje[],
      opciones?: { defaultToNull?: boolean },
    ): {
      select(columnas: string): PromiseLike<{ data: unknown; error: ErrorDeBase }>;
    };
  };
};

export type Guardado = {
  /** El id de la fila de EOS, si quedó guardada: para anotarle el id de WhatsApp. */
  idEos: string | null;
  /** Cuántas filas quedaron guardadas (0, 1 o 2). */
  guardadas: number;
  error: ErrorDeBase;
};

/**
 * Guarda el turno. Nunca lanza: quien llama ya tiene la respuesta y la tiene
 * que mandar igual.
 */
export async function guardarTurno(cliente: ClienteMensajes, t: Turno): Promise<Guardado> {
  const filas = filasDelTurno(t);

  const insertar = async (lote: FilaMensaje[]) => {
    try {
      const r = await cliente.from("mensajes").insert(lote, { defaultToNull: false }).select("id, rol");
      return { data: (r.data ?? []) as Array<{ id: string; rol: string }>, error: r.error };
    } catch (error) {
      return { data: [], error: { message: error instanceof Error ? error.message : String(error) } };
    }
  };

  const juntas = await insertar(filas);
  if (!juntas.error) {
    return { idEos: juntas.data.find((f) => f.rol === "eos")?.id ?? null, guardadas: juntas.data.length, error: null };
  }

  console.error("WhatsApp: no se pudo guardar el turno; se intenta fila por fila:", juntas.error);

  let idEos: string | null = null;
  let guardadas = 0;
  for (const fila of filas) {
    const una = await insertar([fila]);
    if (una.error) {
      console.error(`WhatsApp: tampoco se pudo guardar el mensaje de ${fila.rol}:`, una.error);
      continue;
    }
    guardadas += una.data.length;
    if (fila.rol === "eos") idEos = una.data[0]?.id ?? null;
  }

  return { idEos, guardadas, error: guardadas === filas.length ? null : juntas.error };
}
