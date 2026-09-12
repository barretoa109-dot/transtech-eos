"use client";

import { useEffect, useState } from "react";
import FallaDeCarga from "./FallaDeCarga";
import Confirmar from "./negocio/Confirmar";
import { CalendarClock, Heart, Pencil } from "lucide-react";
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
 * Fue de solo lectura a propósito hasta el 12 de septiembre de 2026. La
 * doctrina dice que EOS trabaja y el usuario observa: las deudas se declaran
 * conversando, que es donde EOS puede repreguntar lo que falta.
 *
 * Eso sigue siendo el camino principal —REGISTRAR_DEUDA y REGISTRAR_PAGO_DEUDA
 * desde el chat— pero dejó de ser el ÚNICO. Una usuaria lo pidió sin vueltas:
 * todo lo que se carga tiene que poder corregirse y borrarse desde la
 * pantalla. Un saldo mal entendido que sólo se arregla volviendo a hablar con
 * EOS obliga a adivinar la frase exacta que lo corrige; y una deuda cargada
 * dos veces no tenía NINGUNA forma de desaparecer, porque la API de borrar
 * existía y ninguna pantalla la llamaba.
 *
 * No es un formulario de doce campos: se corrigen los cinco que cambian con
 * el tiempo —saldo, cuota, día, cuotas pagadas y estado—. El acreedor y el
 * tipo no se tocan acá: si están mal, es otra deuda.
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

  /** Qué deuda está abierta para corregir. Una sola por vez. */
  const [editando, setEditando] = useState<string | null>(null);
  const [fallo, setFallo] = useState("");

  /*
   * Recargar sube un contador en vez de llamar a una función desde el efecto.
   * Así el estado se escribe siempre DESPUÉS de la respuesta, nunca en el
   * cuerpo del efecto, que es lo que la regla de hooks del proyecto prohíbe
   * y lo que ya marcó en otra pantalla.
   */
  const [version, setVersion] = useState(0);
  const recargar = () => setVersion((v) => v + 1);

  useEffect(() => {
    fetch("/api/finanzas/deudas", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then(setData)
      .catch(() => setError(true));
  }, [version]);

  async function borrar(d: Deuda) {
    setFallo("");

    const res = await fetch(`/api/finanzas/deudas/${d.id}`, { method: "DELETE" });

    if (!res.ok) {
      const datos = await res.json().catch(() => null);
      setFallo(datos?.error || "No pudimos borrarla.");
      return;
    }

    recargar();
  }

  if (error) return <FallaDeCarga que="tus deudas" />;

  if (data === null) return null;

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

      {fallo && <p className="anular-error" role="alert">{fallo}</p>}

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

              {editando === d.id ? (
                <EditarDeuda
                  deuda={d}
                  onCerrar={() => setEditando(null)}
                  onListo={() => {
                    setEditando(null);
                    recargar();
                  }}
                />
              ) : (
                <div className="chip-row" style={{ marginTop: 8 }}>
                  <button type="button" className="chip" onClick={() => setEditando(d.id)}>
                    <Pencil size={11} style={{ display: "inline", marginRight: 3, verticalAlign: -1 }} />
                    Corregir
                  </button>

                  {/*
                    Borrar dice lo que borra. Una deuda borrada deja de restar del
                    disponible real y de aparecer en el plan de pagos: si en
                    realidad se pagó, lo correcto es marcarla saldada y no
                    borrarla, porque así queda el historial.
                  */}
                  <Confirmar
                    etiqueta="Borrar"
                    peligro
                    consecuencia={
                      `La deuda con ${d.acreedor} desaparece del todo: deja de restar de tu disponible ` +
                      "y sale del plan de pagos. Si ya la pagaste, mejor corregila y marcala como saldada."
                    }
                    confirmar="Sí, borrarla"
                    onConfirmar={() => void borrar(d)}
                  />
                </div>
              )}
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

/* ------------------------------------------------------------------ */

/**
 * Corregir lo que cambia de una deuda con el tiempo.
 *
 * La ruta mezcla lo que se manda con lo que la deuda ya tenía y valida el
 * resultado entero con `validarDeuda`, así que acá se manda sólo lo que se
 * edita. Si el saldo cambia, el servidor le pone la fecha de hoy a
 * "según lo que declaraste el…": un saldo corregido es un saldo declarado hoy.
 */
function EditarDeuda({
  deuda,
  onCerrar,
  onListo,
}: {
  deuda: Deuda;
  onCerrar: () => void;
  onListo: () => void;
}) {
  const [saldo, setSaldo] = useState(String(deuda.saldo_declarado));
  const [cuotaMonto, setCuotaMonto] = useState(deuda.cuota_monto === null ? "" : String(deuda.cuota_monto));
  const [cuotaDia, setCuotaDia] = useState(deuda.cuota_dia === null ? "" : String(deuda.cuota_dia));
  const [cuotasTotales, setCuotasTotales] = useState(
    deuda.cuotas_totales === null ? "" : String(deuda.cuotas_totales),
  );
  const [cuotasPagadas, setCuotasPagadas] = useState(String(deuda.cuotas_pagadas ?? 0));
  const [estado, setEstado] = useState<Deuda["estado"]>(deuda.estado);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    setGuardando(true);
    setError("");

    try {
      const res = await fetch(`/api/finanzas/deudas/${deuda.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saldo_declarado: Number(saldo),
          // Vacío es "no tiene cuota", que es distinto de cero. La ruta exige
          // monto y día juntos o ninguno de los dos, y lo dice si falta uno.
          cuota_monto: cuotaMonto.trim() === "" ? null : Number(cuotaMonto),
          cuota_dia: cuotaDia.trim() === "" ? null : Number(cuotaDia),
          cuotas_totales: cuotasTotales.trim() === "" ? null : Number(cuotasTotales),
          cuotas_pagadas: Number(cuotasPagadas) || 0,
          estado,
        }),
      });

      const datos = await res.json().catch(() => null);
      if (!res.ok) throw new Error(datos?.error || "No se pudo guardar.");

      onListo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fila-editor">
      <div className="fila-editor-campos">
        <input
          className="neg-input neg-cantidad"
          type="number"
          min={0}
          value={saldo}
          autoFocus
          placeholder="Saldo"
          title="Cuánto debés hoy"
          onChange={(e) => setSaldo(e.target.value)}
        />
        <input
          className="neg-input neg-cantidad"
          type="number"
          min={0}
          value={cuotaMonto}
          placeholder="Cuota"
          title="De cuánto es la cuota. Vacío si no tiene."
          onChange={(e) => setCuotaMonto(e.target.value)}
        />
        <input
          className="neg-input neg-cantidad"
          type="number"
          min={1}
          max={31}
          value={cuotaDia}
          placeholder="Día"
          title="Qué día del mes se paga"
          onChange={(e) => setCuotaDia(e.target.value)}
        />
        <input
          className="neg-input neg-cantidad"
          type="number"
          min={0}
          value={cuotasPagadas}
          placeholder="Pagadas"
          title="Cuántas cuotas ya pagaste"
          onChange={(e) => setCuotasPagadas(e.target.value)}
        />
        <input
          className="neg-input neg-cantidad"
          type="number"
          min={0}
          value={cuotasTotales}
          placeholder="De cuántas"
          title="Cuántas cuotas son en total. Vacío si no sabés."
          onChange={(e) => setCuotasTotales(e.target.value)}
        />
        <select
          className="neg-input neg-cantidad"
          value={estado}
          aria-label="Estado de la deuda"
          onChange={(e) => setEstado(e.target.value as Deuda["estado"])}
        >
          <option value="al_dia">Al día</option>
          <option value="atrasada">Atrasada</option>
          <option value="en_negociacion">En negociación</option>
          <option value="saldada">Saldada</option>
        </select>
      </div>

      {error && <p className="anular-error" role="alert">{error}</p>}

      <div className="anular-acciones">
        <button type="button" className="chip active" disabled={guardando} onClick={() => void guardar()}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" className="chip" disabled={guardando} onClick={onCerrar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
