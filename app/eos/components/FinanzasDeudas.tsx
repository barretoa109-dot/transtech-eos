"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Heart } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";
import { nombreDeMoneda } from "@/lib/finanzas/monedas";

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
  moneda: string;
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

type TotalMoneda = { moneda: string; total: number; cuota_mensual: number };

type Respuesta = {
  deudas: Deuda[];
  /** Un total por cada moneda en la que el usuario debe. */
  totales: TotalMoneda[];
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

  /*
   * Un total por moneda.
   *
   * Antes esta tarjeta sumaba solo los guaraníes y mostraba los dólares como
   * una nota al pie; cualquier otra moneda simplemente no existía. Ahora hay
   * una columna por moneda: sumar deudas de monedas distintas da un número
   * que no se debe en ninguna.
   */
  const totales = data.totales ?? [];

  // La próxima cuota sale de `proximaCuota`, que recorre todas las deudas sin
  // mirar la moneda: se muestra en la de mayor peso, que es la que la va a
  // haber generado en la práctica.
  const monedaPrincipal = totales[0]?.moneda ?? "PYG";

  return (
    <div className="card">
      <div className="card-title">A quién le debés</div>
      <div className="card-sub">
        {vivas.length} {vivas.length === 1 ? "deuda activa" : "deudas activas"}
      </div>

      <div className="deuda-resumen">
        {totales.map((t) => (
          <div className="deuda-kpi" key={t.moneda}>
            <div className="deuda-kpi-l">
              {totales.length > 1 ? `Total en ${nombreDeMoneda(t.moneda).toLowerCase()}` : "Total declarado"}
            </div>
            <div className="deuda-kpi-v">{formatearMonto(t.total, t.moneda)}</div>
            {t.cuota_mensual > 0 && (
              <div className="deuda-kpi-extra">
                {formatearMonto(t.cuota_mensual, t.moneda)} por mes en cuotas
              </div>
            )}
          </div>
        ))}
        {data.proxima_cuota && (
          <div className="deuda-kpi">
            <div className="deuda-kpi-l">
              <CalendarClock size={12} style={{ display: "inline", marginRight: 4, verticalAlign: -2 }} />
              Próxima cuota
            </div>
            <div className="deuda-kpi-v">{formatearMonto(data.proxima_cuota.monto, monedaPrincipal)}</div>
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
