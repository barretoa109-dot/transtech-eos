"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  Briefing,
  BriefingApiResponse,
  BriefingItem,
  ScorePunto,
  SeriesScore,
} from "../types/briefing";

export function useBriefing(nombre: string) {
  const supabase = useMemo(() => createClient(), []);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [history, setHistory] = useState<Briefing[]>([]);
  // null = la API no mandó la serie; el Dashboard cae al historial corto.
  const [scoreHistory, setScoreHistory] = useState<ScorePunto[] | null>(null);
  const [scoreSeries, setScoreSeries] = useState<SeriesScore | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargarBriefing = useCallback(async (usuarioId?: string) => {
    void usuarioId;
    setRefreshing(true);

    try {
      const response = await fetch("/api/briefing", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const data = (await response.json()) as BriefingApiResponse;

      if (!response.ok) {
        throw new Error(data.error || "No pudimos cargar tu briefing.");
      }

      setBriefing(data.briefing ? normalizeBriefing(data.briefing) : null);
      setHistory((data.history ?? []).map(normalizeBriefing));
      setScoreHistory(
        Array.isArray(data.score_history)
          ? data.score_history
              .filter((p) => p && typeof p.fecha === "string" && Number.isFinite(p.score))
              .map((p) => ({ fecha: p.fecha, score: clampScore(p.score) }))
          : null,
      );
      setScoreSeries(
        data.score_series
          ? { negocio: limpiarSerie(data.score_series.negocio), personal: limpiarSerie(data.score_series.personal) }
          : null,
      );
      setIsStale(Boolean(data.is_stale));
      setError(null);
    } catch (loadError) {
      console.error("Error cargando briefing:", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No pudimos cargar tu briefing.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void cargarBriefing();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [cargarBriefing]);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void supabase.auth.getUser().then(({ data }) => {
      if (!active || !data.user) return;

      channel = supabase
        .channel(`eos-daily-briefing-${data.user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "eos_daily_briefings",
            filter: `usuario_id=eq.${data.user.id}`,
          },
          () => void cargarBriefing(),
        )
        .subscribe();
    });

    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [cargarBriefing, supabase]);

  const briefingVisible = useMemo<Briefing>(() => {
    const current = briefing ?? {};

    return {
      ...current,
      saludo: current.saludo || `Hola ${nombre}.`,
      titulo_dia: current.titulo_dia || "Tu foco para hoy",
      resumen:
        current.resumen ||
        "EOS está reuniendo tu contexto. Cuando registres objetivos, tareas y decisiones, acá vas a encontrar un panorama ejecutivo diario.",
      enfoque_dia:
        current.enfoque_dia ||
        "Definí el resultado más importante que querés conseguir hoy.",
      prioridad_1: current.prioridad_1 || "Definir qué querés mejorar",
      prioridad_2: current.prioridad_2 || "Ordenar la información disponible",
      prioridad_3: current.prioridad_3 || "Ejecutar el próximo paso concreto",
      recomendacion_principal:
        current.recomendacion_principal ||
        "Contale a EOS qué resultado necesitás lograr para construir un briefing más preciso.",
      logros: current.logros ?? [],
      riesgos: current.riesgos ?? [],
      proximos_pasos:
        current.proximos_pasos?.length
          ? current.proximos_pasos
          : [
              { titulo: "Compartí el contexto actual" },
              { titulo: "Definí una meta medible" },
              { titulo: "Ejecutá la primera acción" },
            ],
      fuentes: current.fuentes ?? {},
      score: clampScore(current.score),
    };
  }, [briefing, nombre]);

  return {
    briefing,
    briefingVisible,
    history,
    scoreHistory,
    scoreSeries,
    isStale,
    loading,
    refreshing,
    error,
    cargarBriefing,
    refresh: () => cargarBriefing(),
  };
}

function normalizeBriefing(value: Briefing): Briefing {
  return {
    ...value,
    logros: normalizeItems(value.logros),
    riesgos: normalizeItems(value.riesgos),
    proximos_pasos: normalizeItems(value.proximos_pasos),
    score: clampScore(value.score),
  };
}

function normalizeItems(value: unknown): BriefingItem[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") {
        return { titulo: item.trim() };
      }

      if (!item || typeof item !== "object") return null;
      const candidate = item as Record<string, unknown>;
      const titulo = String(candidate.titulo ?? candidate.texto ?? "").trim();
      if (!titulo) return null;

      return {
        titulo,
        descripcion: candidate.descripcion
          ? String(candidate.descripcion)
          : undefined,
        nivel: ["alto", "medio", "bajo"].includes(String(candidate.nivel))
          ? (String(candidate.nivel) as BriefingItem["nivel"])
          : undefined,
      };
    })
    .filter((item): item is BriefingItem => Boolean(item))
    .slice(0, 5);
}

function limpiarSerie(serie: unknown): ScorePunto[] {
  if (!Array.isArray(serie)) return [];
  return serie
    .filter((p) => p && typeof p.fecha === "string" && Number.isFinite(p.score))
    .map((p) => ({ fecha: p.fecha as string, score: clampScore(p.score as number) }));
}

function clampScore(value?: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value ?? 0)));
}
