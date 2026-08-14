"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, RefreshCw, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type AnyObject = Record<string, unknown>;

type UsageItem = {
  key: string;
  label: string;
  used: number;
  limit: number | null;
};

type CommercialState = {
  plan: string;
  status: string;
  expiresAt: string | null;
  provider: string | null;
  usage: UsageItem[];
  messageQuotaScope: "daily" | "monthly" | null;
};

const EMPTY_STATE: CommercialState = {
  plan: "free",
  status: "active",
  expiresAt: null,
  provider: null,
  usage: [],
  messageQuotaScope: null,
};

export default function PlanUsageCard() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [commercial, setCommercial] = useState<CommercialState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCommercialState = useCallback(
    async (id: string, silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);

      setError(null);

      const { data, error: rpcError } = await supabase.rpc(
        "obtener_estado_comercial_eos",
        { p_usuario_id: id },
      );

      if (rpcError) {
        console.error("No se pudo cargar el estado comercial de EOS:", rpcError);
        setError("No pudimos cargar los datos del plan en este momento.");
      } else {
        setCommercial(normalizeCommercialState(data));
      }

      setLoading(false);
      setRefreshing(false);
    },
    [supabase],
  );

  useEffect(() => {
    let active = true;

    async function initialize() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!active) return;

      if (!user) {
        setLoading(false);
        return;
      }

      setUserId(user.id);
      await loadCommercialState(user.id);
    }

    initialize();

    return () => {
      active = false;
    };
  }, [loadCommercialState, supabase]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`eos-commercial-card-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "usuarios",
          filter: `id=eq.${userId}`,
        },
        () => loadCommercialState(userId, true),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "uso_mensual",
          filter: `usuario_id=eq.${userId}`,
        },
        () => loadCommercialState(userId, true),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadCommercialState, supabase, userId]);

  useEffect(() => {
    if (!userId) return;

    const refreshFromChat = () => loadCommercialState(userId, true);
    window.addEventListener("eos:usage-changed", refreshFromChat);

    return () => {
      window.removeEventListener("eos:usage-changed", refreshFromChat);
    };
  }, [loadCommercialState, userId]);

  const visibleUsage = commercial.usage.length
    ? commercial.usage
    : [
        { key: "mensaje", label: "Mensajes", used: 0, limit: null },
        { key: "excel", label: "Excel", used: 0, limit: null },
        { key: "pdf", label: "PDF", used: 0, limit: null },
        {
          key: "automatizacion",
          label: "Automatizaciones",
          used: 0,
          limit: null,
        },
      ];

  return (
    <section className="plan-card" aria-label="Plan y consumo de EOS">
      <div className="plan-card-top">
        <div>
          <span className="plan-eyebrow">PLAN Y CONSUMO</span>
          <h2>EOS {capitalize(commercial.plan)}</h2>
          <p>
            {loading
              ? "Cargando información comercial..."
              : getStatusDescription(commercial.status, commercial.expiresAt)}
          </p>
        </div>

        <div className="plan-actions">
          <span className={`plan-status ${isActive(commercial.status) ? "active" : "inactive"}`}>
            <ShieldCheck size={15} />
            {capitalizeStatus(commercial.status)}
          </span>

          <button
            type="button"
            className="refresh-button"
            onClick={() => userId && loadCommercialState(userId, true)}
            disabled={!userId || refreshing}
            aria-label="Actualizar datos del plan"
            title="Actualizar datos del plan"
          >
            <RefreshCw size={16} className={refreshing ? "spinning" : ""} />
          </button>
        </div>
      </div>

      {error ? <div className="plan-error">{error}</div> : null}

      <div className="usage-grid">
        {visibleUsage.map((item) => (
          <UsageBar key={item.key} item={item} loading={loading} />
        ))}
      </div>

      <div className="plan-footer">
        <div className="billing-data">
          <span>
            <strong>Vencimiento:</strong> {formatDate(commercial.expiresAt)}
          </span>
          <span>
            <strong>Pago:</strong> {commercial.provider ? capitalize(commercial.provider) : "Sin registrar"}
          </span>
        </div>

        <button
          type="button"
          className="manage-button"
          onClick={() => router.push("/planes")}
        >
          <CreditCard size={17} />
          Administrar plan
        </button>
      </div>

      <style jsx>{`
        .plan-card {
          margin-top: 22px;
          padding: 28px;
          border: 1px solid rgba(37, 99, 235, 0.16);
          border-radius: 28px;
          background: rgba(255, 255, 255, 0.94);
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.07);
          backdrop-filter: blur(20px);
        }

        .plan-card-top,
        .plan-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
        }

        .plan-eyebrow {
          color: #2563eb;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.16em;
        }

        h2 {
          margin: 8px 0 0;
          color: #071226;
          font-size: 29px;
          font-weight: 900;
          letter-spacing: -0.035em;
        }

        p {
          margin: 8px 0 0;
          color: #64748b;
          font-size: 12px;
          line-height: 1.6;
        }

        .plan-actions {
          display: flex;
          align-items: center;
          gap: 9px;
        }

        .plan-status {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 10px 13px;
          border: 1px solid #e2e8f0;
          border-radius: 999px;
          background: #f8fafc;
          color: #64748b;
          font-size: 10px;
          font-weight: 850;
        }

        .plan-status.active {
          border-color: #bbf7d0;
          background: #f0fdf4;
          color: #15803d;
        }

        .plan-status.inactive {
          border-color: #fecaca;
          background: #fef2f2;
          color: #b91c1c;
        }

        .refresh-button {
          width: 38px;
          height: 38px;
          display: grid;
          place-items: center;
          border: 1px solid #dbeafe;
          border-radius: 12px;
          background: #eff6ff;
          color: #2563eb;
          cursor: pointer;
        }

        .refresh-button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .spinning {
          animation: spin 0.8s linear infinite;
        }

        .plan-error {
          margin-top: 16px;
          padding: 12px 14px;
          border: 1px solid #fecaca;
          border-radius: 13px;
          background: #fef2f2;
          color: #b91c1c;
          font-size: 11px;
          font-weight: 700;
        }

        .usage-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          margin-top: 24px;
        }

        .plan-footer {
          margin-top: 22px;
          padding-top: 20px;
          border-top: 1px solid #e8eef7;
        }

        .billing-data {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 18px;
          color: #64748b;
          font-size: 10px;
        }

        .billing-data strong {
          color: #334155;
        }

        .manage-button {
          min-height: 43px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 0 17px;
          border: 0;
          border-radius: 999px;
          background: #2563eb;
          color: white;
          font-family: inherit;
          font-size: 11px;
          font-weight: 850;
          cursor: pointer;
          box-shadow: 0 13px 28px rgba(37, 99, 235, 0.22);
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 760px) {
          .plan-card {
            padding: 22px;
          }

          .plan-card-top,
          .plan-footer {
            align-items: flex-start;
            flex-direction: column;
          }

          .usage-grid {
            grid-template-columns: 1fr;
          }

          .manage-button {
            width: 100%;
          }
        }
      `}</style>
    </section>
  );
}

function UsageBar({ item, loading }: { item: UsageItem; loading: boolean }) {
  const hasLimit = typeof item.limit === "number" && item.limit > 0;
  const percentage = hasLimit
    ? Math.min(100, Math.round((item.used / (item.limit as number)) * 100))
    : 0;

  return (
    <article className="usage-item">
      <div className="usage-header">
        <span>{item.label}</span>
        <strong>
          {loading ? "—" : item.used.toLocaleString("es-PY")}
          {hasLimit ? ` / ${(item.limit as number).toLocaleString("es-PY")}` : ""}
        </strong>
      </div>

      <div className="usage-track">
        <div className="usage-value" style={{ width: `${percentage}%` }} />
      </div>

      <style jsx>{`
        .usage-item {
          min-width: 0;
          padding: 16px;
          border: 1px solid #e2e8f0;
          border-radius: 17px;
          background: #f8fafc;
        }

        .usage-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .usage-header span {
          color: #64748b;
          font-size: 10px;
          font-weight: 750;
        }

        .usage-header strong {
          color: #071226;
          font-size: 11px;
          font-weight: 900;
        }

        .usage-track {
          height: 8px;
          overflow: hidden;
          margin-top: 11px;
          border-radius: 999px;
          background: #e2e8f0;
        }

        .usage-value {
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #2563eb, #60a5fa);
          transition: width 600ms ease;
        }
      `}</style>
    </article>
  );
}

function normalizeCommercialState(raw: unknown): CommercialState {
  const root = unwrapObject(raw);
  const subscription = objectFrom(
    root.suscripcion,
    root.subscription,
    root.plan_actual,
    root,
  );
  const limits = objectFrom(root.limites, root.limits, subscription.limites);
  const usage = objectFrom(root.uso, root.consumo, root.usage, subscription.uso);
  const messageQuota = objectFrom(root.cuota_mensajes);
  const messageQuotaScope = stringFrom(messageQuota.scope);

  return {
    plan: stringFrom(
      subscription.plan,
      subscription.plan_codigo,
      root.plan,
      root.plan_codigo,
      "free",
    ),
    status: stringFrom(
      subscription.estado,
      subscription.status,
      root.estado,
      root.status,
      "active",
    ),
    expiresAt: nullableStringFrom(
      subscription.plan_vencimiento,
      subscription.fecha_vencimiento,
      subscription.vence_en,
      root.plan_vencimiento,
      root.fecha_vencimiento,
    ),
    provider: nullableStringFrom(
      subscription.proveedor_pago,
      subscription.proveedor,
      root.proveedor_pago,
      root.proveedor,
    ),
    usage: buildUsageItems(
      usage,
      limits,
      messageQuotaScope === "daily" || messageQuotaScope === "monthly"
        ? messageQuotaScope
        : null,
    ),
    messageQuotaScope:
      messageQuotaScope === "daily" || messageQuotaScope === "monthly"
        ? messageQuotaScope
        : null,
  };
}

function buildUsageItems(
  usage: AnyObject,
  limits: AnyObject,
  messageQuotaScope: "daily" | "monthly" | null,
): UsageItem[] {
  const definitions = [
    {
      key: "mensaje",
      label:
        messageQuotaScope === "daily"
          ? "Mensajes hoy"
          : messageQuotaScope === "monthly"
            ? "Mensajes este mes"
            : "Mensajes",
      used: ["mensajes", "mensaje", "mensajes_usados"],
      limit: ["mensajes", "limite_mensajes", "mensajes_limite"],
    },
    {
      key: "excel",
      label: "Excel",
      used: ["excel", "excels", "excel_usados"],
      limit: ["excel", "limite_excel", "excel_limite"],
    },
    {
      key: "pdf",
      label: "PDF",
      used: ["pdf", "pdfs", "pdf_usados"],
      limit: ["pdf", "limite_pdf", "pdf_limite"],
    },
    {
      key: "automatizacion",
      label: "Automatizaciones",
      used: ["automatizaciones", "automatizacion", "automatizaciones_usadas"],
      limit: ["automatizaciones", "limite_automatizaciones", "automatizaciones_limite"],
    },
  ];

  return definitions.map((definition) => ({
    key: definition.key,
    label: definition.label,
    used: numberFromKeys(usage, definition.used) ?? 0,
    limit: numberFromKeys(limits, definition.limit),
  }));
}

function unwrapObject(value: unknown): AnyObject {
  if (Array.isArray(value)) return unwrapObject(value[0]);
  if (value && typeof value === "object") return value as AnyObject;
  return {};
}

function objectFrom(...values: unknown[]): AnyObject {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as AnyObject;
    }
  }
  return {};
}

function stringFrom(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function nullableStringFrom(...values: unknown[]): string | null {
  const value = stringFrom(...values);
  return value || null;
}

function numberFromKeys(source: AnyObject, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isActive(status: string): boolean {
  return ["active", "activo", "trialing", "vigente"].includes(status.toLowerCase());
}

function capitalize(value: string): string {
  if (!value) return "Free";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function capitalizeStatus(value: string): string {
  const normalized = value.toLowerCase();
  if (["active", "activo", "vigente"].includes(normalized)) return "Activo";
  if (["trialing", "prueba"].includes(normalized)) return "Prueba";
  if (["past_due", "vencido"].includes(normalized)) return "Vencido";
  if (["canceled", "cancelled", "cancelado"].includes(normalized)) return "Cancelado";
  return capitalize(value || "Activo");
}

function getStatusDescription(status: string, expiresAt: string | null): string {
  const statusLabel = capitalizeStatus(status);
  if (expiresAt) return `${statusLabel}. Vigente hasta el ${formatDate(expiresAt)}.`;
  return `${statusLabel}.`;
}

function formatDate(value: string | null): string {
  if (!value) return "Sin vencimiento registrado";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("es-PY", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}