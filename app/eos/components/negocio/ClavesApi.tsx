"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Trash2 } from "lucide-react";

/**
 * Las claves de API del Developer Platform (ítem 25, primera pieza, solo
 * lectura): `/api/v1/publico/saldo`, `/ventas` y `/cartera`. Ver
 * `docs/arquitectura-developer-platform-2026-11-07.md`.
 *
 * El valor de la clave se muestra UNA sola vez, apenas se crea — después,
 * ni esta pantalla ni la base lo vuelven a tener. Si se pierde, no hay
 * forma de recuperarlo: se crea una nueva y se revoca la vieja.
 */

type Clave = {
  id: string;
  nombre: string;
  prefijo: string;
  creado_en: string;
  ultimo_uso_en: string | null;
  revocada_en: string | null;
};

function fecha(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ClavesApi({ puedoAdministrar }: { puedoAdministrar: boolean }) {
  const [claves, setClaves] = useState<Clave[] | null>(null);
  const [error, setError] = useState("");
  const [nombre, setNombre] = useState("");
  const [creando, setCreando] = useState(false);
  const [recienCreada, setRecienCreada] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(() => {
    fetch("/api/desarrollador/claves", { cache: "no-store" })
      .then(async (r) => {
        const cuerpo = await r.json().catch(() => null);
        if (!r.ok) throw new Error(cuerpo?.error || "No pudimos leer tus claves.");
        setClaves(cuerpo.claves as Clave[]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No pudimos leer tus claves."));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function crear() {
    setCreando(true);
    setError("");
    setRecienCreada(null);
    setCopiado(false);

    try {
      const r = await fetch("/api/desarrollador/claves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim() || undefined }),
      });
      const cuerpo = await r.json().catch(() => null);
      if (!r.ok) throw new Error(cuerpo?.error || "No pudimos crear la clave.");
      setRecienCreada(cuerpo.clave as string);
      setNombre("");
      cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos crear la clave.");
    } finally {
      setCreando(false);
    }
  }

  async function revocar(id: string) {
    if (!confirm("¿Revocar esta clave? Cualquier sistema que la use deja de poder leer tus datos.")) return;

    try {
      const r = await fetch(`/api/desarrollador/claves/${id}`, { method: "DELETE" });
      const cuerpo = await r.json().catch(() => null);
      if (!r.ok) throw new Error(cuerpo?.error || "No pudimos revocarla.");
      cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos revocarla.");
    }
  }

  function copiar(valor: string) {
    navigator.clipboard?.writeText(valor).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  }

  if (!puedoAdministrar) {
    return <p className="empty-note">Solo el dueño o un administrador del negocio ven y crean claves de API.</p>;
  }

  return (
    <div className="card">
      <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <KeyRound size={16} /> Claves de API
      </div>
      <div className="card-sub">
        Para leer tus datos desde otro sistema (tu contador, tu propia planilla) sin entrar al panel. Solo lectura:
        saldo, ventas y cartera.
      </div>

      {recienCreada && (
        <div className="neg-load-error" role="alert" style={{ marginTop: 10, borderColor: "var(--blue)" }}>
          <div>
            <strong>Copiá esta clave ahora — no se va a volver a mostrar.</strong>
            <div className="field-row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <code style={{ wordBreak: "break-all", fontSize: 13 }}>{recienCreada}</code>
              <button type="button" className="chip" onClick={() => copiar(recienCreada)}>
                <Copy size={13} /> {copiado ? "Copiada" : "Copiar"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="field-row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <input
          className="neg-input"
          style={{ flex: 1, minWidth: 160 }}
          placeholder="Nombre (ej: Contador, Planilla)"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
        <button type="button" className="chip active" disabled={creando} onClick={crear}>
          {creando ? "Creando…" : "Nueva clave"}
        </button>
      </div>

      {error && (
        <p className="neg-error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}

      {claves === null ? (
        <p className="empty-note" style={{ marginTop: 10 }}>
          Cargando…
        </p>
      ) : claves.length === 0 ? (
        <p className="empty-note" style={{ marginTop: 10 }}>
          Todavía no creaste ninguna clave.
        </p>
      ) : (
        <div className="funciones-lista" style={{ marginTop: 10 }}>
          {claves.map((c) => (
            <div className="funcion-fila" key={c.id}>
              <div>
                <div className="funcion-nombre">
                  {c.nombre} <code style={{ fontSize: 12, color: "var(--muted)" }}>{c.prefijo}…</code>
                </div>
                <div className="funcion-detalle">
                  {c.revocada_en
                    ? `Revocada el ${fecha(c.revocada_en)}`
                    : `Creada el ${fecha(c.creado_en)} · Último uso: ${fecha(c.ultimo_uso_en)}`}
                </div>
              </div>
              {!c.revocada_en && (
                <button type="button" className="chip" onClick={() => revocar(c.id)}>
                  <Trash2 size={13} /> Revocar
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
