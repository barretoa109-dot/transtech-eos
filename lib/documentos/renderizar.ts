import { normalizarDocumento } from "./especificacion.ts";
import { crearExcelDocumento } from "./excel.ts";
import { crearPdfDocumento } from "./pdf.ts";
import { crearWordDocumento } from "./word.ts";
import { esFormato, nombreDeArchivo, FORMATOS, type FormatoDocumento } from "./guardar.ts";
import { avisoDeCifras, cifrasContradictorias, verificarArchivo } from "./verificar.ts";

/**
 * Dibujar en bytes el documento que EOS ya armó, a partir de la fila
 * guardada en `eos_documentos_generados`.
 *
 * Extraído de `app/api/documentos/[id]/route.ts` para que el envío por
 * WhatsApp use el mismo camino —normalización, chequeo de cifras
 * contradictorias, verificación de integridad— en vez de una segunda copia
 * que se desincroniza el día que una de las tres reglas cambie.
 */

export type RenderizadoDocumento =
  | { ok: true; cuerpo: Buffer; nombre: string; tipo: string; formato: FormatoDocumento }
  | { ok: false; status: number; error: string };

export async function renderizarDocumento(
  especificacionCruda: unknown,
  formatoGuardado: unknown,
  formatoPedidoCrudo: unknown,
): Promise<RenderizadoDocumento> {
  const formato: FormatoDocumento = esFormato(formatoPedidoCrudo)
    ? formatoPedidoCrudo
    : esFormato(formatoGuardado)
      ? formatoGuardado
      : "excel";

  // Se normaliza aunque ya se haya guardado normalizado: la fila es un jsonb
  // y nada impide que la editen desde el panel de la base. El renderizador
  // nunca debería ver algo que no pasó por esta puerta.
  const resultado = normalizarDocumento(especificacionCruda);

  if (!resultado.ok) {
    return {
      ok: false,
      status: 422,
      error: "Este documento quedó dañado y hay que volver a pedirlo.",
    };
  }

  // Antes de dibujarlo: que los números no se contradigan entre sí. Ver el
  // comentario original en la ruta de descarga para el porqué.
  const problemas = cifrasContradictorias(resultado.documento);

  if (problemas.length > 0) {
    return { ok: false, status: 422, error: avisoDeCifras(problemas) };
  }

  let cuerpo: Buffer;
  try {
    cuerpo =
      formato === "excel"
        ? Buffer.from(await crearExcelDocumento(resultado.documento))
        : formato === "pdf"
          ? await crearPdfDocumento(resultado.documento)
          : await crearWordDocumento(resultado.documento);
  } catch (fallo) {
    console.error(`Documentos: falló la generación del ${formato}:`, fallo);
    return { ok: false, status: 500, error: "No pudimos generar el archivo." };
  }

  const integridad = verificarArchivo(formato, cuerpo);

  if (!integridad.ok) {
    console.error(`Documentos: el archivo no se entrega — ${integridad.motivo}`);
    return { ok: false, status: 500, error: "El archivo salió dañado. Volvé a pedirlo." };
  }

  return {
    ok: true,
    cuerpo,
    nombre: nombreDeArchivo(resultado.documento.titulo, formato),
    tipo: FORMATOS[formato].tipo,
    formato,
  };
}
