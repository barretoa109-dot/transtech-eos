"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, MessageCircle } from "lucide-react";

/**
 * Vincular WhatsApp como canal de EOS.
 *
 * El código es la prueba de que el número es de esta cuenta —ver
 * `app/api/whatsapp/vincular/route.ts`—, así que acá solo se pide, se
 * muestra y se cancela. Confirmarlo pasa por mandarlo desde WhatsApp, no
 * desde acá.
 */

type Estado = {
  vinculado: boolean;
  telefono_enmascarado: string | null;
  codigo_pendiente: boolean;
  numero_whatsapp_eos: string | null;
};

export default function VincularWhatsApp() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [codigo, setCodigo] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [pidiendo, setPidiendo] = useState(false);
  const [desvinculando, setDesvinculando] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      const respuesta = await fetch("/api/whatsapp/vincular", { cache: "no-store" });
      if (!respuesta.ok) throw new Error();
      setEstado(await respuesta.json());
      setError("");
    } catch {
      setError("No pudimos consultar tu vínculo de WhatsApp.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function pedirCodigo() {
    setPidiendo(true);
    setError("");

    try {
      const respuesta = await fetch("/api/whatsapp/vincular", { method: "POST" });
      const datos = await respuesta.json();

      if (!respuesta.ok) throw new Error(datos?.error || "No pudimos generar el código.");

      setCodigo(datos.codigo);
      setEstado((prev) => ({
        vinculado: false,
        telefono_enmascarado: null,
        codigo_pendiente: true,
        numero_whatsapp_eos: datos.numero_whatsapp_eos ?? prev?.numero_whatsapp_eos ?? null,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos generar el código.");
    } finally {
      setPidiendo(false);
    }
  }

  async function desvincular() {
    setDesvinculando(true);
    setError("");

    try {
      const respuesta = await fetch("/api/whatsapp/vincular", { method: "DELETE" });
      if (!respuesta.ok) throw new Error("No pudimos desvincular tu WhatsApp.");

      setCodigo("");
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos desvincular tu WhatsApp.");
    } finally {
      setDesvinculando(false);
    }
  }

  async function copiarCodigo() {
    if (!codigo || !navigator.clipboard) return;

    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1800);
    } catch (err) {
      console.error("No se pudo copiar el código:", err);
    }
  }

  const numeroEOS = estado?.numero_whatsapp_eos;

  return (
    <div className="card">
      <div className="card-title">
        <MessageCircle size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
        WhatsApp
      </div>

      {cargando ? (
        <p className="empty-note">Cargando…</p>
      ) : estado?.vinculado ? (
        <>
          <div className="field-row">
            <span className="field-label">
              Número vinculado
              <span className="field-hint">Podés escribirle a EOS por WhatsApp con las mismas funciones que acá</span>
            </span>
            <span className="field-value">{estado.telefono_enmascarado}</span>
          </div>
          <button type="button" className="chip is-danger" disabled={desvinculando} onClick={desvincular}>
            {desvinculando ? "Desvinculando…" : "Desvincular"}
          </button>
        </>
      ) : codigo ? (
        <>
          <p className="empty-note">
            {numeroEOS
              ? `Mandá este código por WhatsApp al ${numeroEOS} para vincular tu cuenta.`
              : "Mandá este código desde WhatsApp al número de EOS para vincular tu cuenta."}
            {" "}Vale por 10 minutos.
          </p>
          <button
            type="button"
            onClick={copiarCodigo}
            className="field-value"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 20,
              letterSpacing: 2,
              color: copiado ? "var(--green)" : "var(--blue)",
            }}
          >
            {copiado ? <Check size={15} /> : <Copy size={15} />}
            {codigo}
          </button>
        </>
      ) : (
        <>
          <p className="empty-note">
            Vinculá tu WhatsApp para hablar con EOS desde ahí: lo que anotes —una venta, un gasto,
            lo que sea— se guarda igual que acá y aparece en las mismas secciones.
          </p>
          <button type="button" className="reco-btn" disabled={pidiendo} onClick={pedirCodigo}>
            {pidiendo ? "Generando código…" : "Conectar WhatsApp"}
          </button>
        </>
      )}

      {error && <p className="anular-error" role="alert">{error}</p>}
    </div>
  );
}
