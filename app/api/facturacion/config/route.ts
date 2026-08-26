import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { digitoVerificador } from "@/lib/facturacion/cdc";

export const dynamic = "force-dynamic";

/**
 * Los datos con los que el usuario factura.
 *
 * El certificado digital NO pasa por acá y no tiene que pasar nunca: un .p12 en
 * una fila de base de datos es la llave con la que se puede facturar a nombre
 * de otro. Lo único que se guarda es el NOMBRE del secreto donde vive, y ni
 * siquiera eso lo escribe el usuario desde esta ruta.
 */

const COLUMNAS =
  "ruc,ruc_dv,razon_social,nombre_fantasia,tipo_contribuyente,timbrado_numero," +
  "timbrado_inicio,timbrado_fin,establecimiento,punto_expedicion,actividad_economica," +
  "actividad_descripcion,direccion,numero_casa,telefono,email,ambiente";

export async function GET() {
  const puerta = await exigirModulo("facturacion");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("eos_fe_config")
    .select(COLUMNAS)
    .eq("usuario_id", puerta.usuarioId)
    .maybeSingle();

  if (error) {
    console.error("FE: no se pudo leer la configuración:", error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  return NextResponse.json({ configurado: Boolean(data), config: data ?? null }, { headers: noStore() });
}

export async function PUT(request: Request) {
  const puerta = await exigirModulo("facturacion");
  if (puerta.respuesta) return puerta.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const ruc = texto(cuerpo.ruc, 20).replace(/\D/g, "");
  const razonSocial = texto(cuerpo.razon_social, 200);

  if (!ruc || !razonSocial) {
    return NextResponse.json(
      { error: "El RUC y la razón social son obligatorios para facturar." },
      { status: 400, headers: noStore() },
    );
  }

  /*
   * El dígito verificador se valida acá y no al emitir.
   *
   * Va adentro del CDC de TODAS las facturas: si está mal, no falla una, falla
   * la numeración entera y hay que anularlas de a una. Es el chequeo más barato
   * del módulo y el que más problemas evita.
   */
  const dvDeclarado = Number(cuerpo.ruc_dv);
  const dv = Number.isInteger(dvDeclarado) ? dvDeclarado : digitoVerificador(ruc);

  if (digitoVerificador(ruc) !== dv) {
    return NextResponse.json(
      { error: `El RUC ${ruc} no cierra con el dígito ${dv}.`, campo: "ruc" },
      { status: 400, headers: noStore() },
    );
  }

  const tresDigitos = (valor: unknown, defecto: string) => {
    const limpio = texto(valor, 3).replace(/\D/g, "");
    return limpio.length === 3 ? limpio : defecto;
  };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("eos_fe_config")
    .upsert(
      {
        usuario_id: puerta.usuarioId,
        ruc,
        ruc_dv: dv,
        razon_social: razonSocial,
        nombre_fantasia: texto(cuerpo.nombre_fantasia, 200) || null,
        tipo_contribuyente: cuerpo.tipo_contribuyente === 2 ? 2 : 1,
        timbrado_numero: texto(cuerpo.timbrado_numero, 20) || null,
        timbrado_inicio: fecha(cuerpo.timbrado_inicio),
        timbrado_fin: fecha(cuerpo.timbrado_fin),
        establecimiento: tresDigitos(cuerpo.establecimiento, "001"),
        punto_expedicion: tresDigitos(cuerpo.punto_expedicion, "001"),
        actividad_economica: texto(cuerpo.actividad_economica, 20) || null,
        actividad_descripcion: texto(cuerpo.actividad_descripcion, 300) || null,
        direccion: texto(cuerpo.direccion, 300) || null,
        numero_casa: texto(cuerpo.numero_casa, 20) || null,
        telefono: texto(cuerpo.telefono, 40) || null,
        email: texto(cuerpo.email, 180).toLowerCase() || null,
        // El ambiente NO se cambia desde acá. Pasar a producción es una decisión
        // que se toma una vez, con la habilitación de la SET en la mano, y no
        // algo que se marque en un formulario mientras se prueba.
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: "usuario_id" },
    )
    .select(COLUMNAS)
    .single();

  if (error) {
    console.error("FE: no se pudo guardar la configuración:", error);
    return NextResponse.json(
      { error: "No pudimos guardar los datos de facturación." },
      { status: 503, headers: noStore() },
    );
  }

  return NextResponse.json({ configurado: true, config: data }, { headers: noStore() });
}

function texto(valor: unknown, tope: number): string {
  return String(valor ?? "").trim().slice(0, tope);
}

function fecha(valor: unknown): string | null {
  const limpio = String(valor ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(limpio) ? limpio : null;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
