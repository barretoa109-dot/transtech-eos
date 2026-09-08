"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Copy, ListOrdered, MessageSquare } from "lucide-react";

import { formatearMonto } from "@/lib/finanzas/formato";

type PasoPlan = { acreedor: string; monto: number; fecha: string | null; motivo: string };

type Plan = {
  capacidad_mensual: number;
  total_cuotas: number;
  alcanza: boolean;
  faltante: number;
  orden: PasoPlan[];
  a_negociar: string[];
  excedente: number;
  destino_excedente: { acreedor: string; motivo: string } | null;
  meses_para_salir: number | null;
};

type Negociacion = {
  acreedor: string;
  estrategia: string;
  asunto: string;
  mensaje: string;
  /** Por qué EOS eligió esta estrategia. Es para el usuario, no para el acreedor. */
  porque?: string;
};

type Respuesta = {
  configurado?: boolean;
  sin_deudas?: boolean;
  plan: Plan | null;
  negociaciones: Negociacion[];
  advertencia?: string;
  eos_no_paga?: boolean;
};

const ESTRATEGIA: Record<string, string> = {
  prorroga: "Pedir prórroga",
  pago_parcial: "Ofrecer un pago parcial",
  refinanciacion: "Pedir refinanciación",
};

/**
 * El plan de pago del mes, y los borradores para negociar lo que no entra.
 *
 * ============================================================
 * ESTO ESTABA CONSTRUIDO Y NO SE VEÍA DESDE NINGUNA PANTALLA
 * ============================================================
 *
 * `/api/finanzas/plan` calcula, desde hace semanas: cuánto queda por mes para
 * deudas después de vivir, si eso alcanza para las cuotas, en qué ORDEN pagar
 * y por qué cada acreedor está en esa posición, a quién habría que negociarle
 * lo que no entra, dónde conviene poner el excedente si sobra, y en cuántos
 * meses la persona quedaría sin deudas al ritmo actual. Y redacta el mensaje
 * para cada acreedor que no entra.
 *
 * Tiene además un POST para adoptar el plan, que lo deja asentado en la
 * auditoría. Ninguna pantalla lo consumía. Es la fase "EOS prepara la solución
 * completa y el usuario solo aprueba" —la parte de preparar— construida,
 * probada e invisible.
 *
 * ============================================================
 * EL ORDEN SIN EL MOTIVO NO SIRVE
 * ============================================================
 *
 * Una lista que dice "pagá primero a Financiera X" y no dice por qué es una
 * orden, no un consejo, y nadie sigue una orden sobre su propia plata. Cada
 * paso muestra la razón que el motor ya calcula: qué pasa si esa no se paga.
 *
 * ============================================================
 * EOS NO PAGA, Y HAY QUE DECIRLO
 * ============================================================
 *
 * En Paraguay no hay riel para que una aplicación abone la cuota de un
 * préstamo ajeno, y aunque lo hubiera, mover plata sin un toque explícito está
 * prohibido. El plan es una propuesta y los mensajes son borradores. Que eso
 * quede escrito en la pantalla no es humildad: es lo que evita que alguien se
 * quede esperando un pago que nunca va a salir.
 */
export default function FinanzasPlanDeudas({ moneda = "PYG" }: { moneda?: string }) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [adoptando, setAdoptando] = useState(false);
  const [adoptado, setAdoptado] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  const cargar = useCallback(() => {
    return fetch("/api/finanzas/plan", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then(setDatos)
      .catch(() => setDatos(null));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Se calla sola cuando no hay nada que decir: sin política financiera, sin
  // deudas, o si la ruta falló. Una tarjeta vacía en un panel de deudas es
  // peor que ninguna — sugiere que EOS mira algo que no está mirando.
  if (!datos || datos.sin_deudas || !datos.plan) return null;

  const plan = datos.plan;

  async function adoptar() {
    setAdoptando(true);
    try {
      const res = await fetch("/api/finanzas/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acreedores: plan.orden.map((p) => p.acreedor),
          total: plan.orden.reduce((t, p) => t + p.monto, 0),
        }),
      });
      if (res.ok) setAdoptado(true);
    } finally {
      setAdoptando(false);
    }
  }

  async function copiar(texto: string, acreedor: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(acreedor);
      window.setTimeout(() => setCopiado(null), 2500);
    } catch {
      /* Sin portapapeles el texto igual está a la vista para copiarlo a mano. */
    }
  }

  return (
    <div className="card fin-card">
      <div className="fin-head">
        <span className={`fin-badge ${plan.alcanza ? "fin-badge-seguro" : "fin-badge-atencion"}`}>
          <ListOrdered size={14} />
          {plan.alcanza ? "TU PLAN DE ESTE MES" : "ESTE MES NO ALCANZA"}
        </span>
      </div>

      {/* La cifra que ordena todo: lo que queda por mes para deudas después de
          vivir. Sin ella, el orden de abajo es una opinión. */}
      <div style={{ marginTop: 8, marginBottom: 14 }}>
        <div className="fin-row-label" style={{ opacity: 0.75 }}>
          Te queda por mes para deudas, después de vivir
        </div>
        <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>
          {formatearMonto(plan.capacidad_mensual, moneda)}
        </div>
        <div className="prose" style={{ fontSize: 13, opacity: 0.75, marginTop: 2 }}>
          Tus cuotas de este mes suman {formatearMonto(plan.total_cuotas, moneda)}
          {plan.alcanza
            ? "."
            : `, así que te faltan ${formatearMonto(plan.faltante, moneda)}.`}
        </div>
      </div>

      {plan.orden.length > 0 && (
        <>
          <div className="dest-seccion">En qué orden pagar</div>
          <div className="fin-rows">
            {plan.orden.map((paso, i) => (
              <div className="fin-row" key={`${paso.acreedor}-${i}`} style={{ alignItems: "flex-start" }}>
                <span className="fin-row-label">
                  <strong>{i + 1}.</strong> {paso.acreedor}
                  {paso.fecha ? ` · vence ${paso.fecha.slice(8, 10)}/${paso.fecha.slice(5, 7)}` : ""}
                  {/* El motivo es lo que convierte una orden en un consejo. */}
                  <span className="prose" style={{ display: "block", fontSize: 12, opacity: 0.7 }}>
                    {paso.motivo}
                  </span>
                </span>
                <span className="fin-row-value">{formatearMonto(paso.monto, moneda)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {plan.excedente > 0 && plan.destino_excedente && (
        <p className="prose" style={{ marginTop: 12, fontSize: 13 }}>
          <ArrowRight size={12} style={{ display: "inline", marginRight: 4, verticalAlign: -1 }} />
          Te sobran {formatearMonto(plan.excedente, moneda)}. Si los ponés en{" "}
          <strong>{plan.destino_excedente.acreedor}</strong>, {plan.destino_excedente.motivo}
        </p>
      )}

      {plan.meses_para_salir !== null && (
        <p className="prose" style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
          A este ritmo salís de todas tus deudas en aproximadamente{" "}
          <strong>
            {plan.meses_para_salir} {plan.meses_para_salir === 1 ? "mes" : "meses"}
          </strong>
          . Es una estimación con los saldos y las cuotas que declaraste; cambia si cambian.
        </p>
      )}

      {plan.orden.length > 0 && (
        <button
          type="button"
          className="chip"
          style={{ marginTop: 12, cursor: adoptado ? "default" : "pointer" }}
          onClick={() => void adoptar()}
          disabled={adoptando || adoptado}
        >
          {adoptado ? (
            <>
              <Check size={12} /> Plan adoptado
            </>
          ) : adoptando ? (
            "Guardando…"
          ) : (
            "Adoptar este plan"
          )}
        </button>
      )}

      {/* Lo que no entra: los borradores. Solo se redactan para los acreedores
          que la capacidad no cubre — ofrecer un mensaje de negociación para una
          deuda que sí se puede pagar sería empujar a alguien a gastar crédito
          con su acreedor sin necesidad. */}
      {datos.negociaciones.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="dest-seccion">
            Lo que no entra este mes: {datos.negociaciones.length}{" "}
            {datos.negociaciones.length === 1 ? "mensaje listo" : "mensajes listos"}
          </div>

          {datos.negociaciones.map((n) => (
            <div key={n.acreedor} style={{ marginTop: 10 }}>
              <button
                type="button"
                className="chip"
                style={{ cursor: "pointer" }}
                onClick={() => setAbierta(abierta === n.acreedor ? null : n.acreedor)}
                aria-expanded={abierta === n.acreedor}
              >
                <MessageSquare size={12} /> {n.acreedor} · {ESTRATEGIA[n.estrategia] ?? n.estrategia}
              </button>

              {abierta === n.acreedor && (
                <div style={{ marginTop: 8 }}>
                  {n.porque && (
                    <p className="prose" style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                      {n.porque}
                    </p>
                  )}
                  <p className="prose" style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
                    {n.mensaje}
                  </p>
                  <button
                    type="button"
                    className="chip"
                    style={{ marginTop: 8, cursor: "pointer" }}
                    onClick={() => void copiar(n.mensaje, n.acreedor)}
                  >
                    {copiado === n.acreedor ? (
                      <>
                        <Check size={12} /> Copiado
                      </>
                    ) : (
                      <>
                        <Copy size={12} /> Copiar
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          ))}

          {datos.advertencia && (
            <p className="prose" style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
              <AlertTriangle size={12} style={{ display: "inline", marginRight: 4, verticalAlign: -1 }} />
              {datos.advertencia}
            </p>
          )}
        </div>
      )}

      {/* Lo que EOS no hace, escrito. */}
      {datos.eos_no_paga && (
        <p className="prose" style={{ marginTop: 12, fontSize: 12, opacity: 0.6 }}>
          EOS no paga por vos: arma el plan y redacta los mensajes, el pago lo hacés vos.
        </p>
      )}
    </div>
  );
}
