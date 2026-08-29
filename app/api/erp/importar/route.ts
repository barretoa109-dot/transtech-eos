import { NextResponse } from "next/server";
import ExcelJS from "exceljs";

import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { filasAProductos, repetidos } from "@/lib/erp/importar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Traer el catálogo desde la planilla que la persona ya tiene.
 *
 * ============================================================
 * DOS PASOS, Y EL PRIMERO NO ESCRIBE NADA
 * ============================================================
 *
 * Sin `confirmar`, lee la planilla y devuelve lo que entendió: qué columna
 * tomó para cada cosa, qué productos salieron y qué filas no pudo leer. No
 * toca la base.
 *
 * Con `confirmar`, recién ahí escribe.
 *
 * Importar 400 productos a ciegas es cómo alguien destruye su catálogo en un
 * clic. Y la parte que más se equivoca no es el precio sino la COLUMNA: si la
 * planilla trae costo y precio, y se toma la equivocada, todo el catálogo queda
 * vendiéndose a pérdida sin que nadie lo note hasta cerrar el mes. Por eso lo
 * primero que se devuelve es qué columna se usó para qué.
 *
 * ============================================================
 * LA MISMA PLANILLA SE MANDA DOS VECES
 * ============================================================
 *
 * Una para ver y otra para confirmar. Podría guardarse entre medio, pero eso
 * es guardar el archivo de alguien en un servidor para ahorrarle una subida de
 * dos segundos. No vale el intercambio.
 */

/* Un catálogo más grande que esto es un caso que merece una conversación. */
const MAX_FILAS = 2000;
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  let formulario: FormData;

  try {
    formulario = await request.formData();
  } catch {
    return NextResponse.json({ error: "No pudimos leer el archivo." }, { status: 400, headers: noStore() });
  }

  const archivo = formulario.get("archivo");
  const confirmar = String(formulario.get("confirmar") ?? "") === "1";

  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: "Adjuntá tu planilla." }, { status: 400, headers: noStore() });
  }

  if (archivo.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "La planilla es muy grande. El límite es 5 MB." },
      { status: 400, headers: noStore() },
    );
  }

  // ---------- Leer la planilla ----------
  let encabezados: unknown[] = [];
  const filas: unknown[][] = [];

  try {
    const libro = new ExcelJS.Workbook();
    const buffer = await archivo.arrayBuffer();

    /*
     * Se acepta CSV además de xlsx porque mucha gente exporta así desde su
     * sistema viejo, y decirle "convertilo a Excel primero" es devolverle el
     * trabajo que vino a evitar.
     */
    if (/\.csv$/i.test(archivo.name)) {
      const texto = new TextDecoder("utf-8").decode(buffer);
      const lineas = texto.split(/\r?\n/).filter((l) => l.trim());

      // Coma o punto y coma: Excel en español exporta con punto y coma.
      const separador = (lineas[0]?.match(/;/g)?.length ?? 0) > (lineas[0]?.match(/,/g)?.length ?? 0) ? ";" : ",";

      const partir = (linea: string) =>
        linea.split(separador).map((c) => c.trim().replace(/^"|"$/g, ""));

      encabezados = partir(lineas[0] ?? "");

      for (const linea of lineas.slice(1, MAX_FILAS + 1)) filas.push(partir(linea));
    } else {
      await libro.xlsx.load(buffer);

      const hoja = libro.worksheets[0];

      if (!hoja) {
        return NextResponse.json(
          { error: "La planilla no tiene ninguna hoja." },
          { status: 400, headers: noStore() },
        );
      }

      hoja.eachRow((fila, numero) => {
        if (numero > MAX_FILAS + 1) return;

        // `values` viene con un hueco en la posición 0: exceljs cuenta desde 1.
        const valores = (fila.values as unknown[]).slice(1);

        if (numero === 1) encabezados = valores;
        else filas.push(valores);
      });
    }
  } catch (error) {
    console.error("ERP: no se pudo leer la planilla:", error);

    return NextResponse.json(
      { error: "No pudimos leer el archivo. ¿Es una planilla de Excel o un CSV?" },
      { status: 400, headers: noStore() },
    );
  }

  const { productos, problemas, columnas } = filasAProductos(encabezados, filas);

  /*
   * Qué columna se usó para qué, en castellano. Es lo primero que hay que
   * mirar: un error acá se multiplica por todo el catálogo.
   */
  const interpretacion = Object.entries(columnas).map(([campo, indice]) => ({
    campo,
    columna: indice === null ? null : String(encabezados[indice] ?? `columna ${indice + 1}`),
  }));

  if (!confirmar) {
    return NextResponse.json(
      {
        vista_previa: true,
        interpretacion,
        cuantos: productos.length,
        // Unos pocos alcanzan para darse cuenta si algo se leyó al revés.
        muestra: productos.slice(0, 10),
        problemas: problemas.slice(0, 50),
        repetidos: repetidos(productos),
      },
      { headers: noStore() },
    );
  }

  if (productos.length === 0) {
    return NextResponse.json(
      { error: "No hay ningún producto que importar." },
      { status: 400, headers: noStore() },
    );
  }

  // ---------- Escribir ----------
  const supabase = await createClient();

  const filasAInsertar = productos.map((p) => ({
    usuario_id: puerta.usuarioId,
    nombre: p.nombre,
    codigo: p.codigo,
    precio_venta: p.precio_venta,
    costo: p.costo,
    iva: p.iva,
    unidad: p.unidad,
    controla_stock: p.controla_stock,
    stock_actual: p.controla_stock ? p.stock_actual : 0,
    stock_minimo: 0,
  }));

  const { data, error } = await supabase
    .from("eos_erp_productos")
    .insert(filasAInsertar)
    .select("id");

  if (error) {
    /*
     * El código de producto es único por usuario. Que una importación se caiga
     * entera por un código repetido es correcto: importar la mitad deja un
     * catálogo a medias y nadie sabe cuál mitad.
     */
    if (String(error.code) === "23505") {
      return NextResponse.json(
        {
          error:
            "Tu planilla repite un código de producto, o ya tenés uno cargado con ese código. " +
            "No se importó nada.",
        },
        { status: 409, headers: noStore() },
      );
    }

    console.error("ERP: no se pudo importar el catálogo:", error);

    return NextResponse.json(
      { error: "No pudimos importar la planilla." },
      { status: 503, headers: noStore() },
    );
  }

  return NextResponse.json(
    { ok: true, importados: data?.length ?? 0, problemas: problemas.slice(0, 50) },
    { headers: noStore() },
  );
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
