import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirAlgunModulo } from "@/lib/modulos/acceso";
import { filtroDeEmpresa, miEmpresa } from "@/lib/empresa/acceso";
import { digitoVerificador } from "@/lib/facturacion/cdc";

export const dynamic = "force-dynamic";

/**
 * Editar y dar de baja un cliente o proveedor.
 *
 * Los teléfonos cambian, los nombres se cargan mal y el RUC aparece recién
 * cuando el cliente pide factura. Sin esta ruta, cada corrección era un
 * contacto nuevo, y a la tercera vez el mismo cliente figura tres veces y el
 * historial de ventas queda repartido entre las tres.
 *
 * La puerta acepta CRM **o** ERP, igual que el listado: los contactos son del
 * CRM, pero una venta del ERP necesita un cliente.
 *
 * La baja es lógica (`activo = false`): las ventas viejas apuntan acá y
 * borrarlo dejaría el historial sin nombres.
 */

const COLUMNAS =
  "id,tipo,nombre,ruc,ruc_dv,documento,email,telefono,direccion,ciudad," +
  "es_cliente,es_proveedor,etiquetas,notas,activo,creado_en";

export async function PATCH(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const puerta = await exigirAlgunModulo(["crm", "erp"]);
  if (puerta.respuesta) return puerta.respuesta;

  const { id } = await contexto.params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Contacto no encontrado." }, { status: 404, headers: noStore() });
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  // Sólo se escribe lo que vino: rellenar lo ausente borraría datos intactos.
  const cambios: Record<string, unknown> = {};

  if (cuerpo.nombre !== undefined) {
    const nombre = texto(cuerpo.nombre, 160);

    if (!nombre) {
      return NextResponse.json(
        { error: "El contacto necesita un nombre." },
        { status: 400, headers: noStore() },
      );
    }

    cambios.nombre = nombre;
  }

  /*
   * El RUC se vuelve a validar al editarlo, por la misma razón que al crearlo:
   * un dígito verificador equivocado no se nota hasta que SIFEN rechaza una
   * factura ya entregada. Vaciarlo sí se permite —hay clientes sin RUC— y
   * entonces el dígito se va con él.
   */
  if (cuerpo.ruc !== undefined) {
    const ruc = texto(cuerpo.ruc, 20).replace(/[^\d]/g, "");

    if (!ruc) {
      cambios.ruc = null;
      cambios.ruc_dv = null;
    } else {
      const declarado = Number(cuerpo.ruc_dv);
      const dv =
        Number.isInteger(declarado) && declarado >= 0 && declarado <= 9
          ? declarado
          : digitoVerificador(ruc);

      if (digitoVerificador(ruc) !== dv) {
        return NextResponse.json(
          {
            error: `El RUC ${ruc} no cierra con el dígito ${dv}. Revisalo antes de guardar.`,
            campo: "ruc",
          },
          { status: 400, headers: noStore() },
        );
      }

      cambios.ruc = ruc;
      cambios.ruc_dv = dv;
    }
  }

  if (cuerpo.tipo !== undefined) cambios.tipo = cuerpo.tipo === "empresa" ? "empresa" : "persona";
  if (cuerpo.documento !== undefined) cambios.documento = texto(cuerpo.documento, 40) || null;
  if (cuerpo.email !== undefined) cambios.email = texto(cuerpo.email, 180).toLowerCase() || null;
  if (cuerpo.telefono !== undefined) cambios.telefono = texto(cuerpo.telefono, 40) || null;
  if (cuerpo.direccion !== undefined) cambios.direccion = texto(cuerpo.direccion, 200) || null;
  if (cuerpo.ciudad !== undefined) cambios.ciudad = texto(cuerpo.ciudad, 80) || null;
  if (cuerpo.notas !== undefined) cambios.notas = texto(cuerpo.notas, 2000) || null;
  if (cuerpo.es_cliente !== undefined) cambios.es_cliente = cuerpo.es_cliente === true;
  if (cuerpo.es_proveedor !== undefined) cambios.es_proveedor = cuerpo.es_proveedor === true;
  if (cuerpo.activo !== undefined) cambios.activo = cuerpo.activo === true;

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No hay nada que cambiar." }, { status: 400, headers: noStore() });
  }

  cambios.actualizado_en = new Date().toISOString();

  const supabase = await createClient();

  // Las dos fronteras mientras dure la transición de la v109/v110.
  const empresaId = await miEmpresa(supabase);

  const { data, error } = await supabase
    .from("eos_crm_contactos")
    .update(cambios)
    .eq("id", id)
    .or(filtroDeEmpresa(puerta.usuarioId, empresaId))
    .select(COLUMNAS)
    .maybeSingle();

  if (error) {
    console.error("ERP: no se pudo editar el contacto:", error);
    return NextResponse.json(
      { error: "No pudimos guardar los cambios." },
      { status: 503, headers: noStore() },
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Contacto no encontrado." }, { status: 404, headers: noStore() });
  }

  return NextResponse.json({ contacto: data }, { headers: noStore() });
}

export async function DELETE(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  const puerta = await exigirAlgunModulo(["crm", "erp"]);
  if (puerta.respuesta) return puerta.respuesta;

  const { id } = await contexto.params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Contacto no encontrado." }, { status: 404, headers: noStore() });
  }

  const supabase = await createClient();

  // Las dos fronteras mientras dure la transición de la v109/v110.
  const empresaId = await miEmpresa(supabase);

  const { data, error } = await supabase
    .from("eos_crm_contactos")
    .update({ activo: false, actualizado_en: new Date().toISOString() })
    .eq("id", id)
    .or(filtroDeEmpresa(puerta.usuarioId, empresaId))
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("ERP: no se pudo dar de baja el contacto:", error);
    return NextResponse.json(
      { error: "No pudimos dar de baja el contacto." },
      { status: 503, headers: noStore() },
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Contacto no encontrado." }, { status: 404, headers: noStore() });
  }

  return NextResponse.json({ ok: true, id: data.id }, { headers: noStore() });
}

function texto(valor: unknown, largo: number) {
  return String(valor ?? "").trim().slice(0, largo);
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
