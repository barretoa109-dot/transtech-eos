"use client";

import { useEffect, useState } from "react";
import { PackagePlus } from "lucide-react";

type Producto = {
  id: string;
  nombre: string;
  stock: number;
  dias_restantes: number;
  cantidad_sugerida: number;
};

/**
 * "EOS identificó una oportunidad": lo que propone reponer, y cuánto.
 *
 * Nivel 2 de autonomía (preparar y recomendar), no Nivel 3: esta tarjeta no
 * escribe nada ni queda pendiente de aprobar — es una lectura con una cuenta
 * hecha encima, para que comprar no empiece en "¿qué me estará por faltar?".
 * El pedido real lo carga el dueño donde ya carga sus compras.
 */
export default function PropuestaReposicion() {
  const [propuesta, setPropuesta] = useState<Producto[] | null>(null);

  useEffect(() => {
    fetch("/api/erp/reposicion", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then((data) => setPropuesta(data.propuesta ?? []))
      .catch(() => setPropuesta([]));
  }, []);

  if (!propuesta || propuesta.length === 0) return null;

  return (
    <div className="card fin-card">
      <div className="fin-head">
        <span className="fin-badge fin-badge-atencion">
          <PackagePlus size={14} />
          {propuesta.length === 1 ? "EOS PROPONE REPONER 1 PRODUCTO" : `EOS PROPONE REPONER ${propuesta.length} PRODUCTOS`}
        </span>
      </div>

      <p className="prose" style={{ marginTop: 10 }}>
        Según cómo vienen saliendo, se acaban antes de dos semanas. La cantidad es la que
        alcanza para cubrir ese plazo al ritmo actual — vos sabés si conviene pedir más o
        menos.
      </p>

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {propuesta.map((p) => (
          <div key={p.id} className="field-row" style={{ gap: 10, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{p.nombre}</div>
              <div className="fin-sub">
                Quedan {p.stock} · alcanza {p.dias_restantes === 1 ? "1 día" : `${p.dias_restantes} días`}
              </div>
            </div>
            <div style={{ fontWeight: 700, whiteSpace: "nowrap" }}>+{p.cantidad_sugerida}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
