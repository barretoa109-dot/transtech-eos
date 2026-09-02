import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { registrarAuditoria } from "@/lib/auditoria/registrar";
import { monedaConocida } from "@/lib/finanzas/monedas";

export const dynamic = "force-dynamic";

/**
 * Corregir o borrar un movimiento que se cargó a mano.
 *
 * Sólo los que escribió una persona. Un gasto que nació de una compra es el
 * reflejo de un documento: borrarlo acá dejaría la compra apuntando a una
 * plata que no existe, y corregirle el monto haría que el panel y el documento
 * digan dos cosas distintas de lo mismo. Para eso está la pantalla de Negocio,
 * que corrige la compra y su gasto en la misma transacción.
 *
 * Lo mismo con los que llegaron del correo del banco o de un documento: ésos
 * tienen su propio camino de conciliación, donde se los acepta o se los
 * descarta contra su evidencia.
 */

const A_MANO = new Set(["manual", "chat"]);

const RECHAZO: Record<string, string> = {
  erp: "Este movimiento salió de una venta o una compra. Corregilo desde Negocio y el gasto se ajusta solo.",
  correo: "Este movimiento llegó del correo de tu banco. Revisalo en el buzón de finanzas.",
  documento: "Este movimiento salió de un documento que subiste. Revisalo en el buzón de finanzas.",
};

async function propio(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: respuesta("Sesión no válida.", 401) };

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return { error: respuesta("Movimiento no encontrado.", 404) };
  }

  const { data, error } = await supabase
    .from("eos_movimientos_financieros")
    .select("id,tipo,monto,moneda,descripcion,fecha,origen")
    .eq("id", id)
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Finanzas: no se pudo leer el movimiento:", error);
    return { error: respuesta("No pudimos leer el movimiento.", 503) };
  }

  if (!data) return { error: respuesta("Movimiento no encontrado.", 404) };

  const origen = String(data.origen ?? "");
  if (!A_MANO.has(origen)) {
    return {
      error: respuesta(
        RECHAZO[origen] ?? "Este movimiento no se puede editar desde acá.",
        409,
      ),
    };
  }

  return { user, supabase, movimiento: data };
}

export async function PATCH(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const { id } = await contexto.params;
  const puerta = await propio(id);
  if (puerta.error) return puerta.error;

  const cuerpo = await request.json().catch(() => null);
  const cambios: Record<string, unknown> = {};

  if (cuerpo?.tipo !== undefined) {
    if (cuerpo.tipo !== "ingreso" && cuerpo.tipo !== "gasto") {
      return respuesta("El movimiento tiene que ser un ingreso o un gasto.", 400);
    }
    cambios.tipo = cuerpo.tipo;
  }

  if (cuerpo?.monto !== undefined) {
    const monto = Number(cuerpo.monto);
    // Cero no: un movimiento de cero no es un movimiento. Si se cargó de más,
    // se borra.
    if (!Number.isFinite(monto) || monto <= 0) {
      return respuesta("El monto tiene que ser mayor a cero.", 400);
    }
    cambios.monto = monto;
  }

  if (cuerpo?.descripcion !== undefined) {
    const texto = String(cuerpo.descripcion ?? "").trim().slice(0, 200);
    if (!texto) return respuesta("Escribí en qué fue.", 400);
    cambios.descripcion = texto;
  }

  if (cuerpo?.fecha !== undefined) {
    const fecha = String(cuerpo.fecha ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return respuesta("La fecha no es válida.", 400);
    cambios.fecha = fecha;
  }

  if (cuerpo?.moneda !== undefined) cambios.moneda = monedaConocida(cuerpo.moneda);

  /*
   * La categoría es lo único que se escribe explícitamente.
   *
   * El resto del sistema la infiere de la descripción y no le pide a nadie que
   * etiquete — eso es trabajo que EOS existe para no delegar. Pero cuando la
   * inferencia se equivoca, la persona tiene que poder decir cuál era, y esa
   * corrección manda sobre la inferencia.
   */
  if (cuerpo?.categoria !== undefined) {
    const clave = String(cuerpo.categoria ?? "").trim().slice(0, 40);
    cambios.categoria = clave || null;
  }

  if (Object.keys(cambios).length === 0) {
    return respuesta("No hay nada que cambiar.", 400);
  }

  cambios.updated_at = new Date().toISOString();

  const { data, error } = await puerta.supabase
    .from("eos_movimientos_financieros")
    .update(cambios)
    .eq("id", id)
    .eq("usuario_id", puerta.user.id)
    .select("id,tipo,monto,moneda,descripcion,categoria,fecha,origen")
    .single();

  if (error) {
    console.error("Finanzas: no se pudo corregir el movimiento:", error);
    return respuesta("No pudimos guardar el cambio.", 503);
  }

  await registrarAuditoria(createAdminClient() as never, {
    usuarioId: puerta.user.id,
    evento: "movimiento_confirmado",
    origen: "panel",
    resumen: `Movimiento corregido: ${data.descripcion}`,
    referencia: id,
    detalle: {
      antes: {
        tipo: puerta.movimiento.tipo,
        monto: Number(puerta.movimiento.monto ?? 0),
        fecha: puerta.movimiento.fecha,
      },
      despues: { tipo: data.tipo, monto: Number(data.monto ?? 0), fecha: data.fecha },
    },
  });

  return NextResponse.json(data, { headers: noStore() });
}

export async function DELETE(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  const { id } = await contexto.params;
  const puerta = await propio(id);
  if (puerta.error) return puerta.error;

  const { error } = await puerta.supabase
    .from("eos_movimientos_financieros")
    .delete()
    .eq("id", id)
    .eq("usuario_id", puerta.user.id);

  if (error) {
    console.error("Finanzas: no se pudo borrar el movimiento:", error);
    return respuesta("No pudimos borrarlo.", 503);
  }

  /*
   * El borrado se asienta con lo que decía la fila.
   *
   * La bitácora es lo único que queda de un movimiento borrado, así que si no
   * guarda el monto y la descripción acá, no queda en ningún lado: seis meses
   * después nadie puede explicar por qué el total de marzo cambió.
   */
  await registrarAuditoria(createAdminClient() as never, {
    usuarioId: puerta.user.id,
    evento: "movimiento_descartado",
    origen: "panel",
    resumen: `Movimiento borrado: ${puerta.movimiento.descripcion ?? "sin detalle"}`,
    referencia: id,
    detalle: {
      tipo: puerta.movimiento.tipo,
      monto: Number(puerta.movimiento.monto ?? 0),
      moneda: puerta.movimiento.moneda,
      fecha: puerta.movimiento.fecha,
    },
  });

  return NextResponse.json({ borrado: true }, { headers: noStore() });
}

function respuesta(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
