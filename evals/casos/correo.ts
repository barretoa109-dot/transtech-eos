/**
 * Corpus de avisos bancarios por correo.
 *
 * Este es el único camino de ingesta automática que hoy está vivo en
 * producción: lo que pasa este filtro se escribe solo en
 * `eos_movimientos_financieros` y afecta el disponible real sin que nadie lo
 * mire. Es la superficie de mayor riesgo del sistema entero.
 *
 * Los dos casos que ya mordieron en la vida real están acá abajo, marcados.
 */

import {
  extraerDeCorreo,
  CONFIANZA_MINIMA_CORREO,
  type CorreoEntrante,
} from "../../lib/finanzas/extraerDeCorreo.ts";
import type { Caso, Suite } from "../tipos.ts";

type Esperado =
  | { nada: true }
  | {
      nada?: false;
      tipo: "ingreso" | "gasto";
      /** Omitirlo significa "no importa cuál": ver el caso del resumen mensual. */
      monto?: number;
      moneda?: "PYG" | "USD";
      fecha?: string;
      /** Si es `true`, además tiene que superar el umbral de guardado. */
      seGuarda?: boolean;
    };

function describirEsperado(e: Esperado): string {
  if ("nada" in e && e.nada) return "no extrae nada";
  const partes = [`${e.tipo} ${e.moneda ?? "PYG"} ${e.monto ?? "(cualquiera)"}`];
  if (e.fecha) partes.push(e.fecha);
  if (e.seGuarda === true) partes.push(`se guarda (≥${CONFIANZA_MINIMA_CORREO})`);
  if (e.seGuarda === false) partes.push(`NO se guarda (<${CONFIANZA_MINIMA_CORREO})`);
  return partes.join(" · ");
}

function caso(
  nombre: string,
  correo: Partial<CorreoEntrante> & { texto: string },
  esperado: Esperado,
  severidad: Caso["severidad"],
  porque: string,
): Caso {
  return {
    nombre,
    severidad,
    porque,
    evaluar: () => {
      const salida = extraerDeCorreo({
        asunto: correo.asunto ?? null,
        texto: correo.texto,
        html: correo.html ?? null,
        remitente: correo.remitente ?? "avisos@banco.com.py",
        recibidoEn: correo.recibidoEn ?? "2026-08-23",
      });

      if ("nada" in esperado && esperado.nada) {
        return {
          ok: salida.length === 0,
          esperado: describirEsperado(esperado),
          obtenido:
            salida.length === 0
              ? "no extrae nada"
              : salida.map((m) => `${m.tipo} ${m.moneda} ${m.monto} (conf ${m.confianza})`).join(", "),
        };
      }

      const m = salida[0];
      if (!m) {
        return { ok: false, esperado: describirEsperado(esperado), obtenido: "no extrajo nada" };
      }

      const ok =
        m.tipo === esperado.tipo &&
        (esperado.monto === undefined || m.monto === esperado.monto) &&
        m.moneda === (esperado.moneda ?? "PYG") &&
        (esperado.fecha === undefined || m.fecha === esperado.fecha) &&
        (esperado.seGuarda === undefined ||
          (m.confianza >= CONFIANZA_MINIMA_CORREO) === esperado.seGuarda);

      return {
        ok,
        esperado: describirEsperado(esperado),
        obtenido: `${m.tipo} ${m.moneda} ${m.monto} · ${m.fecha} · conf ${m.confianza}${
          m.confianza >= CONFIANZA_MINIMA_CORREO ? " (se guarda)" : " (NO se guarda)"
        }`,
      };
    },
  };
}

export const correo: Suite = {
  nombre: "correo bancario",
  descripcion: "Avisos que se convierten solos en movimientos, sin que nadie los revise.",
  casos: [
    // ---------------------------------------------------------------
    // El aviso real que ya entró a producción.
    // ---------------------------------------------------------------
    caso(
      "Banco GNB · Transferencias Recibidas SPI",
      {
        asunto: "Transferencias Recibidas SPI",
        remitente: "Transferencias@bancognb.com.py",
        texto:
          "Estimado cliente, le informamos que se acreditó en su cuenta una transferencia SPI por PYG 50.000 el 20/08/2026. Comprobante 123456789.",
      },
      { tipo: "ingreso", monto: 50_000, fecha: "2026-08-20", seGuarda: true },
      "critico",
      "Es el correo textual que produjo el primer movimiento automático real del sistema.",
    ),
    caso(
      "GNB reenviado por el usuario",
      {
        asunto: "Fwd: Transferencias Recibidas SPI",
        texto:
          "---------- Mensaje reenviado ----------\nSubject: Transferencias Recibidas SPI\nEstimado cliente, se acreditó en su cuenta PYG 50.000 el 20/08/2026.",
      },
      { tipo: "ingreso", monto: 50_000, fecha: "2026-08-20", seGuarda: true },
      "critico",
      "El caso normal es un reenvío. Si el prefijo Fwd cambia la descripción, el mismo aviso genera dos series recurrentes distintas.",
    ),

    // ---------------------------------------------------------------
    // Publicidad. Las dos trampas que ya fallaron de verdad.
    // ---------------------------------------------------------------
    caso(
      "Promo de notebook en cuotas",
      {
        asunto: "¡Renová tu equipo!",
        texto:
          "Llevate tu notebook desde Gs. 2.500.000 en 12 cuotas sin interés con tu tarjeta. Aprovechá esta promoción.",
      },
      { nada: true },
      "critico",
      "FALLA REAL: entraba como gasto de ₲2.500.000 con confianza 0,95 y le descontaba al usuario plata que nunca gastó.",
    ),
    caso(
      "Promo de referidos con depósito",
      {
        asunto: "Invitá a un amigo",
        texto:
          "Te informamos que si invitás a un amigo hacemos un depósito de Gs. 500.000 en tu cuenta. Aprovechá este beneficio.",
        // Sin "cuotas" ni "desde": este es el que ejercita la lista de
        // palabras promocionales de verdad.
      },
      { nada: true },
      "critico",
      "Tiene marca transaccional ('te informamos', 'tu cuenta') y dirección ('depósito'). Solo la lista de publicidad lo detiene.",
    ),

    // ---------------------------------------------------------------
    // Avisos de dinero saliendo.
    // ---------------------------------------------------------------
    caso(
      "Compra con tarjeta",
      {
        asunto: "Consumo con tarjeta",
        texto:
          "Le informamos que se registró un consumo con su tarjeta por PYG 350.000 el 22/08/2026 en SUPERMERCADO.",
      },
      { tipo: "gasto", monto: 350_000, fecha: "2026-08-22", seGuarda: true },
      "critico",
      "Gasto automático típico; si no entra, el disponible real queda inflado.",
    ),
    caso(
      "Débito por servicio",
      {
        asunto: "Débito automático",
        texto: "Se debitó de su cuenta PYG 180.000 correspondiente al servicio contratado.",
      },
      { tipo: "gasto", monto: 180_000, seGuarda: true },
      "critico",
      "Débito automático: sale sin intervención del usuario, que es lo que EOS existe para vigilar.",
    ),

    // ---------------------------------------------------------------
    // Saldos: el número más grande del correo NO es la transacción.
    // ---------------------------------------------------------------
    caso(
      "Acreditación seguida del saldo",
      {
        asunto: "Acreditación en cuenta",
        texto:
          "Le informamos que se acreditó en su cuenta PYG 500.000. Su saldo disponible es PYG 4.200.000.",
      },
      { tipo: "ingreso", monto: 500_000 },
      "critico",
      "El saldo aparece en casi todos los avisos. Tomarlo como el movimiento multiplica el ingreso por ocho.",
    ),
    caso(
      "Saldo mencionado ANTES que el movimiento",
      {
        asunto: "Acreditación en cuenta",
        texto:
          "Su saldo disponible es PYG 4.200.000 luego de la acreditación de PYG 500.000 registrada hoy.",
      },
      { tipo: "ingreso", monto: 500_000 },
      "critico",
      "Mismo aviso con las frases al revés. Si la respuesta depende del orden, la protección era casualidad.",
    ),
    caso(
      "Aviso de saldo, sin ningún movimiento",
      {
        asunto: "Tu saldo de hoy",
        texto: "Su saldo disponible al día de hoy es PYG 4.200.000.",
      },
      { nada: true },
      "critico",
      "Un saldo no es un movimiento. Guardarlo como ingreso duplicaría toda la plata del usuario.",
    ),

    // ---------------------------------------------------------------
    // Ambigüedad: mejor perderse un movimiento que inventar uno.
    // ---------------------------------------------------------------
    caso(
      "Resumen mensual con muchos importes",
      {
        asunto: "Resumen de cuenta",
        texto:
          "Le informamos el detalle de su cuenta: PYG 120.000, PYG 340.000, PYG 90.000 y PYG 1.200.000 en operaciones del mes. Se debitó el total.",
      },
      { tipo: "gasto", seGuarda: false },
      "critico",
      "Cuatro importes: EOS no puede saber cuál es el movimiento. No se exige cuál elige —sería fijar comportamiento indefinido—; se exige que quede bajo el umbral y no se guarde.",
    ),
    caso(
      "Correo sin marca de transacción",
      {
        asunto: "Novedades de tu banco",
        texto: "Nuestro nuevo horario de atención es de 8 a 17. Consultas al 021 500 000.",
      },
      { nada: true },
      "critico",
      "Un número de teléfono no es plata y un correo informativo no es un aviso.",
    ),
  ],
};
