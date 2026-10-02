"use client";

import { useState } from "react";
import { Check, Flag } from "lucide-react";

import { estaEnAppNativa } from "@/lib/app-nativa/cliente";
import { MOTIVOS, type Motivo } from "@/lib/eos/reporte-respuesta";

/*
 * "Reportar" debajo de cada respuesta de EOS (01/10/2026).
 *
 * Lo exige la política de Google Play para apps con IA generativa: reportar
 * una respuesta ofensiva o dañina sin salir de la app. Está en la web y en la
 * app (no va dentro de SoloEnWeb). Estilos globales en eosApp.css: los de
 * styled-jsx de MessageBubble no llegan a un componente propio.
 */
export default function ReportarRespuesta({ mensajeId, texto }: { mensajeId: string; texto: string }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState<Motivo | null>(null);
  const [comentario, setComentario] = useState("");
  const [estado, setEstado] = useState<"listo" | "enviando" | "enviado" | "error">("listo");

  async function enviar() {
    if (!motivo || estado === "enviando") return;
    setEstado("enviando");
    try {
      const r = await fetch("/api/eos/reportar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          motivo,
          comentario: comentario.trim() || undefined,
          mensaje_id: mensajeId,
          extracto: texto.slice(0, 2000),
          canal: estaEnAppNativa() ? "app" : "web",
        }),
      });
      setEstado(r.ok ? "enviado" : "error");
      if (r.ok) setAbierto(false);
    } catch {
      setEstado("error");
    }
  }

  if (estado === "enviado") {
    return (
      <span className="reportar-gracias" role="status">
        <Check size={13} aria-hidden="true" /> Gracias, lo vamos a revisar
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="reportar-boton"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-label="Reportar esta respuesta de EOS"
      >
        <Flag size={13} aria-hidden="true" />
        <span>Reportar</span>
      </button>

      {abierto ? (
        <div className="reportar-panel" role="dialog" aria-label="Reportar esta respuesta">
          <p className="reportar-titulo">¿Qué tiene de malo esta respuesta?</p>
          <div className="reportar-motivos">
            {(Object.keys(MOTIVOS) as Motivo[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`reportar-motivo ${motivo === m ? "reportar-motivo-elegido" : ""}`}
                aria-pressed={motivo === m}
                onClick={() => setMotivo(m)}
              >
                {MOTIVOS[m]}
              </button>
            ))}
          </div>
          <textarea
            className="reportar-comentario"
            placeholder="Contanos más (opcional)"
            maxLength={1000}
            rows={2}
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
          />
          {estado === "error" ? <p className="reportar-error">No se pudo enviar. Probá de nuevo.</p> : null}
          <div className="reportar-acciones">
            <button type="button" className="reportar-cancelar" onClick={() => setAbierto(false)}>
              Cancelar
            </button>
            <button type="button" className="reportar-enviar" disabled={!motivo || estado === "enviando"} onClick={enviar}>
              {estado === "enviando" ? "Enviando…" : "Enviar reporte"}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
