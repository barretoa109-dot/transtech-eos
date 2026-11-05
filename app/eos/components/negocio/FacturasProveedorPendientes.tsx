"use client";

import { useEffect, useState } from "react";
import { Check, FileText, X } from "lucide-react";

type Factura = {
  id: string;
  proveedor_ruc: string | null;
  proveedor_nombre: string | null;
  numero_documento: string | null;
  fecha: string | null;
  moneda: "PYG" | "USD";
  total: number;
  iva_tasa: 0 | 5 | 10;
  empresa_id: string | null;
};

function formatearMonto(monto: number, moneda: "PYG" | "USD"): string {
  const simbolo = moneda === "PYG" ? "₲" : "US$";
  return `${simbolo} ${new Intl.NumberFormat("es-PY").format(monto)}`;
}

/**
 * Facturas de proveedores que EOS leyó de un correo (Pilar 3 del documento
 * de visión del 04/11) y que esperan que el dueño las confirme como compra.
 *
 * Nunca se registran solas: un KuDE se puede leer mal o falsificar, y
 * confirmar una de estas mueve stock y plata real. Mismo criterio que
 * `AvisosDescartados.tsx` para los avisos bancarios de baja confianza.
 */
export default function FacturasProveedorPendientes({ onCambio }: { onCambio?: () => void }) {
  const [facturas, setFacturas] = useState<Factura[] | null>(null);
  const [resolviendo, setResolviendo] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/erp/facturas-proveedor", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then((data) => setFacturas(data.facturas ?? []))
      .catch(() => setFacturas([]));
  }, []);

  async function resolver(factura: Factura, accion: "confirmar" | "descartar") {
    setResolviendo(factura.id);
    try {
      const res = await fetch("/api/erp/facturas-proveedor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: factura.id, accion }),
      });
      if (res.ok) {
        setFacturas((actual) => (actual ?? []).filter((f) => f.id !== factura.id));
        if (accion === "confirmar") onCambio?.();
      }
    } finally {
      setResolviendo(null);
    }
  }

  if (!facturas || facturas.length === 0) return null;

  return (
    <div className="card fin-card">
      <div className="fin-head">
        <span className="fin-badge fin-badge-atencion">
          <FileText size={14} />
          {facturas.length === 1
            ? "1 FACTURA DE PROVEEDOR POR CONFIRMAR"
            : `${facturas.length} FACTURAS DE PROVEEDOR POR CONFIRMAR`}
        </span>
      </div>

      <p className="prose" style={{ marginTop: 10 }}>
        Las leyó EOS de un correo de un proveedor. Confirmalas para registrarlas como compra, o
        decí que no correspondían.
      </p>

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {facturas.map((factura) => (
          <div key={factura.id} className="field-row" style={{ gap: 10, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{formatearMonto(factura.total, factura.moneda)}</div>
              <div className="fin-sub">
                {factura.proveedor_nombre || "Proveedor sin identificar"}
                {factura.numero_documento ? ` · ${factura.numero_documento}` : ""}
                {!factura.empresa_id ? " · sin empresa resuelta, no se puede confirmar" : ""}
              </div>
            </div>
            <button
              type="button"
              className="fin-editar"
              aria-label="Confirmar como compra"
              title={factura.empresa_id ? "Sí, registrala como compra" : "Falta resolver la empresa"}
              disabled={resolviendo === factura.id || !factura.empresa_id}
              onClick={() => void resolver(factura, "confirmar")}
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              className="fin-editar"
              aria-label="No correspondía"
              title="No era una factura"
              disabled={resolviendo === factura.id}
              onClick={() => void resolver(factura, "descartar")}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
