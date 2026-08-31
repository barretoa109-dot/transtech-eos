import { entregarAviso, type EnviarCorreo } from "../finanzas/avisarRiesgos.ts";
import { formatearMonto } from "../finanzas/formato.ts";
import { hoyEnParaguay } from "../fecha.ts";
import {
  detectarRiesgosNegocio,
  redactarRiesgoNegocio,
  type ProductoStock,
  type RiesgoNegocio,
  type VentaACobrar,
} from "./riesgos-negocio.ts";
import { type ClienteSinTipos } from "../supabase/sin-tipos.ts";

/**
 * Avisar de lo que le está por faltar al negocio, sin repetirlo todos los días.
 *
 * ============================================================
 * POR QUÉ ES UN RECORRIDO APARTE Y NO UNA RAMA DEL DE FINANZAS
 * ============================================================
 *
 * `avisarRiesgos` evalúa a quien definió su Constitución Financiera y tiene el
 * módulo `alertas`. Esto evalúa a quien tiene el módulo `erp` y carga stock o
 * vende a crédito. Son dos poblaciones distintas: alguien puede tener el ERP y
 * no las finanzas, o al revés.
 *
 * Meterlo como una rama del otro obligaría a que un usuario sin política
 * financiera nunca se entere de que se está quedando sin harina, que no tiene
 * nada que ver.
 *
 * ============================================================
 * SI NO SE PUEDE LEER EL HISTORIAL, NO SE AVISA
 * ============================================================
 *
 * La misma regla que ya tiene el aviso de faltante de plata, y por el mismo
 * motivo: sin saber qué se mandó ayer, la única alternativa es mandarlo todos
 * los días. Callar por un error de lectura es incómodo; repetir el mismo susto
 * cinco veces es lo que hace que el usuario apague las notificaciones para
 * siempre.
 */

/** Tope por corrida: un cron que se cuelga no avisa a nadie. */
const MAX_USUARIOS = 50;

export type ResumenAvisosNegocio = {
  evaluados: number;
  con_riesgo: number;
  avisados: number;
  omitidos_por_repetido: number;
  sin_canal: number;
  sin_historial: number;
  resueltos: number;
};

export async function avisarRiesgosNegocio(
  admin: ClienteSinTipos,
  opciones: { hoy?: string; enviarCorreo?: EnviarCorreo } = {},
): Promise<ResumenAvisosNegocio> {
  const hoy = opciones.hoy ?? hoyEnParaguay();

  const resumen: ResumenAvisosNegocio = {
    evaluados: 0,
    con_riesgo: 0,
    avisados: 0,
    omitidos_por_repetido: 0,
    sin_canal: 0,
    sin_historial: 0,
    resueltos: 0,
  };

  /*
   * De quién hay que ocuparse: los que tienen el módulo ERP activo.
   *
   * Se saca de `eos_usuario_modulos` y no de una consulta a los productos,
   * porque alguien que todavía no cargó nada tampoco tiene riesgos y no hace
   * falta traer sus filas para descubrirlo.
   */
  const { data: conErp } = await admin
    .from("eos_usuario_modulos")
    .select("usuario_id")
    .eq("modulo_codigo", "erp")
    .eq("estado", "activo")
    .limit(MAX_USUARIOS);

  for (const fila of (conErp ?? []) as { usuario_id: string }[]) {
    const uid = fila.usuario_id;
    resumen.evaluados += 1;

    try {
      const [productos, ventas, previos] = await Promise.all([
        admin
          .from("eos_erp_productos")
          .select("id,nombre,stock_actual,stock_minimo,controla_stock,activo")
          .eq("usuario_id", uid)
          .eq("activo", true)
          .eq("controla_stock", true),
        // A crédito y sin movimiento financiero: es plata que le deben.
        admin
          .from("eos_erp_ventas")
          .select("id,fecha,total,moneda")
          .eq("usuario_id", uid)
          .is("movimiento_id", null)
          .not("estado", "in", '("anulada","cobrada")'),
        admin.from("eos_negocio_avisos").select("tipo,clave").eq("usuario_id", uid),
      ]);

      if (previos.error) {
        console.error("Negocio: no se pudo leer el historial de avisos:", previos.error);
        resumen.sin_historial += 1;
        continue;
      }

      const yaAvisado = new Map<string, string>();
      for (const p of (previos.data ?? []) as { tipo: string; clave: string }[]) {
        yaAvisado.set(p.tipo, p.clave);
      }

      const riesgos = detectarRiesgosNegocio({
        hoy,
        productos: ((productos.data ?? []) as ProductoStock[]).map((p) => ({
          ...p,
          stock_actual: Number(p.stock_actual ?? 0),
          stock_minimo: Number(p.stock_minimo ?? 0),
        })),
        ventasACobrar: ((ventas.data ?? []) as VentaACobrar[]).map((v) => ({
          ...v,
          total: Number(v.total ?? 0),
        })),
      });

      if (riesgos.length > 0) resumen.con_riesgo += 1;

      /*
       * Lo que dejó de ser un riesgo se olvida.
       *
       * Si el usuario repuso la harina, la fila se borra. El día que se le
       * vuelva a acabar —misma clave, mismos productos— el aviso sale igual,
       * porque el problema volvió y eso sí es una noticia.
       */
      const tiposVigentes = new Set(riesgos.map((r) => r.tipo));
      for (const tipo of yaAvisado.keys()) {
        if (!tiposVigentes.has(tipo as RiesgoNegocio["tipo"])) {
          await admin.from("eos_negocio_avisos").delete().eq("usuario_id", uid).eq("tipo", tipo);
          resumen.resueltos += 1;
        }
      }

      for (const riesgo of riesgos) {
        if (yaAvisado.get(riesgo.tipo) === riesgo.clave) {
          resumen.omitidos_por_repetido += 1;
          continue;
        }

        const texto = redactarRiesgoNegocio(riesgo, formatearMonto);
        const entregado = await entregarAviso(admin, uid, texto, opciones.enviarCorreo);

        if (!entregado) {
          // Sin canal no se anota: si mañana activa el correo, tiene que
          // enterarse del problema que sigue vigente.
          resumen.sin_canal += 1;
          continue;
        }

        await admin.from("eos_negocio_avisos").upsert(
          {
            usuario_id: uid,
            tipo: riesgo.tipo,
            clave: riesgo.clave,
            enviado_en: new Date().toISOString(),
          },
          { onConflict: "usuario_id,tipo" },
        );

        resumen.avisados += 1;
      }
    } catch (error) {
      // Un usuario con datos raros no puede dejar sin aviso a los demás.
      console.error("Negocio: falló la evaluación de un usuario:", error);
    }
  }

  return resumen;
}
