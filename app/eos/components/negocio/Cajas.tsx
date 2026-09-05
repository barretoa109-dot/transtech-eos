"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";

/**
 * Dónde tiene la plata el negocio.
 *
 * ============================================================
 * SE PIDE EL SALDO, NO UN LIBRO DE CAJA
 * ============================================================
 *
 * Un módulo de tesorería completo —turnos, arqueos, conciliación— es otro
 * producto. Lo que hace falta para que la liquidez, la prueba ácida y el día
 * de quiebre existan es UN número: cuánto hay hoy. Se pide eso y nada más.
 *
 * Después EOS le arrastra solo los cobros y pagos que ve, así que el número
 * mejora sin que nadie vuelva a tocarlo. Cuando envejece, se avisa.
 *
 * ============================================================
 * "CONTÉ Y HAY ESTO" ES LA ACCIÓN, NO "EDITAR"
 * ============================================================
 *
 * Nadie edita un saldo: lo vuelve a contar. El botón dice eso, y la fecha se
 * pone sola en hoy — que es cuándo contaron. Pedirle además la fecha a alguien
 * que acaba de contar la plata es pedirle un dato que ya dio.
 */

type Caja = {
  id: string;
  nombre: string;
  tipo: string;
  moneda: string;
  saldo_declarado: number | null;
  saldo_declarado_el: string | null;
  activa: boolean;
};

type Saldo = {
  moneda: string;
  saldo: number;
  declarado: number;
  arrastrado: number;
  cajas: number;
  dias_del_mas_viejo: number;
  confianza: number;
  avisos: string[];
};

type Respuesta = { hoy: string; cajas: Caja[]; saldos: Saldo[] };

const TIPOS: { valor: string; etiqueta: string }[] = [
  { valor: "efectivo", etiqueta: "Efectivo" },
  { valor: "banco", etiqueta: "Banco" },
  { valor: "cooperativa", etiqueta: "Cooperativa" },
  { valor: "financiera", etiqueta: "Financiera" },
  { valor: "billetera", etiqueta: "Billetera" },
];

const NOMBRE_TIPO = Object.fromEntries(TIPOS.map((t) => [t.valor, t.etiqueta]));

export default function Cajas() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);

  // El alta y el reconteo comparten el estado del monto: nunca están los dos
  // abiertos a la vez.
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState("efectivo");
  const [monto, setMonto] = useState("");
  const [contando, setContando] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const res = await traer();
      if (!vivo) return;
      if (res) setDatos(res);
      setCargando(false);
    })();
    return () => {
      vivo = false;
    };
  }, []);

  async function pedir(opciones: RequestInit) {
    setOcupado(true);
    setAviso("");
    try {
      const r = await fetch("/api/empresa/cajas", opciones);
      const cuerpo = await r.json().catch(() => ({}));
      if (!r.ok) {
        setAviso(cuerpo?.error ?? "No pudimos guardar el cambio.");
        return false;
      }
      const res = await traer();
      if (res) setDatos(res);
      return true;
    } catch {
      setAviso("No pudimos guardar el cambio.");
      return false;
    } finally {
      setOcupado(false);
    }
  }

  if (cargando || !datos) return null;

  const vivas = datos.cajas.filter((c) => c.activa);

  return (
    <div className="card">
      <div className="card-title">
        <Wallet size={15} /> Tu caja
      </div>
      <div className="card-sub">
        {vivas.length === 0
          ? "Cargá cuánto tenés y EOS puede decirte qué día se te acaba."
          : "El saldo que declaraste, más los cobros y pagos que EOS vio después."}
      </div>

      {/*
        Solo se muestra el saldo de las monedas donde ALGO se declaró.
        `cajas: 0` significa que nadie dijo cuánto hay, y su saldo llega en
        cero: mostrarlo diría "no tenés plata en dólares" cuando lo cierto es
        "no sabemos cuánta". El aviso de abajo ya explica qué falta.
      */}
      {datos.saldos
        .filter((s) => s.cajas > 0)
        .map((s) => (
        <div key={s.moneda} className="neg-metricas">
          <div className="neg-metrica">
            <span>Tenés en {s.moneda}</span>
            <strong>{formatearMonto(s.saldo, s.moneda)}</strong>
            {s.arrastrado !== 0 && (
              <small className="neg-metrica-nota">
                {formatearMonto(s.declarado, s.moneda)} declarado
                {s.arrastrado > 0 ? " + " : " − "}
                {formatearMonto(Math.abs(s.arrastrado), s.moneda)} de cobros y pagos
              </small>
            )}
          </div>
        </div>
      ))}

      {/*
        Los avisos van con el número y no escondidos: un saldo de hace tres
        meses se lee igual de firme que uno de ayer si nadie dice cuál es cuál.
      */}
      {datos.saldos.flatMap((s) => s.avisos).length > 0 && (
        <div className="pron-faltantes">
          {[...new Set(datos.saldos.flatMap((s) => s.avisos))].map((a) => (
            <p key={a}>{a}</p>
          ))}
        </div>
      )}

      <div className="neg-lista">
        {vivas.map((c) => (
          <div key={c.id} className="neg-fila">
            <div className="neg-fila-texto">
              <strong>{c.nombre}</strong>
              <small>
                {NOMBRE_TIPO[c.tipo] ?? c.tipo} · {c.moneda}
                {c.saldo_declarado_el
                  ? ` · contado el ${formatearDia(c.saldo_declarado_el)}`
                  : " · sin saldo cargado"}
              </small>
            </div>

            {contando === c.id ? (
              <div className="cartera-cobro">
                <input
                  className="neg-input neg-cantidad"
                  inputMode="numeric"
                  autoFocus
                  placeholder={c.saldo_declarado === null ? "0" : String(c.saldo_declarado)}
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  aria-label={`Cuánto hay en ${c.nombre}`}
                />
                <button
                  type="button"
                  className="reco-btn"
                  disabled={ocupado || !monto.trim()}
                  onClick={async () => {
                    const ok = await pedir({
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ id: c.id, saldo_declarado: monto.trim() }),
                    });
                    if (ok) {
                      setContando(null);
                      setMonto("");
                    }
                  }}
                >
                  Guardar
                </button>
                <button
                  type="button"
                  className="chip"
                  disabled={ocupado}
                  onClick={() => {
                    setContando(null);
                    setMonto("");
                  }}
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="emp-acciones">
                <div className="neg-fila-monto">
                  {c.saldo_declarado === null ? "—" : formatearMonto(c.saldo_declarado, c.moneda)}
                </div>
                <button
                  type="button"
                  className="chip"
                  disabled={ocupado}
                  onClick={() => {
                    setContando(c.id);
                    setMonto("");
                  }}
                >
                  Conté y hay…
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="emp-invitar">
        <div className="emp-subtitulo">Agregar una caja</div>
        <div className="neg-form">
          <input
            className="neg-input neg-field-wide"
            placeholder="Caja chica, Banco Itaú…"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            aria-label="Nombre de la caja"
          />
          <select
            className="neg-input"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            aria-label="Tipo"
          >
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.etiqueta}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="reco-btn"
            disabled={ocupado || !nombre.trim()}
            onClick={async () => {
              const ok = await pedir({
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ nombre: nombre.trim(), tipo }),
              });
              if (ok) setNombre("");
            }}
          >
            Agregar
          </button>
        </div>
      </div>

      {aviso && <p className="neg-error">{aviso}</p>}
    </div>
  );
}

/** Fuera del componente: así el efecto no toca estado antes de su primer await. */
async function traer(): Promise<Respuesta | null> {
  try {
    const r = await fetch("/api/empresa/cajas", { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as Respuesta;
  } catch {
    return null;
  }
}

function formatearDia(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d)).toLocaleDateString("es-PY", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
