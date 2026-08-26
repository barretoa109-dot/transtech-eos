import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirAlgunModulo } from "@/lib/modulos/acceso";
import { digitoVerificador } from "@/lib/facturacion/cdc";

export const dynamic = "force-dynamic";

/**
 * Clientes y proveedores.
 *
 * Una sola lista para los dos, porque en una PYME paraguaya la misma persona te
 * compra y te vende. Ver el comentario de la migración v67.
 *
 * La puerta acepta CRM **o** ERP: los contactos son del CRM, pero una venta del
 * ERP necesita un cliente, y obligar a contratar los dos para que uno funcione
 * es exactamente lo que el plan armable vino a eliminar.
 */

const COLUMNAS =
  "id,tipo,nombre,ruc,ruc_dv,documento,email,telefono,direccion,ciudad," +
  "es_cliente,es_proveedor,etiquetas,notas,activo,creado_en";

/** Tope de la lista: una PYME no tiene cien mil clientes, y si los tiene busca. */
const MAX_FILAS = 500;

export async function GET(request: Request) {
  const puerta = await exigirAlgunModulo(["crm", "erp"]);
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const { searchParams } = new URL(request.url);

  const busqueda = (searchParams.get("busca") ?? "").trim().slice(0, 80);
  const rol = searchParams.get("rol");

  let consulta = supabase
    .from("eos_crm_contactos")
    .select(COLUMNAS)
    .eq("usuario_id", puerta.usuarioId)
    .eq("activo", true)
    .order("nombre", { ascending: true })
    .limit(MAX_FILAS);

  if (rol === "cliente") consulta = consulta.eq("es_cliente", true);
  if (rol === "proveedor") consulta = consulta.eq("es_proveedor", true);

  // `ilike` y no búsqueda de texto completo: con quinientas filas la diferencia
  // no existe, y un índice de texto sobre nombres propios acierta menos que un
  // "contiene" cuando alguien escribe medio apellido.
  if (busqueda) consulta = consulta.ilike("nombre", `%${busqueda}%`);

  const { data, error } = await consulta;

  if (error) {
    console.error("ERP: no se pudieron leer los contactos:", error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  return NextResponse.json({ contactos: data ?? [] }, { headers: noStore() });
}

export async function POST(request: Request) {
  const puerta = await exigirAlgunModulo(["crm", "erp"]);
  if (puerta.respuesta) return puerta.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const nombre = texto(cuerpo.nombre, 160);
  if (!nombre) {
    return NextResponse.json(
      { error: "El contacto necesita un nombre." },
      { status: 400, headers: noStore() },
    );
  }

  /*
   * El RUC se valida ACÁ, al cargarlo, y no al facturar.
   *
   * Un RUC con el dígito verificador equivocado no rompe nada hasta el día en
   * que se emite una factura a ese cliente: ahí SIFEN la rechaza, el
   * comprobante ya se entregó y hay que rehacer todo. Avisarlo mientras se
   * carga el contacto cuesta una línea y evita esa cadena entera.
   */
  const ruc = texto(cuerpo.ruc, 20).replace(/[^\d]/g, "");
  let rucDv: number | null = null;

  if (ruc) {
    const declarado = Number(cuerpo.ruc_dv);
    rucDv = Number.isInteger(declarado) && declarado >= 0 && declarado <= 9
      ? declarado
      : digitoVerificador(ruc);

    if (digitoVerificador(ruc) !== rucDv) {
      return NextResponse.json(
        {
          error: `El RUC ${ruc} no cierra con el dígito ${rucDv}. Revisalo antes de guardar.`,
          campo: "ruc",
        },
        { status: 400, headers: noStore() },
      );
    }
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("eos_crm_contactos")
    .insert({
      usuario_id: puerta.usuarioId,
      tipo: cuerpo.tipo === "empresa" ? "empresa" : "persona",
      nombre,
      ruc: ruc || null,
      ruc_dv: rucDv,
      documento: texto(cuerpo.documento, 40) || null,
      email: texto(cuerpo.email, 180).toLowerCase() || null,
      telefono: texto(cuerpo.telefono, 40) || null,
      direccion: texto(cuerpo.direccion, 200) || null,
      ciudad: texto(cuerpo.ciudad, 80) || null,
      es_cliente: cuerpo.es_cliente !== false,
      es_proveedor: cuerpo.es_proveedor === true,
      notas: texto(cuerpo.notas, 2000) || null,
    })
    .select(COLUMNAS)
    .single();

  if (error) {
    console.error("ERP: no se pudo guardar el contacto:", error);
    return NextResponse.json(
      { error: "No pudimos guardar el contacto." },
      { status: 503, headers: noStore() },
    );
  }

  return NextResponse.json({ contacto: data }, { status: 201, headers: noStore() });
}

function texto(valor: unknown, tope: number): string {
  return String(valor ?? "").trim().slice(0, tope);
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
