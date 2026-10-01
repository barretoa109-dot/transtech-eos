/**
 * La búsqueda web con sus límites, su caché y sus métricas (01/10/2026).
 *
 * Límites (configurables por entorno, con estos valores por defecto):
 *   EOS_BUSQUEDAS_POR_DIA      10 búsquedas reales por persona en 24 h
 *                              (las que salen de la caché no cuentan)
 *   EOS_BUSQUEDA_CACHE_HORAS    6 horas de vida de un resultado en caché
 *   tiempo de espera           30 s (lib/busqueda/investigar.ts)
 *   una investigación por mensaje (lib/gateway/conversar.ts)
 *
 * Costo medido: US$ 0,02 a 0,08 por búsqueda real con gpt-6-sol. 10 por día son a
 * lo sumo ~US$ 0,80 por persona por día; entra en el consumo del mes (aviso interno de
 * Gs. 70.000), nunca frena a la persona por plata (decisión del dueño).
 */
import { createHash } from "node:crypto";

import { limpiarConsulta, nombreDelPais, paisDe, privadosDelContexto } from "./consulta.ts";
import { investigar, type Investigacion, type PedidoDeBusqueda, type Profundidad } from "./investigar.ts";

export const BUSQUEDAS_POR_DIA = 10;
export const CACHE_HORAS = 6;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (tabla: string) => any };

export type ResultadoBusqueda = { investigacion: Investigacion; consulta: string };

export function claveDeCache(consulta: string, pais: string, profundidad: Profundidad, periodo = ""): string {
  const normal = consulta.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(`${normal}|${pais}|${profundidad}|${periodo.toLowerCase().trim()}`).digest("hex");
}

export function numeroDelEntorno(valor: string | undefined, porDefecto: number): number {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
}

/**
 * Arma la función que conversar.ts llama cuando el modelo pide BUSCAR_WEB.
 * Todo lo que toca la base filtra por `usuario_id` (las métricas) o es
 * público por construcción (la caché).
 */
export function crearBuscador(deps: {
  admin: Admin;
  usuarioId: string;
  contexto: string;
  nombre?: string | null;
  clave: string;
  hoy: string;
  env?: Record<string, string | undefined>;
  hacerFetch?: typeof fetch;
  registrar?: (tarea: Promise<unknown>) => void;
}) {
  const env = deps.env ?? process.env;
  const porDia = numeroDelEntorno(env.EOS_BUSQUEDAS_POR_DIA, BUSQUEDAS_POR_DIA);
  const horas = numeroDelEntorno(env.EOS_BUSQUEDA_CACHE_HORAS, CACHE_HORAS);
  const registrar = deps.registrar ?? ((t: Promise<unknown>) => void t.catch(() => {}));

  return async function buscar(datos: Record<string, unknown>): Promise<ResultadoBusqueda> {
    const pais = paisDe(datos.pais);
    const profundidad: Profundidad = datos.profundidad === "profunda" ? "profunda" : "normal";
    const privados = privadosDelContexto(deps.contexto, deps.nombre);
    const limpia = limpiarConsulta(datos.consulta, privados);
    const periodoLimpio = limpiarConsulta(datos.periodo, privados);
    const periodo = periodoLimpio.ok ? periodoLimpio.consulta : "";

    const anotar = (inv: Investigacion, hash: string) =>
      registrar(
        Promise.resolve(
          deps.admin.from("eos_busquedas_web_v229").insert({
            usuario_id: deps.usuarioId,
            ok: inv.ok,
            codigo: inv.ok ? "ok" : inv.codigo,
            desde_cache: inv.ok ? inv.desdeCache : false,
            modelo: inv.ok ? inv.modelo : null,
            ms: inv.ms,
            costo_usd: inv.costoUsd,
            fuentes: inv.ok ? inv.fuentes.length : 0,
            llamadas_busqueda: inv.ok ? inv.llamadasBusqueda : 0,
            consulta_hash: hash,
            pais,
          }),
        ).then((r: { error?: unknown }) => {
          if (r?.error) console.error("Búsqueda web: no se pudo anotar la métrica:", r.error);
        }),
      );

    if (!limpia.ok) {
      const inv: Investigacion = { ok: false, codigo: "consulta_invalida", costoUsd: 0, ms: 0 };
      anotar(inv, "-");
      return { investigacion: inv, consulta: "" };
    }

    const consulta = limpia.consulta;
    const clave = claveDeCache(consulta, pais, profundidad, periodo);

    // 1. Caché (pública por construcción): no cuenta para el límite ni cuesta.
    const { data: enCache } = await deps.admin
      .from("eos_busquedas_cache_v229")
      .select("resultado")
      .eq("clave", clave)
      .gt("vence_en", new Date().toISOString())
      .maybeSingle();

    if (enCache?.resultado && typeof enCache.resultado === "object") {
      const guardada = enCache.resultado as Extract<Investigacion, { ok: true }>;
      const inv: Investigacion = { ...guardada, desdeCache: true, costoUsd: 0, ms: 0 };
      anotar(inv, clave);
      return { investigacion: inv, consulta };
    }

    // 2. Límite diario por persona (solo búsquedas reales).
    const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count } = await deps.admin
      .from("eos_busquedas_web_v229")
      .select("id", { count: "exact", head: true })
      .eq("usuario_id", deps.usuarioId)
      .eq("desde_cache", false)
      .neq("codigo", "limite_usuario")
      .neq("codigo", "consulta_invalida")
      .gte("creado_en", desde);

    if ((count ?? 0) >= porDia) {
      const inv: Investigacion = { ok: false, codigo: "limite_usuario", costoUsd: 0, ms: 0 };
      anotar(inv, clave);
      return { investigacion: inv, consulta };
    }

    // 3. La búsqueda real, aislada: solo consulta, país y fecha.
    const pedido: PedidoDeBusqueda = { consulta, pais, nombrePais: nombreDelPais(pais), profundidad, periodo, hoy: deps.hoy };
    const inv = await investigar(pedido, { clave: deps.clave, hacerFetch: deps.hacerFetch });
    anotar(inv, clave);

    if (inv.ok) {
      registrar(
        Promise.resolve(
          deps.admin.from("eos_busquedas_cache_v229").upsert({
            clave,
            pais,
            resultado: inv,
            vence_en: new Date(Date.now() + horas * 3600_000).toISOString(),
          }),
        ).then(() =>
          // Lo vencido no se vuelve a usar: se borra al guardar algo nuevo.
          deps.admin.from("eos_busquedas_cache_v229").delete().lt("vence_en", new Date().toISOString()),
        ),
      );
    }

    return { investigacion: inv, consulta };
  };
}
