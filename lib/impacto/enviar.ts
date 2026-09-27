import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { crearTokenBaja } from "../email/baja.ts";
import { monedaConocida } from "../finanzas/monedas.ts";
import {
  calcularImpacto,
  mesAnterior,
  redactarInforme,
  tieneAlgoQueContar,
  type HechosDelMes,
  type Impacto,
  type Periodo,
} from "./informe.ts";

/**
 * Envío del Informe de impacto mensual.
 *
 * Reglas, todas deliberadas:
 *
 *  - SALE DEL 1 AL 5 DE CADA MES, sobre el mes anterior. El cron corre todos
 *    los días (el plan Hobby no deja crear otro); el UNIQUE de la tabla hace
 *    que salga una sola vez. Los días 2 a 5 son solo para reintentar a quien
 *    falló el 1: un "tu agosto con EOS" que llega el 20 de setiembre ya no es
 *    un resumen, es ruido.
 *  - SOLO A QUIEN HIZO ALGO. Una cuenta sin actividad en el mes no recibe un
 *    informe vacío: "este mes no hicimos nada" no es impacto.
 *  - SE RECLAMA ANTES DE MANDAR, con los números adentro (`datos`), como los
 *    motivacionales. Si Resend falla, se suelta el reclamo y se reintenta al
 *    día siguiente.
 *  - TIENE SU PROPIA BAJA, distinta de la de los motivacionales.
 */

export const MOTIVO_BAJA_IMPACTO = "informe_impacto";
export const TABLA = "eos_informes_impacto_v206";
export const ULTIMO_DIA_DE_ENVIO = 5;

export type CorreoInforme = {
  para: string;
  asunto: string;
  html: string;
  texto: string;
  urlBaja: string;
};

export type ResumenInformes = {
  periodo: string | null;
  enviados: number;
  fallidos: number;
  sinNadaQueContar: number;
  pendientes: boolean;
};

/**
 * Lo que el envío necesita de la base, separado para poder probarlo sin una.
 * `fuenteSupabase` es la implementación real.
 */
export type Fuente = {
  /** Cuentas con al menos un comando completado en el período. */
  cuentasConActividad(p: Periodo): Promise<string[]>;
  /** Quiénes ya tienen su informe de este período reclamado. */
  yaReclamados(p: Periodo): Promise<Set<string>>;
  /** Quiénes se dieron de baja de este correo. */
  bajas(): Promise<Set<string>>;
  perfil(uid: string): Promise<{ nombre: string | null; email: string | null } | null>;
  hechos(uid: string, p: Periodo): Promise<HechosDelMes>;
  /** true si quedó reclamado; false si otra ejecución ya lo tenía. */
  reclamar(uid: string, p: Periodo, datos: Impacto): Promise<boolean>;
  soltar(uid: string, p: Periodo): Promise<void>;
};

export function urlDeBajaImpacto(appUrl: string, usuarioId: string, secreto: string): string {
  const token = crearTokenBaja(usuarioId, MOTIVO_BAJA_IMPACTO, secreto);
  return `${appUrl}/api/correos/baja?m=${MOTIVO_BAJA_IMPACTO}&u=${encodeURIComponent(usuarioId)}&t=${token}`;
}

/** Día del mes de `hoy` (YYYY-MM-DD). */
function diaDelMes(hoy: string): number {
  return Number(hoy.slice(8, 10));
}

export async function enviarInformesDeImpacto(
  fuente: Fuente,
  opciones: {
    hoy: string;
    appUrl: string;
    secreto: string;
    enviar: (correo: CorreoInforme) => Promise<void>;
    max?: number;
  },
): Promise<ResumenInformes> {
  const { hoy, appUrl, secreto, enviar, max = 200 } = opciones;
  const resumen: ResumenInformes = {
    periodo: null,
    enviados: 0,
    fallidos: 0,
    sinNadaQueContar: 0,
    pendientes: false,
  };

  if (diaDelMes(hoy) > ULTIMO_DIA_DE_ENVIO) return resumen;

  const periodo = mesAnterior(hoy);
  resumen.periodo = periodo.clave;

  // Sin saber quién ya lo recibió o quién se dio de baja, no se manda a nadie:
  // si una de estas lecturas falla, lanza y el cron lo registra.
  const [cuentas, reclamados, bajas] = await Promise.all([
    fuente.cuentasConActividad(periodo),
    fuente.yaReclamados(periodo),
    fuente.bajas(),
  ]);

  for (const uid of cuentas) {
    if (reclamados.has(uid) || bajas.has(uid)) continue;

    if (resumen.enviados + resumen.fallidos >= max) {
      resumen.pendientes = true;
      break;
    }

    try {
      const perfil = await fuente.perfil(uid);
      if (!perfil?.email) continue;

      const impacto = calcularImpacto(periodo.clave, await fuente.hechos(uid, periodo));
      if (!tieneAlgoQueContar(impacto)) {
        resumen.sinNadaQueContar += 1;
        continue;
      }

      if (!(await fuente.reclamar(uid, periodo, impacto))) continue;

      const urlBaja = urlDeBajaImpacto(appUrl, uid, secreto);
      const { asunto, html, texto } = redactarInforme({
        impacto,
        nombreMes: periodo.nombreMes,
        nombre: perfil.nombre,
        appUrl,
        urlBaja,
      });

      try {
        await enviar({ para: perfil.email, asunto, html, texto, urlBaja });
        resumen.enviados += 1;
      } catch (e) {
        resumen.fallidos += 1;
        console.error(`Impacto: falló el envío a ${uid}:`, e instanceof Error ? e.message : e);
        // Se suelta el reclamo: mañana (hasta el día 5) se reintenta.
        await fuente.soltar(uid, periodo);
      }
    } catch (e) {
      // Una cuenta con datos raros no deja sin informe a las demás.
      resumen.fallidos += 1;
      console.error(`Impacto: falló el armado para ${uid}:`, e instanceof Error ? e.message : e);
    }
  }

  return resumen;
}

// ---------------------------------------------------------------------------
// La fuente real
// ---------------------------------------------------------------------------

/** Paraguay está en UTC-3 todo el año desde octubre de 2024. */
function rangoInstantes(p: Periodo): { desde: string; hasta: string } {
  return { desde: `${p.desde}T00:00:00-03:00`, hasta: `${p.hasta}T23:59:59.999-03:00` };
}

const PAGINA = 1000;

function falla(que: string, error: { message?: string } | null): never {
  throw new Error(`Impacto: no se pudo leer ${que}: ${error?.message ?? "desconocido"}`);
}

/**
 * Solo guaraníes. Un informe que suma guaraníes con dólares no es el
 * resultado de nada (misma regla que `lib/contabilidad/resultado.ts`); las
 * cuentas en otra moneda son hoy la excepción, y su línea simplemente no sale.
 */
const esPYG = (moneda: string | null) => monedaConocida(moneda ?? "PYG") === "PYG";

export function fuenteSupabase(admin: ClienteSinTipos): Fuente {
  return {
    async cuentasConActividad(p) {
      const { desde, hasta } = rangoInstantes(p);
      const ids = new Set<string>();

      for (let inicio = 0; ; inicio += PAGINA) {
        const { data, error } = await admin
          .from("eos_action_commands")
          .select("usuario_id")
          .eq("estado", "completada")
          .gte("created_at", desde)
          .lte("created_at", hasta)
          .order("created_at")
          .range(inicio, inicio + PAGINA - 1);

        if (error) falla("la actividad del mes", error);
        const filas = (data ?? []) as { usuario_id: string }[];
        for (const f of filas) ids.add(f.usuario_id);
        if (filas.length < PAGINA) break;
      }

      return [...ids];
    },

    async yaReclamados(p) {
      const { data, error } = await admin.from(TABLA).select("usuario_id").eq("periodo", p.clave);
      if (error) falla("los informes ya enviados", error);
      return new Set(((data ?? []) as { usuario_id: string }[]).map((r) => r.usuario_id));
    },

    async bajas() {
      const { data, error } = await admin
        .from("eos_followup_preferences")
        .select("usuario_id")
        .eq("informe_impacto", false);
      if (error) falla("las bajas", error);
      return new Set(((data ?? []) as { usuario_id: string }[]).map((r) => r.usuario_id));
    },

    async perfil(uid) {
      const { data, error } = await admin
        .from("usuarios")
        .select("nombre,email")
        .eq("id", uid)
        .maybeSingle();
      if (error) falla("el perfil", error);
      return (data as { nombre: string | null; email: string | null } | null) ?? null;
    },

    async hechos(uid, p) {
      const { desde, hasta } = rangoInstantes(p);

      const [acciones, ventas, credito, pendientes] = await Promise.all([
        admin
          .from("eos_action_commands")
          .select("accion")
          .eq("usuario_id", uid)
          .eq("estado", "completada")
          .gte("created_at", desde)
          .lte("created_at", hasta)
          .limit(5000),
        admin
          .from("eos_erp_ventas")
          .select("total,moneda")
          .eq("usuario_id", uid)
          .in("estado", ["emitida", "cobrada"])
          .gte("fecha", p.desde)
          .lte("fecha", p.hasta)
          .limit(5000),
        // Las ventas a crédito ya cobradas: el día del cobro es la fecha del
        // movimiento que las cobró, no la de la venta.
        admin
          .from("eos_erp_ventas")
          .select("total,moneda,movimiento_id")
          .eq("usuario_id", uid)
          .eq("condicion", "credito")
          .eq("estado", "cobrada")
          .not("movimiento_id", "is", null)
          .limit(5000),
        admin
          .from("eos_erp_ventas")
          .select("total,moneda,contacto_id")
          .eq("usuario_id", uid)
          .eq("condicion", "credito")
          .eq("estado", "emitida")
          .limit(5000),
      ]);

      if (acciones.error) falla("las acciones", acciones.error);
      if (ventas.error) falla("las ventas", ventas.error);
      if (credito.error) falla("las ventas a crédito cobradas", credito.error);
      if (pendientes.error) falla("las ventas por cobrar", pendientes.error);

      type Venta = { total: number | string | null; moneda: string | null };
      const aNumero = (v: Venta) => ({ total: Number(v.total ?? 0) });

      const cobradas = ((credito.data ?? []) as (Venta & { movimiento_id: string })[]).filter((v) =>
        esPYG(v.moneda),
      );

      let cobrosDeCredito: { total: number }[] = [];
      if (cobradas.length > 0) {
        const { data, error } = await admin
          .from("eos_movimientos_financieros")
          .select("id")
          .in(
            "id",
            cobradas.map((v) => v.movimiento_id),
          )
          .gte("fecha", p.desde)
          .lte("fecha", p.hasta);
        if (error) falla("los movimientos de cobro", error);
        const delMes = new Set(((data ?? []) as { id: string }[]).map((m) => m.id));
        cobrosDeCredito = cobradas.filter((v) => delMes.has(v.movimiento_id)).map(aNumero);
      }

      return {
        acciones: ((acciones.data ?? []) as { accion: string }[]).map((a) => a.accion),
        ventas: ((ventas.data ?? []) as Venta[]).filter((v) => esPYG(v.moneda)).map(aNumero),
        cobrosDeCredito,
        porCobrar: ((pendientes.data ?? []) as (Venta & { contacto_id: string | null })[])
          .filter((v) => esPYG(v.moneda))
          .map((v) => ({ total: Number(v.total ?? 0), contacto_id: v.contacto_id })),
      };
    },

    async reclamar(uid, p, datos) {
      const { error } = await admin.from(TABLA).insert({ usuario_id: uid, periodo: p.clave, datos });
      if (!error) return true;
      // 23505: otra ejecución ya lo reclamó. Cualquier otro error: no se manda.
      if ((error as { code?: string }).code !== "23505") {
        console.error("Impacto: no se pudo reclamar el envío:", error);
      }
      return false;
    },

    async soltar(uid, p) {
      await admin.from(TABLA).delete().eq("usuario_id", uid).eq("periodo", p.clave);
    },
  };
}
