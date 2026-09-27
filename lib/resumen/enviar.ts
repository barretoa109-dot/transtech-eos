import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { crearTokenBaja } from "../email/baja.ts";
import { monedaConocida } from "../finanzas/monedas.ts";
import { sumarDias } from "../fecha.ts";
import { leerCartera } from "../erp/cartera-leer.ts";
import { proyectarAgotamiento, VENTANA_DIAS, type ProductoAgotable, type SalidaDeStock } from "../erp/agotamiento.ts";
import { deudores } from "../eos/quien-me-debe.ts";
import { redactarResumen, semanaDe, type HechosSemana, type ProductoQueSeAcaba, type Semana } from "./semanal.ts";

/**
 * Envío del resumen de los lunes.
 *
 * Reglas, todas deliberadas:
 *
 *  - SALE LOS LUNES, con reintento el martes para quien falló. Un "tu
 *    semana" que llega el jueves ya no sirve para arrancar la semana.
 *  - SOLO A QUIEN TIENE EL NEGOCIO EN MARCHA: al menos una venta anotada en
 *    las últimas cuatro semanas. A una cuenta sin ventas, cuatro renglones en
 *    cero no le dicen nada.
 *  - SE RECLAMA ANTES DE MANDAR, con los datos adentro, como el Informe de
 *    impacto. Si Resend falla, se suelta el reclamo y el martes se reintenta.
 *  - TIENE SU PROPIA BAJA.
 *  - Si la migración v207 todavía no se aplicó, leer las bajas falla y no se
 *    manda nada: nunca un correo a quien no se sabe si se dio de baja.
 */

export const MOTIVO_BAJA_RESUMEN = "resumen_semanal";
const TABLA = "eos_resumenes_semanales_v207";
const SEMANAS_DE_ACTIVIDAD = 4;
/** Cuántos días antes de acabarse se nombra un producto en el resumen. */
const HORIZONTE_RESUMEN = 14;

export type CorreoResumen = { para: string; asunto: string; html: string; texto: string; urlBaja: string };

export type ResumenEnvio = { semana: string | null; enviados: number; fallidos: number; pendientes: boolean };

export type FuenteResumen = {
  cuentasConVentas(desde: string): Promise<string[]>;
  yaReclamados(s: Semana): Promise<Set<string>>;
  bajas(): Promise<Set<string>>;
  perfil(uid: string): Promise<{ nombre: string | null; email: string | null } | null>;
  hechos(uid: string, s: Semana, hoy: string): Promise<HechosSemana>;
  reclamar(uid: string, s: Semana, datos: HechosSemana): Promise<boolean>;
  soltar(uid: string, s: Semana): Promise<void>;
};

export function urlDeBajaResumen(appUrl: string, usuarioId: string, secreto: string): string {
  const token = crearTokenBaja(usuarioId, MOTIVO_BAJA_RESUMEN, secreto);
  return `${appUrl}/api/correos/baja?m=${MOTIVO_BAJA_RESUMEN}&u=${encodeURIComponent(usuarioId)}&t=${token}`;
}

/** Lunes (1) o martes (2). */
function esDiaDeEnvio(hoy: string): boolean {
  const dia = new Date(`${hoy}T12:00:00Z`).getUTCDay();
  return dia === 1 || dia === 2;
}

export async function enviarResumenesSemanales(
  fuente: FuenteResumen,
  opciones: {
    hoy: string;
    appUrl: string;
    secreto: string;
    enviar: (correo: CorreoResumen) => Promise<void>;
    max?: number;
  },
): Promise<ResumenEnvio> {
  const { hoy, appUrl, secreto, enviar, max = 200 } = opciones;
  const resumen: ResumenEnvio = { semana: null, enviados: 0, fallidos: 0, pendientes: false };

  if (!esDiaDeEnvio(hoy)) return resumen;

  const semana = semanaDe(hoy);
  resumen.semana = semana.lunes;

  const [cuentas, reclamados, bajas] = await Promise.all([
    fuente.cuentasConVentas(sumarDias(semana.lunes, -7 * SEMANAS_DE_ACTIVIDAD)),
    fuente.yaReclamados(semana),
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

      const hechos = await fuente.hechos(uid, semana, hoy);
      if (!(await fuente.reclamar(uid, semana, hechos))) continue;

      const urlBaja = urlDeBajaResumen(appUrl, uid, secreto);
      const correo = redactarResumen({ hechos, nombre: perfil.nombre, appUrl, urlBaja });

      try {
        await enviar({ para: perfil.email, ...correo, urlBaja });
        resumen.enviados += 1;
      } catch (e) {
        resumen.fallidos += 1;
        console.error(`Resumen: falló el envío a ${uid}:`, e instanceof Error ? e.message : e);
        await fuente.soltar(uid, semana);
      }
    } catch (e) {
      resumen.fallidos += 1;
      console.error(`Resumen: falló el armado para ${uid}:`, e instanceof Error ? e.message : e);
    }
  }

  return resumen;
}

// ---------------------------------------------------------------------------
// La fuente real
// ---------------------------------------------------------------------------

function falla(que: string, error: { message?: string } | null): never {
  throw new Error(`Resumen: no se pudo leer ${que}: ${error?.message ?? "desconocido"}`);
}

const esPYG = (moneda: string | null) => monedaConocida(moneda ?? "PYG") === "PYG";

export function fuenteResumenSupabase(admin: ClienteSinTipos): FuenteResumen {
  return {
    async cuentasConVentas(desde) {
      const ids = new Set<string>();
      for (let inicio = 0; ; inicio += 1000) {
        const { data, error } = await admin
          .from("eos_erp_ventas")
          .select("usuario_id")
          .in("estado", ["emitida", "cobrada"])
          .gte("fecha", desde)
          .order("fecha")
          .range(inicio, inicio + 999);
        if (error) falla("las cuentas con ventas", error);
        const filas = (data ?? []) as { usuario_id: string }[];
        for (const f of filas) ids.add(f.usuario_id);
        if (filas.length < 1000) break;
      }
      return [...ids];
    },

    async yaReclamados(s) {
      const { data, error } = await admin.from(TABLA).select("usuario_id").eq("semana", s.lunes);
      if (error) falla("los resúmenes ya enviados", error);
      return new Set(((data ?? []) as { usuario_id: string }[]).map((r) => r.usuario_id));
    },

    async bajas() {
      const { data, error } = await admin
        .from("eos_followup_preferences")
        .select("usuario_id")
        .eq("resumen_semanal", false);
      if (error) falla("las bajas", error);
      return new Set(((data ?? []) as { usuario_id: string }[]).map((r) => r.usuario_id));
    },

    async perfil(uid) {
      const { data, error } = await admin.from("usuarios").select("nombre,email").eq("id", uid).maybeSingle();
      if (error) falla("el perfil", error);
      return (data as { nombre: string | null; email: string | null } | null) ?? null;
    },

    async hechos(uid, s, hoy) {
      const [ventas, productos, salidas, cartera] = await Promise.all([
        admin
          .from("eos_erp_ventas")
          .select("fecha,total,moneda")
          .eq("usuario_id", uid)
          .in("estado", ["emitida", "cobrada"])
          .gte("fecha", s.desdeAnterior)
          .lte("fecha", s.hasta)
          .limit(5000),
        admin
          .from("eos_erp_productos")
          .select("id,nombre,stock_actual,stock_minimo,controla_stock,activo,costo")
          .eq("usuario_id", uid)
          .eq("activo", true)
          .limit(5000),
        admin
          .from("eos_erp_movimientos_stock")
          .select("producto_id,fecha,cantidad")
          .eq("usuario_id", uid)
          .eq("tipo", "salida")
          .gte("fecha", sumarDias(hoy, -VENTANA_DIAS))
          .limit(5000),
        leerCartera(admin, uid, "cobrar"),
      ]);

      if (ventas.error) falla("las ventas", ventas.error);
      if (productos.error) falla("los productos", productos.error);
      if (salidas.error) falla("las salidas de stock", salidas.error);

      type Venta = { fecha: string; total: number | string | null; moneda: string | null };
      const pyg = ((ventas.data ?? []) as Venta[]).filter((v) => esPYG(v.moneda));
      const entre = (desde: string, hasta: string) => {
        const filas = pyg.filter((v) => v.fecha >= desde && v.fecha <= hasta);
        return { cantidad: filas.length, total: filas.reduce((t, v) => t + Number(v.total ?? 0), 0) };
      };

      type Producto = ProductoAgotable & { costo: number | string | null };
      const lista = ((productos.data ?? []) as Producto[]).map((p) => ({
        ...p,
        stock_actual: Number(p.stock_actual ?? 0),
        stock_minimo: Number(p.stock_minimo ?? 0),
      }));
      const conStock = lista.filter((p) => p.controla_stock);

      let seAcaba: ProductoQueSeAcaba[] | null = null;
      if (conStock.length > 0) {
        const bajoMinimo = conStock
          .filter((p) => p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo)
          .map((p) => ({ nombre: p.nombre, dias: null }));
        const porRitmo = proyectarAgotamiento({
          hoy,
          productos: conStock,
          salidas: ((salidas.data ?? []) as SalidaDeStock[]).map((x) => ({ ...x, cantidad: Number(x.cantidad ?? 0) })),
          horizonteDias: HORIZONTE_RESUMEN,
        }).map((p) => ({ nombre: p.nombre, dias: p.dias_restantes }));
        seAcaba = [...bajoMinimo, ...porRitmo];
      }

      return {
        ventas: entre(s.desde, s.hasta),
        ventasAnterior: entre(s.desdeAnterior, s.hastaAnterior),
        deudores: deudores(cartera.documentos, hoy),
        seAcaba,
        productos: lista.length,
        productosSinCosto: lista.filter((p) => !(Number(p.costo) > 0)).length,
      };
    },

    async reclamar(uid, s, datos) {
      const { error } = await admin.from(TABLA).insert({ usuario_id: uid, semana: s.lunes, datos });
      if (!error) return true;
      if ((error as { code?: string }).code !== "23505") console.error("Resumen: no se pudo reclamar el envío:", error);
      return false;
    },

    async soltar(uid, s) {
      await admin.from(TABLA).delete().eq("usuario_id", uid).eq("semana", s.lunes);
    },
  };
}
