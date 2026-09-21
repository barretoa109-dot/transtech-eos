import type { EnviarCorreo } from "../finanzas/avisarRiesgos.ts";
import { hoyEnParaguay, sumarDias } from "../fecha.ts";
import { enviarAviso, pushConfigurado, resumirParaPush, type Suscripcion } from "../push/enviar.ts";
import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import type { EventoAgenda } from "./agenda.ts";
import { agendaPropia } from "./fuentes.ts";

/**
 * El aviso de cada mañana: lo que tenés hoy, lo de mañana y lo que quedó atrás.
 *
 * ============================================================
 * QUÉ AVISA Y QUÉ NO
 * ============================================================
 *
 * Avisa lo que la PERSONA anotó —a mano o por el chat— y lo que se repite. Los
 * cobros y pagos que vencen, las metas y el CRM no entran: los cobros y los pagos
 * ya tienen sus propios avisos de riesgo (`avisarRiesgosNegocio`), y mandar la
 * misma noticia por dos avisos distintos es lo que enseña a apagar todos.
 *
 * Un recordatorio es una promesa: "anotalo que el 25 pago los salarios". Este
 * aviso es EOS cumpliendo la parte de "y acordate de avisarme".
 *
 * ============================================================
 * CUÁNDO, Y POR QUÉ NO "30 MINUTOS ANTES"
 * ============================================================
 *
 * Corre una vez por día, colgado del cron diario (Vercel Hobby permite dos crons y
 * los dos están usados). Así que avisa a la mañana lo que hay ese día y el
 * siguiente, con la hora de cada cosa; no puede avisar "en 30 minutos". Está dicho
 * en la pantalla del Calendario.
 *
 * ============================================================
 * QUÉ GARANTIZA
 * ============================================================
 *
 *   · UNA vez por persona y por día, aunque el cron corra dos veces: se RECLAMA el
 *     día antes de mandar (clave primaria `(usuario_id, fecha)`), como los correos
 *     motivacionales. Si no se pudo entregar por ningún canal, el reclamo se
 *     devuelve para que el próximo intento del mismo día lo vuelva a probar.
 *   · Nada que decir, nada que mandar: nunca "hoy no tenés nada".
 *   · Quien apagó los avisos de agenda no recibe ninguno, ni por push ni por correo.
 *   · Un usuario con datos raros no le quita el aviso a los demás.
 */

const MAX_USUARIOS = 200;
const MAX_NOMBRES = 3;
/** Cuánto hacia atrás se cuenta lo atrasado: más viejo que esto ya es una deuda, no un aviso. */
const DIAS_ATRASO = 7;

export type ResumenAvisosAgenda = {
  evaluados: number;
  avisados: number;
  por_push: number;
  por_correo: number;
  sin_nada: number;
  ya_avisados: number;
  apagados: number;
  sin_canal: number;
  con_error: number;
};

export type AgendaDelDia = {
  hoy: EventoAgenda[];
  manana: EventoAgenda[];
  atrasados: EventoAgenda[];
};

/** Lo pendiente, repartido en hoy / mañana / atrasado. Ordenado por hora dentro de cada parte. */
export function repartir(eventos: EventoAgenda[], hoy: string): AgendaDelDia {
  const manana = sumarDias(hoy, 1);
  const desdeAtraso = sumarDias(hoy, -DIAS_ATRASO);
  const vistos = new Set<string>();
  const salida: AgendaDelDia = { hoy: [], manana: [], atrasados: [] };

  for (const e of eventos) {
    if (e.estado !== "pendiente" || vistos.has(e.id)) continue;
    vistos.add(e.id);

    if (e.fecha === hoy) salida.hoy.push(e);
    else if (e.fecha === manana) salida.manana.push(e);
    else if (e.fecha < hoy && e.fecha >= desdeAtraso) salida.atrasados.push(e);
  }

  return salida;
}

function nombrar(e: EventoAgenda): string {
  return e.hora ? `${e.titulo} (${e.hora})` : e.titulo;
}

function lista(eventos: EventoAgenda[]): string {
  const nombres = eventos.slice(0, MAX_NOMBRES).map(nombrar);
  const resto = eventos.length - nombres.length;
  return resto > 0 ? `${nombres.join(", ")} y ${resto} más` : nombres.join(", ");
}

/**
 * El texto del aviso, o null si no hay nada que decir.
 *
 * No lleva montos ni nombres de clientes: se lee en la pantalla bloqueada del
 * teléfono, y lo que se anotó como "pagar los salarios" ya dice lo suficiente.
 */
export function redactarAvisoAgenda(dia: AgendaDelDia): { titulo: string; texto: string } | null {
  const partes: string[] = [];

  if (dia.hoy.length > 0) partes.push(`Hoy: ${lista(dia.hoy)}.`);
  if (dia.manana.length > 0) partes.push(`Mañana: ${lista(dia.manana)}.`);
  if (dia.atrasados.length > 0) {
    partes.push(
      dia.atrasados.length === 1
        ? `Atrasado: ${lista(dia.atrasados)}.`
        : `Atrasados (${dia.atrasados.length}): ${lista(dia.atrasados)}.`,
    );
  }

  if (partes.length === 0) return null;

  return {
    titulo: dia.hoy.length > 0 ? "Tu agenda de hoy" : "Lo que viene en tu agenda",
    texto: partes.join(" "),
  };
}

const PIE = "\n\n—\nRecibís este aviso porque tenés cosas anotadas en tu Calendario de EOS. Para no recibirlo, desactivalo en Calendario, en “Avisos de agenda”.";

type Canal = "push" | "correo";

type Entregar = (
  admin: ClienteSinTipos,
  usuarioId: string,
  aviso: { titulo: string; texto: string },
  enviarCorreo?: EnviarCorreo,
) => Promise<Canal | null>;

/** Push si tiene dispositivo; si no, correo. Devuelve por dónde salió, o null si no pudo salir. */
export const entregarAvisoAgenda: Entregar = async (admin, usuarioId, aviso, enviarCorreo) => {
  if (pushConfigurado()) {
    const { data } = await admin
      .from("eos_push_suscripciones")
      .select("id,endpoint,p256dh,auth")
      .eq("usuario_id", usuarioId)
      .eq("activa", true);

    const suscripciones = (data ?? []) as Suscripcion[];

    if (suscripciones.length > 0) {
      const resultado = await enviarAviso(suscripciones, {
        titulo: aviso.titulo,
        cuerpo: resumirParaPush(aviso.texto, 160),
        url: "/eos/chat?vista=calendario",
        tag: "eos-agenda",
      });

      // Los dispositivos que ya no existen se dan de baja, o cada mañana se reintenta
      // contra ellos y el ruido tapa los errores de verdad.
      if (resultado.muertas.length > 0) {
        await admin
          .from("eos_push_suscripciones")
          .update({ activa: false, ultimo_error: "endpoint dado de baja por el servicio de push" })
          .in("id", resultado.muertas);
      }

      if (resultado.enviados > 0) return "push";
    }
  }

  if (!enviarCorreo) return null;

  const { data: perfil } = await admin.from("usuarios").select("email").eq("id", usuarioId).maybeSingle();
  const email = (perfil?.email as string | null) ?? null;
  if (!email) return null;

  await enviarCorreo({
    para: email,
    asunto: aviso.titulo,
    texto: aviso.texto + PIE,
  });

  return "correo";
};

type Dependencias = {
  hoy?: string;
  enviarCorreo?: EnviarCorreo;
  // Se inyectan en las pruebas; en producción son los reales.
  leer?: (admin: ClienteSinTipos, usuarioId: string, hoy: string) => Promise<EventoAgenda[]>;
  entregar?: Entregar;
};

/** Lo pendiente de UNA persona en la ventana que le importa al aviso. */
async function leerAgendaDe(admin: ClienteSinTipos, usuarioId: string, hoy: string): Promise<EventoAgenda[]> {
  return agendaPropia({
    usuarioId,
    empresaId: null,
    // Con el cliente de servicio la RLS no protege: la única frontera es el
    // `.eq("usuario_id")` que llevan las dos lecturas de `fuentes.ts`.
    supabase: admin,
    admin,
    hoy,
    desde: sumarDias(hoy, -DIAS_ATRASO),
    hasta: sumarDias(hoy, 1),
    modulos: { crm: false, erp: false, finanzas: false },
    soloPendientes: true,
  });
}

/** A quién vale la pena mirarle la agenda hoy: quien tiene algo pendiente cerca, o algo que se repite. */
async function candidatos(admin: ClienteSinTipos, hoy: string): Promise<string[] | null> {
  const desde = sumarDias(hoy, -DIAS_ATRASO);
  const hasta = sumarDias(hoy, 1);
  const conRegla = (col: string, d: string, h: string) =>
    `and(${col}.gte.${d},${col}.lt.${h}),repite.not.is.null`;

  const [propios, tareas] = await Promise.all([
    admin
      .from("eos_calendario_eventos")
      .select("usuario_id")
      .eq("estado", "pendiente")
      .or(conRegla("fecha", desde, sumarDias(hasta, 1)))
      .limit(1000),
    admin
      .from("eos_tasks")
      .select("usuario_id")
      .eq("estado", "pendiente")
      .not("fecha_limite", "is", null)
      // Un día de margen a cada lado por el desfase entre UTC y Paraguay.
      .or(conRegla("fecha_limite", `${sumarDias(desde, -1)}T00:00:00-03:00`, `${sumarDias(hasta, 2)}T00:00:00-03:00`))
      .limit(1000),
  ]);

  if (propios.error || tareas.error) {
    console.error("Agenda: no se pudo saber a quién avisar:", propios.error ?? tareas.error);
    return null;
  }

  const ids = new Set<string>();
  for (const f of [...(propios.data ?? []), ...(tareas.data ?? [])] as { usuario_id: string }[]) ids.add(f.usuario_id);

  return [...ids].slice(0, MAX_USUARIOS);
}

export async function avisarAgenda(admin: ClienteSinTipos, opciones: Dependencias = {}): Promise<ResumenAvisosAgenda> {
  const hoy = opciones.hoy ?? hoyEnParaguay();
  const leer = opciones.leer ?? leerAgendaDe;
  const entregar = opciones.entregar ?? entregarAvisoAgenda;

  const resumen: ResumenAvisosAgenda = {
    evaluados: 0,
    avisados: 0,
    por_push: 0,
    por_correo: 0,
    sin_nada: 0,
    ya_avisados: 0,
    apagados: 0,
    sin_canal: 0,
    con_error: 0,
  };

  const ids = await candidatos(admin, hoy);
  if (ids === null) return resumen;

  for (const uid of ids) {
    resumen.evaluados += 1;

    try {
      const { data: preferencia } = await admin
        .from("eos_followup_preferences")
        .select("avisos_agenda")
        .eq("usuario_id", uid)
        .maybeSingle();

      // Sin fila es "sí": es el valor con el que arranca todo el mundo.
      if (preferencia?.avisos_agenda === false) {
        resumen.apagados += 1;
        continue;
      }

      const aviso = redactarAvisoAgenda(repartir(await leer(admin, uid, hoy), hoy));

      if (!aviso) {
        resumen.sin_nada += 1;
        continue;
      }

      // Se reclama el día ANTES de mandar. Si dos corridas llegan juntas, una gana la
      // clave primaria y la otra se va: nadie recibe el mismo aviso dos veces.
      const { error: errorReclamo } = await admin
        .from("eos_agenda_avisos")
        .insert({ usuario_id: uid, fecha: hoy, canal: "push", resumen: aviso.texto.slice(0, 500) });

      if (errorReclamo) {
        // 23505 = ya está reclamado: es el caso normal de la segunda corrida.
        if (errorReclamo.code === "23505") {
          resumen.ya_avisados += 1;
        } else {
          console.error("Agenda: no se pudo reclamar el aviso del día:", errorReclamo);
          resumen.con_error += 1;
        }
        continue;
      }

      let canal: Canal | null = null;
      try {
        canal = await entregar(admin, uid, aviso, opciones.enviarCorreo);
      } catch (error) {
        console.error("Agenda: falló la entrega de un aviso:", error);
      }

      if (!canal) {
        // Sin dónde mandarlo (o falló): se devuelve el reclamo para que un nuevo intento
        // del día, o el alta de un canal, pueda volver a probar.
        await admin.from("eos_agenda_avisos").delete().eq("usuario_id", uid).eq("fecha", hoy);
        resumen.sin_canal += 1;
        continue;
      }

      // El reclamo se hizo con "push" por defecto; se corrige al canal real.
      if (canal !== "push") {
        await admin.from("eos_agenda_avisos").update({ canal }).eq("usuario_id", uid).eq("fecha", hoy);
      }

      resumen.avisados += 1;
      if (canal === "push") resumen.por_push += 1;
      else resumen.por_correo += 1;
    } catch (error) {
      console.error("Agenda: falló la evaluación de un usuario:", error);
      resumen.con_error += 1;
    }
  }

  return resumen;
}
