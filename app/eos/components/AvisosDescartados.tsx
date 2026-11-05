"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";

type Aviso = {
  email_id: string;
  remitente: string | null;
  tipo: "ingreso" | "gasto";
  monto: number;
  moneda: "PYG" | "USD";
  descripcion: string | null;
  confianza: number;
  recibido_en: string;
};

function formatearMonto(monto: number, moneda: "PYG" | "USD"): string {
  const simbolo = moneda === "PYG" ? "₲" : "US$";
  return `${simbolo} ${new Intl.NumberFormat("es-PY").format(monto)}`;
}

/**
 * Lo que el parser de correo vio pero no se animó a guardar solo.
 *
 * `extraerDeCorreo` descarta cualquier lectura por debajo de 0.8 de
 * confianza en vez de adivinar: perderse un movimiento es preferible a meter
 * un importe mal leído en el disponible real. Pero perderse en silencio no
 * es aceptable — esta tarjeta es la otra mitad de esa decisión: mostrarle al
 * usuario exactamente lo que EOS dudó, para que lo confirme con un toque o
 * diga que no era nada.
 *
 * Se renderiza vacía (`null`) cuando no hay nada pendiente: igual que el
 * resto del panel, silencio es la norma.
 */
export default function AvisosDescartados() {
  const [avisos, setAvisos] = useState<Aviso[] | null>(null);
  const [resolviendo, setResolviendo] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/finanzas/avisos-descartados", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then((data) => setAvisos(data.avisos ?? []))
      .catch(() => setAvisos([]));
  }, []);

  async function resolver(aviso: Aviso, accion: "confirmar" | "descartar") {
    setResolviendo(aviso.email_id);
    try {
      const res = await fetch("/api/finanzas/avisos-descartados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_id: aviso.email_id, accion }),
      });
      if (res.ok) {
        setAvisos((actual) => (actual ?? []).filter((a) => a.email_id !== aviso.email_id));
      }
    } finally {
      setResolviendo(null);
    }
  }

  if (!avisos || avisos.length === 0) return null;

  return (
    <div className="card fin-card">
      <div className="fin-head">
        <span className="fin-badge fin-badge-atencion">
          <AlertTriangle size={14} />
          {avisos.length === 1 ? "1 AVISO DEL BANCO SIN CONFIRMAR" : `${avisos.length} AVISOS DEL BANCO SIN CONFIRMAR`}
        </span>
      </div>

      <p className="prose" style={{ marginTop: 10 }}>
        Llegaron pero EOS no estuvo seguro de haberlos leído bien. Confirmalos si son correctos, o
        decí que no era nada.
      </p>

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {avisos.map((aviso) => (
          <div key={aviso.email_id} className="field-row" style={{ gap: 10, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                {aviso.tipo === "ingreso" ? "Ingreso" : "Gasto"} de {formatearMonto(aviso.monto, aviso.moneda)}
              </div>
              <div className="fin-sub">
                {aviso.descripcion || "Sin descripción"}
                {aviso.remitente ? ` · ${aviso.remitente.split("@")[1] ?? aviso.remitente}` : ""}
              </div>
            </div>
            <button
              type="button"
              className="fin-editar"
              aria-label="Confirmar este movimiento"
              title="Sí, agregalo"
              disabled={resolviendo === aviso.email_id}
              onClick={() => void resolver(aviso, "confirmar")}
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              className="fin-editar"
              aria-label="No era un movimiento real"
              title="No era nada"
              disabled={resolviendo === aviso.email_id}
              onClick={() => void resolver(aviso, "descartar")}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
