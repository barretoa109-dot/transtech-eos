/**
 * Corpus de categorización: ¿el dinero entra, sale, o todavía no se movió?
 *
 * Este es el eval que la hoja de ruta pide con nombre y apellido: "que un error
 * de categorización no rompa la confianza en silencio". Equivocar la dirección
 * de un movimiento de ₲2.000.000 no produce un error de ₲2.000.000 sino de
 * ₲4.000.000, porque el importe se resta en vez de sumarse.
 *
 * Las frases salen del lenguaje real de comprobantes, facturas y extractos
 * paraguayos, no de un diccionario.
 */

import { inferirTipo } from "../../lib/finanzas/extraerMovimientos.ts";
import type { Caso, Suite } from "../tipos.ts";

type Tipo = "ingreso" | "gasto" | "compromiso";

function caso(
  frase: string,
  tipo: Tipo,
  severidad: Caso["severidad"],
  porque: string,
): Caso {
  return {
    nombre: frase,
    severidad,
    porque,
    evaluar: () => {
      const obtenido = inferirTipo(frase);
      return {
        ok: obtenido.tipo === tipo,
        esperado: tipo,
        obtenido: `${obtenido.tipo} (confianza ${obtenido.confianza})`,
      };
    },
  };
}

/** Caso sobre la confianza, no sobre la dirección. */
function casoConfianza(
  frase: string,
  rango: { min?: number; max?: number },
  severidad: Caso["severidad"],
  porque: string,
): Caso {
  const descripcion = `confianza ${rango.min ?? 0}–${rango.max ?? 1}`;
  return {
    nombre: `${frase}  ·  ${descripcion}`,
    severidad,
    porque,
    evaluar: () => {
      const { confianza } = inferirTipo(frase);
      return {
        ok: confianza >= (rango.min ?? 0) && confianza <= (rango.max ?? 1),
        esperado: descripcion,
        obtenido: `confianza ${confianza}`,
      };
    },
  };
}

export const categorizacion: Suite = {
  nombre: "categorización",
  descripcion: "Dirección del dinero inferida del texto de un comprobante.",
  casos: [
    // ---------------------------------------------------------------
    // Dinero entrando. Un error acá resta plata que el usuario SÍ tiene.
    // ---------------------------------------------------------------
    caso(
      "Pago recibido del cliente Juan por Gs. 2.000.000",
      "ingreso",
      "critico",
      "El caso que rompe todo: 'pago' y 'recibido' empatan, y el empate cae a gasto. Un cobro se descuenta.",
    ),
    caso(
      "Transferencia recibida SPI",
      "ingreso",
      "critico",
      "Formato literal del aviso del Banco GNB, la única fuente de ingesta automática que hoy funciona.",
    ),
    caso(
      "Depósito de salario de agosto",
      "ingreso",
      "critico",
      "El ingreso más importante del usuario promedio.",
    ),
    caso(
      "Acreditación de transferencia en tu cuenta",
      "ingreso",
      "critico",
      "Lenguaje bancario estándar de PY para plata entrando.",
    ),
    caso(
      "Cobro a cliente por servicio de instalación",
      "ingreso",
      "critico",
      "Facturación de PYME: el caso de uso central del producto.",
    ),
    caso(
      "Venta del día en el local",
      "ingreso",
      "critico",
      "Comerciante que registra el cierre de caja.",
    ),
    caso(
      "Honorarios recibidos por consultoría",
      "ingreso",
      "critico",
      "Ingreso típico del profesional independiente.",
    ),
    caso(
      "Abono recibido en cuenta",
      "ingreso",
      "critico",
      "'Abono' compite con 'pago' en el mismo texto en muchos comprobantes.",
    ),
    caso(
      "Facturado al cliente en agosto",
      "ingreso",
      "deseable",
      "Facturado no siempre es cobrado, pero para el panel cuenta como ingreso previsto.",
    ),

    // ---------------------------------------------------------------
    // Dinero saliendo.
    // ---------------------------------------------------------------
    caso(
      "Pago al proveedor de mercadería",
      "gasto",
      "critico",
      "El gasto más frecuente de un comercio.",
    ),
    caso("Compra en el supermercado", "gasto", "critico", "Gasto cotidiano."),
    caso(
      "Débito automático del seguro",
      "gasto",
      "critico",
      "Débito automático: sale sin que el usuario lo mire, que es justo lo que EOS debe vigilar.",
    ),
    caso(
      "Retiro de efectivo del cajero",
      "gasto",
      "critico",
      "El efectivo es el punto ciego declarado del sistema; al menos el retiro tiene que verse.",
    ),
    caso("Alquiler de agosto", "gasto", "critico", "Gasto fijo más grande del comerciante típico."),
    caso(
      "Pago de impuesto a la SET",
      "gasto",
      "critico",
      "Obligación tributaria paraguaya; la fase 4 de la hoja de ruta se apoya en reconocerla.",
    ),
    caso(
      "Cobro de comisión del banco",
      "gasto",
      "critico",
      "Trampa de idioma: en PY 'cobro' es tanto lo que yo cobro como lo que me cobran. Acá me lo cobran.",
    ),
    caso(
      "Comisión bancaria debitada de la cuenta",
      "gasto",
      "deseable",
      "'Debitada' no está en el diccionario de gastos; se sostiene solo por 'comisión'.",
    ),

    // ---------------------------------------------------------------
    // Compromisos: plata que todavía no se movió pero ya está comprometida.
    // ---------------------------------------------------------------
    caso(
      "Factura del proveedor, vence el 30",
      "compromiso",
      "critico",
      "Un vencimiento futuro se descuenta del disponible real aunque no haya ocurrido.",
    ),
    caso(
      "Cuota 3 de 12 del préstamo",
      "compromiso",
      "critico",
      "Las cuotas son el corazón del endeudamiento de PYMES en PY.",
    ),
    caso(
      "Saldo pendiente a pagar el próximo mes",
      "compromiso",
      "critico",
      "Deuda declarada explícitamente como futura.",
    ),
    caso(
      "Financiación en 6 cuotas sin interés",
      "compromiso",
      "deseable",
      "Compra financiada: el gasto real son las cuotas futuras, no el importe de hoy.",
    ),

    // ---------------------------------------------------------------
    // Confianza: gobierna qué se aplica solo y qué se marca para revisar.
    // ---------------------------------------------------------------
    casoConfianza(
      "Compra en el supermercado",
      { min: 0.7 },
      "deseable",
      "Evidencia clara de una sola palabra.",
    ),
    casoConfianza(
      "Compras del mes en el supermercado",
      { max: 0.75 },
      "critico",
      "MISMA evidencia que el caso anterior, solo en plural. Si la confianza sube, depende de la gramática y no de la prueba.",
    ),
    casoConfianza(
      "Movimiento por Gs. 300.000",
      { max: 0.5 },
      "critico",
      "Sin ninguna señal de dirección, EOS tiene que declararse inseguro en vez de adivinar con cara de certeza.",
    ),
  ],
};
