"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import type { PlantillaWA } from "./PlantillasWA";

/**
 * La caja para contestarle a un cliente desde el hilo.
 *
 * Manda a `POST /api/crm/whatsapp/enviar`. Todas las reglas —consentimiento,
 * ventana de 24 horas, límites— las aplica el servidor; lo que no pueda salir
 * vuelve con su motivo en castellano y se muestra tal cual. Esta pantalla no
 * intenta adivinar si se puede: pregunta y cuenta la respuesta.
 *
 * La `clave` se genera UNA vez por mensaje: si la persona toca dos veces el botón, o
 * la red repite el pedido, el servidor reconoce la clave y no manda dos veces.
 */

type Props = {
  contactoId: string;
  nombre: string;
  plantillas: PlantillaWA[];
  bloqueado?: string;
  onEnviado: () => void;
};

export default function ResponderWA({ contactoId, nombre, plantillas, bloqueado, onEnviado }: Props) {
  const aprobadas = plantillas.filter((p) => p.estado === "aprobada");

  const [modo, setModo] = useState<"texto" | "plantilla">("texto");
  const [texto, setTexto] = useState("");
  const [plantillaId, setPlantillaId] = useState(aprobadas[0]?.id ?? "");
  const [variables, setVariables] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [clave, setClave] = useState(() => crypto.randomUUID());

  const plantilla = aprobadas.find((p) => p.id === plantillaId);

  function elegirPlantilla(id: string) {
    setPlantillaId(id);
    const p = aprobadas.find((x) => x.id === id);
    setVariables(Array.from({ length: p?.cantidad_variables ?? 0 }, (_, i) => (i === 0 ? nombre : "")));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;

    setEnviando(true);
    setError("");

    try {
      const r = await fetch("/api/crm/whatsapp/enviar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          modo === "plantilla"
            ? { contacto_id: contactoId, clave, plantilla_id: plantillaId, variables }
            : { contacto_id: contactoId, clave, texto },
        ),
      });
      const datos = await r.json().catch(() => null);

      if (!r.ok) {
        setError(datos?.error || "No se pudo enviar el mensaje.");
        // Un intento que falló no se repite con la misma clave: el servidor lo recordaría como ya procesado.
        setClave(crypto.randomUUID());
        return;
      }

      setTexto("");
      setClave(crypto.randomUUID());
      onEnviado();
    } catch {
      setError("No pudimos comunicarnos con el servidor. Reintentá en un momento.");
      setClave(crypto.randomUUID());
    } finally {
      setEnviando(false);
    }
  }

  if (bloqueado) {
    return <p className="prose" style={{ fontSize: 13, color: "var(--muted)", marginTop: 12 }}>{bloqueado}</p>;
  }

  return (
    <form onSubmit={enviar} style={{ marginTop: 12, borderTop: "1px solid var(--line-soft)", paddingTop: 12 }}>
      {aprobadas.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <button type="button" className={`chip ${modo === "texto" ? "active" : ""}`} onClick={() => setModo("texto")}>
            Mensaje
          </button>
          <button
            type="button"
            className={`chip ${modo === "plantilla" ? "active" : ""}`}
            onClick={() => {
              setModo("plantilla");
              if (!variables.length) elegirPlantilla(plantillaId || aprobadas[0].id);
            }}
          >
            Plantilla
          </button>
        </div>
      )}

      {modo === "texto" ? (
        <textarea
          className="neg-input"
          rows={3}
          maxLength={1000}
          placeholder={`Escribile a ${nombre}…`}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          style={{ width: "100%" }}
        />
      ) : (
        <>
          <select className="neg-input" value={plantillaId} onChange={(e) => elegirPlantilla(e.target.value)} style={{ width: "100%", marginBottom: 8 }}>
            {aprobadas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
          {plantilla && <p style={{ fontSize: 13, color: "var(--muted)", whiteSpace: "pre-wrap" }}>{plantilla.cuerpo}</p>}
          {variables.map((v, i) => (
            <input
              key={i}
              className="neg-input"
              placeholder={`Dato ${i + 1}`}
              value={v}
              onChange={(e) => setVariables((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
              style={{ width: "100%", marginBottom: 6 }}
            />
          ))}
        </>
      )}

      {error && (
        <p className="neg-error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        className="reco-btn"
        disabled={enviando || (modo === "texto" ? !texto.trim() : !plantilla || variables.some((v) => !v.trim()))}
        style={{ marginTop: 8, display: "inline-flex", gap: 6, alignItems: "center" }}
      >
        <Send size={14} /> {enviando ? "Enviando…" : "Enviar"}
      </button>
    </form>
  );
}
