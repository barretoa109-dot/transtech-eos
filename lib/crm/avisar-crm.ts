import { createHash } from "node:crypto";

import { entregarAviso, type EnviarCorreo } from "../finanzas/avisarRiesgos.ts";
import { hoyEnParaguay } from "../fecha.ts";
import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { registrarAprendizajeComercial } from "./aprendizaje.ts";
import { leerSeguimientos } from "./seguimientos-datos.ts";
import type { Seguimiento } from "./seguimientos.ts";

/**
 * Avisar de a quién hay que retomar, y de paso aprender de lo que se cerró.
 *
 * Corre en el cron diario, para quien tiene el módulo CRM activo. Hace dos cosas:
 *
 *   1. APRENDE: recalcula lo que EOS sabe del proceso comercial de esa persona (tasa de
 *      cierre, ciclo, motivos de pérdida) con lo cerrado hasta hoy. Es lo que hace que un
 *      cierre de ayer ya cuente en el chat de hoy, aunque nadie haya abierto el CRM.
 *   2. AVISA — solo lo urgente. Los seguimientos de prioridad 1 (hoy y con plata en juego);
 *      el resto está en la pantalla y no molesta a nadie. Y no repite: el mismo conjunto de
 *      clientes se avisa una sola vez, no todos los días.
 *
 * SI NO SE PUEDE LEER EL HISTORIAL DE AVISOS, NO SE AVISA: sin saber qué se mandó ayer, la
 * única alternativa es mandarlo todos los días, y eso es lo que hace apagar las notificaciones.
 * Lo mismo si no se pueden calcular los seguimientos: callar es incómodo, decir «nada para
 * retomar» o avisar con datos a medias es peor.
 *
 * DE QUIÉN SON LOS DATOS: cada lectura lleva `usuario_id`; con el cliente de servicio, ese
 * filtro es la única frontera.
 */

const TIPO_AVISO = "seguimientos_crm";
const MAX_USUARIOS = 50;
const MAX_NOMBRES = 3;

export type ResumenAvisosCRM = {
  evaluados: number;
  con_urgentes: number;
  avisados: number;
  omitidos_por_repetido: number;
  sin_canal: number;
  sin_historial: number;
  sin_calculo: number;
  resueltos: number;
  aprendizajes_guardados: number;
};

/** Por qué se lo menciona, en pocas palabras. */
function motivoCorto(s: Seguimiento): string {
  switch (s.tipo) {
    case "vencido":
      return "seguimiento vencido";
    case "vence_hoy":
      return "seguimiento de hoy";
    case "sin_respuesta":
      return `sin respuesta hace ${s.dias} días`;
    case "estancada":
      return `estancada hace ${s.dias} días`;
    case "lead_sin_contactar":
      return "sin contactar";
    case "cierre_proximo":
      return "cierre cerca";
  }
}

/** El texto del aviso. Nombra hasta tres clientes y dice cuántos más hay. */
export function redactarAvisoSeguimientos(urgentes: Seguimiento[]): string {
  const nombres = urgentes.slice(0, MAX_NOMBRES).map((s) => `${s.contacto_nombre} (${motivoCorto(s)})`);
  const resto = urgentes.length - nombres.length;

  const quienes = resto > 0 ? `${nombres.join(", ")} y ${resto} más` : nombres.join(", ");
  const cuantos = urgentes.length === 1 ? "1 cliente" : `${urgentes.length} clientes`;

  return (
    `Hoy conviene retomar ${cuantos}: ${quienes}. ` +
    "Entrá a CRM > Para retomar: tenés un mensaje listo para revisar y mandar."
  );
}

/** Identifica el conjunto avisado: el mismo conjunto no se repite. Las claves ya llevan la fecha de origen. */
export function claveDelAviso(urgentes: Seguimiento[]): string {
  const junto = urgentes.map((s) => s.clave).sort().join("|");
  return junto.length <= 180 ? junto : `h:${createHash("sha1").update(junto).digest("hex")}`;
}

type Dependencias = {
  hoy?: string;
  ahora?: Date;
  enviarCorreo?: EnviarCorreo;
  // Se inyectan en las pruebas; en producción son los reales.
  leer?: typeof leerSeguimientos;
  aprender?: typeof registrarAprendizajeComercial;
  entregar?: typeof entregarAviso;
};

export async function avisarSeguimientosCRM(admin: ClienteSinTipos, opciones: Dependencias = {}): Promise<ResumenAvisosCRM> {
  const hoy = opciones.hoy ?? hoyEnParaguay();
  const leer = opciones.leer ?? leerSeguimientos;
  const aprender = opciones.aprender ?? registrarAprendizajeComercial;
  const entregar = opciones.entregar ?? entregarAviso;

  const resumen: ResumenAvisosCRM = {
    evaluados: 0,
    con_urgentes: 0,
    avisados: 0,
    omitidos_por_repetido: 0,
    sin_canal: 0,
    sin_historial: 0,
    sin_calculo: 0,
    resueltos: 0,
    aprendizajes_guardados: 0,
  };

  const { data: conCrm, error: errorModulos } = await admin
    .from("eos_usuario_modulos")
    .select("usuario_id")
    .eq("modulo_codigo", "crm")
    .eq("estado", "activo")
    .limit(MAX_USUARIOS);

  if (errorModulos) {
    console.error("CRM: no se pudo saber a quién avisar:", errorModulos);
    return resumen;
  }

  for (const fila of (conCrm ?? []) as { usuario_id: string }[]) {
    const uid = fila.usuario_id;
    resumen.evaluados += 1;

    try {
      // 1. Aprender. Que falle no impide avisar: son dos trabajos distintos.
      try {
        const r = await aprender(admin, uid, opciones.ahora);
        resumen.aprendizajes_guardados += r.guardados;
      } catch (error) {
        console.error("CRM: falló el aprendizaje de un usuario:", error);
      }

      // 2. Avisar.
      const { data: previos, error: errorPrevios } = await admin
        .from("eos_negocio_avisos")
        .select("tipo,clave")
        .eq("usuario_id", uid)
        .eq("tipo", TIPO_AVISO);

      if (errorPrevios) {
        // La tabla puede no aceptar todavía este tipo (v185 sin aplicar): sin historial, no se avisa.
        console.error("CRM: no se pudo leer el historial de avisos:", errorPrevios);
        resumen.sin_historial += 1;
        continue;
      }

      let seguimientos: Seguimiento[];
      try {
        seguimientos = await leer(admin, uid, hoy, opciones.ahora);
      } catch (error) {
        console.error("CRM: no se pudieron calcular los seguimientos de un usuario:", error);
        resumen.sin_calculo += 1;
        continue;
      }

      const urgentes = seguimientos.filter((s) => s.prioridad === 1);
      const previa = ((previos ?? []) as { clave: string }[])[0]?.clave ?? null;

      if (urgentes.length === 0) {
        // Ya no hay nada urgente: se olvida el aviso, para que el próximo sí salga.
        if (previa !== null) {
          await admin.from("eos_negocio_avisos").delete().eq("usuario_id", uid).eq("tipo", TIPO_AVISO);
          resumen.resueltos += 1;
        }
        continue;
      }

      resumen.con_urgentes += 1;
      const clave = claveDelAviso(urgentes);

      if (previa === clave) {
        resumen.omitidos_por_repetido += 1;
        continue;
      }

      const entregado = await entregar(admin, uid, redactarAvisoSeguimientos(urgentes), opciones.enviarCorreo);

      if (!entregado) {
        // Sin canal no se anota: si mañana activa el correo, tiene que enterarse.
        resumen.sin_canal += 1;
        continue;
      }

      await admin
        .from("eos_negocio_avisos")
        .upsert({ usuario_id: uid, tipo: TIPO_AVISO, clave, enviado_en: new Date().toISOString() }, { onConflict: "usuario_id,tipo" });

      resumen.avisados += 1;
    } catch (error) {
      // Un usuario con datos raros no puede dejar sin aviso a los demás.
      console.error("CRM: falló la evaluación de un usuario:", error);
    }
  }

  return resumen;
}
