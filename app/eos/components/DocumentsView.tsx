"use client";

import {
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { DocumentoAdjunto } from "../types/chat";

type DocumentRow = {
  id: string;
  nombre: string;
  mime_type: string;
  extension: string | null;
  size_bytes: number | null;
  source: string;
  document_type: string;
  extraction_status: string;
  intelligence_status: string;
  summary: string | null;
  confidence: number | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};

type DocumentsViewProps = {
  onUseInChat: (documento: DocumentoAdjunto) => void;
};

function statusLabel(value: string) {
  if (value === "ready") return "Listo";
  if (value === "processing") return "Procesando";
  if (value === "partial") return "Parcial";
  if (value === "unsupported") return "Pendiente";
  if (value === "error") return "Error";
  return "Pendiente";
}

function sizeLabel(bytes: number | null) {
  if (!bytes || bytes <= 0) return "Tamaño no disponible";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";

  return date.toLocaleDateString("es-PY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function DocumentIcon({ type }: { type: string }) {
  if (type === "spreadsheet") return <FileSpreadsheet size={20} />;
  if (type === "image") return <ImageIcon size={20} />;
  return <FileText size={20} />;
}

export default function DocumentsView({ onUseInChat }: DocumentsViewProps) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadDocuments = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const response = await fetch("/api/documents?limit=80", {
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || "No se pudieron cargar los documentos.");
      }

      setDocuments(Array.isArray(data?.documents) ? data.documents : []);
      setError("");
    } catch (loadError) {
      console.error("No se pudo cargar biblioteca documental:", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron cargar los documentos.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const stats = useMemo(() => {
    const analyzed = documents.filter(
      (document) => document.intelligence_status === "ready",
    ).length;
    const extracted = documents.filter((document) =>
      ["ready", "partial"].includes(document.extraction_status),
    ).length;

    return {
      total: documents.length,
      analyzed,
      extracted,
    };
  }, [documents]);

  async function analyze(document: DocumentRow) {
    if (analyzingId) return;

    if (!["ready", "partial"].includes(document.extraction_status)) {
      window.alert(
        "Este documento está almacenado, pero su texto todavía no puede extraerse automáticamente.",
      );
      return;
    }

    setAnalyzingId(document.id);

    try {
      const response = await fetch(`/api/documents/${document.id}/analyze`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || "No se pudo analizar el documento.");
      }

      await loadDocuments(true);
    } catch (analysisError) {
      console.error("No se pudo analizar documento:", analysisError);
      window.alert(
        analysisError instanceof Error
          ? analysisError.message
          : "No se pudo analizar el documento.",
      );
    } finally {
      setAnalyzingId(null);
    }
  }

  function useInChat(document: DocumentRow) {
    onUseInChat({
      id: document.id,
      nombre: document.nombre,
      tipo: document.mime_type,
      tamanio: Number(document.size_bytes || 0),
      document_type: document.document_type,
      extraction_status: document.extraction_status,
      intelligence_status: document.intelligence_status,
    });
  }

  return (
    <section className="documents-view">
      <div className="documents-shell">
        <div className="documents-header">
          <div>
            <span className="eyebrow">DOCUMENT INTELLIGENCE</span>
            <h1>Biblioteca de documentos</h1>
            <p>
              EOS organiza, analiza y reutiliza tus documentos como contexto
              operativo para decisiones y conversaciones futuras.
            </p>
          </div>

          <button
            type="button"
            className="refresh-button"
            onClick={() => void loadDocuments(true)}
            disabled={refreshing}
          >
            {refreshing ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            Actualizar
          </button>
        </div>

        <div className="stats-grid">
          <article>
            <strong>{stats.total}</strong>
            <span>Documentos</span>
          </article>
          <article>
            <strong>{stats.extracted}</strong>
            <span>Con texto extraído</span>
          </article>
          <article>
            <strong>{stats.analyzed}</strong>
            <span>Analizados por EOS</span>
          </article>
          <article className="security-card">
            <ShieldCheck size={20} />
            <div>
              <strong>Privado</strong>
              <span>Aislado por usuario</span>
            </div>
          </article>
        </div>

        {loading ? (
          <div className="state-card">
            <LoaderCircle size={24} className="spin" />
            <strong>Cargando documentos...</strong>
          </div>
        ) : error ? (
          <div className="state-card error-card">
            <strong>{error}</strong>
            <button type="button" onClick={() => void loadDocuments()}>
              Reintentar
            </button>
          </div>
        ) : documents.length === 0 ? (
          <div className="state-card">
            <FileText size={28} />
            <strong>Todavía no hay documentos</strong>
            <p>
              Adjuntá un TXT, CSV, JSON, Excel o PDF desde el clip del chat y
              aparecerá aquí automáticamente.
            </p>
          </div>
        ) : (
          <div className="document-grid">
            {documents.map((document) => (
              <article key={document.id} className="document-card">
                <div className="document-topline">
                  <span className="document-icon">
                    <DocumentIcon type={document.document_type} />
                  </span>

                  <span className="document-date">
                    {dateLabel(document.created_at)}
                  </span>
                </div>

                <div className="document-copy">
                  <h2 title={document.nombre}>{document.nombre}</h2>
                  <p>
                    {document.summary?.trim() ||
                      "EOS todavía no generó un resumen para este documento."}
                  </p>
                </div>

                <div className="document-meta">
                  <span>{document.document_type || "documento"}</span>
                  <span>{sizeLabel(document.size_bytes)}</span>
                </div>

                <div className="status-row">
                  <span>
                    Extracción: <b>{statusLabel(document.extraction_status)}</b>
                  </span>
                  <span>
                    Inteligencia:{" "}
                    <b>{statusLabel(document.intelligence_status)}</b>
                  </span>
                </div>

                <div className="document-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void analyze(document)}
                    disabled={analyzingId === document.id}
                  >
                    {analyzingId === document.id ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <RefreshCw size={15} />
                    )}
                    {document.intelligence_status === "ready"
                      ? "Reanalizar"
                      : "Analizar"}
                  </button>

                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => useInChat(document)}
                  >
                    <MessageSquareText size={15} />
                    Usar en chat
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
        .documents-view {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          padding: 34px;
          background:
            radial-gradient(circle at 88% 8%, rgba(37, 99, 235, 0.12), transparent 28%),
            linear-gradient(180deg, #07101d 0%, #091524 100%);
          color: #e5eefb;
        }

        .documents-shell {
          width: min(1180px, 100%);
          margin: 0 auto;
        }

        .documents-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
        }

        .eyebrow {
          color: #60a5fa;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.16em;
        }

        h1 {
          margin: 8px 0 0;
          color: #ffffff;
          font-size: clamp(25px, 3vw, 38px);
          letter-spacing: -0.04em;
        }

        .documents-header p {
          max-width: 720px;
          margin: 10px 0 0;
          color: #94a3b8;
          font-size: 13px;
          line-height: 1.7;
        }

        .refresh-button,
        .secondary-button,
        .primary-button,
        .state-card button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border: 0;
          font-family: inherit;
          font-weight: 800;
          cursor: pointer;
        }

        .refresh-button {
          flex-shrink: 0;
          padding: 11px 15px;
          border: 1px solid rgba(96, 165, 250, 0.26);
          border-radius: 12px;
          background: rgba(37, 99, 235, 0.12);
          color: #bfdbfe;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin-top: 26px;
        }

        .stats-grid article {
          min-height: 88px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 16px;
          border: 1px solid rgba(148, 163, 184, 0.13);
          border-radius: 17px;
          background: rgba(15, 23, 42, 0.54);
          box-shadow: 0 18px 45px rgba(0, 0, 0, 0.12);
        }

        .stats-grid strong {
          color: #ffffff;
          font-size: 24px;
        }

        .stats-grid span {
          margin-top: 5px;
          color: #8292a7;
          font-size: 10px;
          font-weight: 750;
        }

        .stats-grid .security-card {
          flex-direction: row;
          align-items: center;
          justify-content: flex-start;
          gap: 12px;
          color: #60a5fa;
        }

        .security-card div {
          display: flex;
          flex-direction: column;
        }

        .security-card strong {
          font-size: 14px;
        }

        .security-card span {
          margin-top: 2px;
        }

        .document-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 15px;
          margin-top: 18px;
          padding-bottom: 32px;
        }

        .document-card {
          display: flex;
          flex-direction: column;
          min-height: 285px;
          padding: 18px;
          border: 1px solid rgba(148, 163, 184, 0.14);
          border-radius: 19px;
          background: rgba(10, 22, 39, 0.78);
          box-shadow: 0 18px 55px rgba(0, 0, 0, 0.15);
        }

        .document-topline,
        .document-meta,
        .status-row,
        .document-actions {
          display: flex;
          align-items: center;
        }

        .document-topline {
          justify-content: space-between;
          gap: 12px;
        }

        .document-icon {
          width: 41px;
          height: 41px;
          display: grid;
          place-items: center;
          border-radius: 12px;
          background: rgba(37, 99, 235, 0.15);
          color: #60a5fa;
        }

        .document-date {
          color: #64748b;
          font-size: 9px;
          font-weight: 800;
        }

        .document-copy {
          flex: 1;
          margin-top: 14px;
        }

        .document-copy h2 {
          overflow: hidden;
          margin: 0;
          color: #f8fafc;
          font-size: 15px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .document-copy p {
          display: -webkit-box;
          overflow: hidden;
          margin: 9px 0 0;
          color: #8b9bb0;
          font-size: 11px;
          line-height: 1.6;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 4;
        }

        .document-meta {
          flex-wrap: wrap;
          gap: 7px;
          margin-top: 14px;
        }

        .document-meta span {
          padding: 5px 8px;
          border: 1px solid rgba(148, 163, 184, 0.12);
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.06);
          color: #94a3b8;
          font-size: 8px;
          font-weight: 800;
        }

        .status-row {
          justify-content: space-between;
          gap: 12px;
          margin-top: 13px;
          padding-top: 12px;
          border-top: 1px solid rgba(148, 163, 184, 0.1);
          color: #64748b;
          font-size: 8px;
        }

        .status-row b {
          color: #bfdbfe;
        }

        .document-actions {
          gap: 9px;
          margin-top: 15px;
        }

        .secondary-button,
        .primary-button {
          min-height: 37px;
          flex: 1;
          border-radius: 11px;
          font-size: 9px;
        }

        .secondary-button {
          border: 1px solid rgba(148, 163, 184, 0.16);
          background: rgba(148, 163, 184, 0.06);
          color: #cbd5e1;
        }

        .primary-button {
          background: #2563eb;
          color: #ffffff;
        }

        .state-card {
          min-height: 250px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          margin-top: 18px;
          padding: 28px;
          border: 1px solid rgba(148, 163, 184, 0.14);
          border-radius: 20px;
          background: rgba(15, 23, 42, 0.52);
          color: #94a3b8;
          text-align: center;
        }

        .state-card strong {
          color: #e2e8f0;
          font-size: 13px;
        }

        .state-card p {
          max-width: 520px;
          margin: 0;
          font-size: 11px;
          line-height: 1.6;
        }

        .state-card button {
          margin-top: 5px;
          padding: 9px 13px;
          border-radius: 10px;
          background: #2563eb;
          color: white;
        }

        .error-card strong {
          color: #fca5a5;
        }

        .spin {
          animation: spin 0.9s linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 900px) {
          .stats-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .document-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 640px) {
          .documents-view {
            padding: 24px 14px;
          }

          .documents-header {
            flex-direction: column;
          }

          .refresh-button {
            align-self: flex-start;
          }

          .stats-grid {
            grid-template-columns: 1fr 1fr;
          }

          .status-row {
            align-items: flex-start;
            flex-direction: column;
          }
        }
      `}</style>
    </section>
  );
}
