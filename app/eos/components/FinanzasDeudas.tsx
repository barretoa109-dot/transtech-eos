"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Heart } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";

/**
 * A quién le debés y cuánto falta.
 *
 * Las deudas existen en la base desde la v61 y tienen API completa, pero
 * nunca tuvieron pantalla: se cargaban por chat y desaparecían dentro del
 * cálculo del disponible real. Para alguien endeudado, "en dónde va cada
 * moneda" empieza por acá — es la parte del dinero que ya tiene dueño antes
 * de que entre.
 *
 * Es de solo lectura a propósito. La doctrina dice que EOS trabaja y el
 * usuario observa: las deudas se declaran conversando, que es donde EOS puede
 * repreguntar lo que falta, no en un formulario de doce campos.
 *
 * Dos cosas que el panel nunca hace:
 *
 *  - NO RECALCULA EL SALDO. Lo muestra como lo que es: "según lo que
 *    declaraste el <fecha>". EOS no ve los pagos al préstamo salvo que
 *    lleguen por correo; un saldo que se actualiza solo se desincroniza en
 *    silencio y el usuario decide creyendo que debe menos.
 *  - NO OPINA SOBRE LA DEUDA. Nada de "deberías cancelar esta primero". El
 *    orden ya dice bastante, y el consejo financiero personalizado no es lo
 *    que este panel está en condiciones de dar.
 */

type Deuda = {
  id: string;
  acreedor: string;
  tipo: "prestamo" | "tarjeta" | "proveedor" | "familiar" | "impuesto" | "otro";
  moneda: "PYG" | "USD";
  saldo_declarado: number;
  saldo_declarado_el: string;
  cuota_monto: number | null;
  cuota_dia: number | null;
  cuotas_totales: number | null;
  cuotas_pagadas: number;
  vence_el: string | null;
  estado: "al_dia" | "atrasada" | "en_negociacion" | "saldada";
  preocupa: boolean;
};

type Respuesta = {
  deudas: Deuda[];
  total_adeudado: number;
  total_adeudado_usd: number;
  proxima_cuota: { fecha: string; monto: number; descripcion: string } | null;
};

const TIPO: Record<Deuda["tipo"], string> = {
  prestamo: "Préstamo",
  tarjeta: "Tarjeta",
  proveedor: "Proveedor",
  familiar: "Familiar",
  impuesto: "Impuesto",
  otro: "Otro",
};

const ESTADO: Record<Deuda["estado"], { texto: string; clase: string }> = {
  al_dia: { texto: "Al día", clase: "is-ok" },
  atrasada: { texto: "Atrasada", clase: "is-mal" },
  en_negociacion: { texto: "En negociación", clase: "is-medio" },
  saldada: { texto: "Saldada", clase: "is-ok" },
};

export default function FinanzasDeudas() {
  const [data, setData] = useState<Respuesta | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/finanzas/deudas", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error || data === null) return null;

  const vivas = data.deudas.filter((d) => d.estado !== "saldada");

  // Sin deudas no se muestra una tarjeta vacía felicitando a nadie: quien no
  // debe nada no necesita que se lo recuerden, y quien todavía no las cargó
  // vería un "no debés nada" que es mentira.
  if (vivas.length === 0) return null;

  // Lo que sale todos los meses en cuotas. Es el número que convierte una
  // lista de saldos en algo que se siente: cuánto de cada mes ya está tomado
  // antes de decidir nada.
  const porMes = vivas
    .filter((d) => d.moneda === "PYG" && d.cuota_monto && restantes(d) !== 0)
    .reduce((total, d) => total + (d.cuota_monto ?? 0), 0);

  const pyg = (v: number) => formatearMonto(v, "PYG");

  return (
    <div className="card">
      <div className="card-title">A quién le debés</div>
      <div className="card-sub">
        {vivas.length} {vivas.length === 1 ? "deuda activa" : "deudas activas"}
      </div>

      <div className="deuda-resumen">
        <div className="deuda-kpi">
          <div className="deuda-kpi-l">Total declarado</div>
          <div className="deuda-kpi-v">{pyg(data.total_adeudado)}</div>
          {data.total_adeudado_usd > 0 && (
            <div className="deuda-kpi-extra">+ {formatearMonto(data.total_adeudado_usd, "USD")}</div>
          )}
        </div>
        {porMes > 0 && (
          <div className="deuda-kpi">
            <div className="deuda-kpi-l">Sale por mes en cuotas</div>
            <div className="deuda-kpi-v">{pyg(porMes)}</div>
            <div className="deuda-kpi-extra">ya descontado de tu disponible</div>
          </div>
        )}
        {data.proxima_cuota && (
          <div className="deuda-kpi">
            <div className="deuda-kpi-l">
              <CalendarClock size={12} style={{ display: "inline", marginRight: 4, verticalAlign: -2 }} />
              Próxima cuota
            </div>
            <div className="deuda-kpi-v">{pyg(data.proxima_cuota.monto)}</div>
            <div className="deuda-kpi-extra">{formatearFecha(data.proxima_cuota.fecha)}</div>
          </div>
        )}
      </div>

      <div className="deuda-lista">
        {vivas.map((d) => {
          const quedan = restantes(d);
          const estado = ESTADO[d.estado];

          return (
            <div className="deuda-item" key={d.id}>
              <div className="deuda-cab">
                <span className="deuda-acreedor">
                  {d.acreedor}
                  {d.preocupa && (
                    <span className="deuda-preocupa" title="Marcaste que esta deuda te preocupa">
                      <Heart size={11} />
                    </span>
                  )}
                </span>
                <span className={`deuda-estado ${estado.clase}`}>{estado.texto}</span>
              </div>

              <div className="deuda-cifras">
                <span className="deuda-saldo">{formatearMonto(d.saldo_declarado, d.moneda)}</span>
                <span className="deuda-tipo">{TIPO[d.tipo]}</span>
                {d.cuota_monto !== null && (
                  <span className="deuda-cuota">
                    {formatearMonto(d.cuota_monto, d.moneda)}
                    {d.cuota_dia !== null ? ` el ${d.cuota_dia}` : ""}
                    {quedan !== null ? ` · quedan ${quedan}` : ""}
                  </span>
                )}
              </div>

              {/*
                La fecha de declaración no es un detalle de auditoría: es lo que
                separa "debés esto" de "esto es lo que dijiste hace tres meses".
                Sin ella, un saldo viejo se lee como un saldo actual.
              */}
              <div className="deuda-fuente">
                Según lo que declaraste el {formatearFecha(d.saldo_declarado_el)}
                {d.vence_el ? ` · vence el ${formatearFecha(d.vence_el)}` : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Cuántas cuotas quedan. `null` = sin plazo conocido. */
function restantes(d: Deuda): number | null {
  if (d.cuotas_totales === null) return null;
  return Math.max(0, d.cuotas_totales - d.cuotas_pagadas);
}

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** Sin `new Date`: en UTC-3 una fecha ISO se corre un día para atrás. */
function formatearFecha(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  if (!anio || !mes || !dia || mes < 1 || mes > 12) return iso;
  return `${dia} de ${MESES[mes - 1]}`;
}
