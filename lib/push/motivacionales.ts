import { hoyEnParaguay, sumarDias } from "../fecha.ts";
import {
  avisoDeRacha,
  avisoRachaEnRiesgo,
  avisoSemanal,
  diasActivos,
  diasActivosEnLaSemana,
  esLunes,
  rachaHasta,
} from "./seguimiento.ts";
import { objetivoPrincipal } from "../email/consejoDeObjetivo.ts";
import type { EstadoObjetivo } from "../finanzas/objetivos.ts";
import { avisarNativo } from "./nativo.ts";
import { resumirParaPush } from "./enviar.ts";
import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";

/**
 * Push motivacional nativo, hasta 3 veces por día ("franjas").
 *
 * Convive con el correo de cada 3 días (`lib/email/motivacionales.ts`), no lo
 * reemplaza — decisión del dueño, 2026-11-10. Lee el MISMO objetivo que el
 * correo (`objetivoPrincipal`), pero no reutiliza sus frases: las del correo
 * tienen 180 caracteres y montos, y un push se lee en dos renglones de una
 * pantalla bloqueada. Recortadas a 160 quedaban cortadas a la mitad, con "…"
 * justo donde estaba lo importante. Acá cada texto está escrito para entrar
 * entero, y sin montos: lo que se ve con el teléfono bloqueado lo ve cualquiera.
 *
 * Solo llega a la app nativa (`avisarNativo`): no hay pantalla de suscripción
 * al push web desde el 2026-08-25, y reconstruirla es otro trabajo (ver
 * lib/finanzas/avisarRiesgos.ts).
 *
 * Idempotencia: `eos_push_motivacionales_v258` tiene
 * `unique (usuario_id, fecha, franja)`. Se reclama la fila ANTES de mandar,
 * mismo patrón que el correo motivacional y que los avisos de agenda.
 *
 * Horario: no corre en un cron de Vercel (Hobby solo da dos, ya usados por
 * briefing y renovaciones). Un workflow de GitHub Actions llama a
 * `/api/cron/push-motivacional?franja=...` tres veces al día — gratis, no
 * depende de pagar Vercel Pro.
 */

export const FRANJAS = ["manana", "mediodia", "noche"] as const;
export type Franja = (typeof FRANJAS)[number];

const TABLA = "eos_push_motivacionales_v258";
const MAX_USUARIOS = 500;
// Mismo criterio que el correo: no molestar a una cuenta recién nacida, que
// todavía está recibiendo los correos de los primeros días.
const DIAS_DE_GRACIA_CUENTA_NUEVA = 8;

export type AvisoMotivacional = { titulo: string; cuerpo: string };

/** Número de día desde la época, para rotar contenido sin guardar "cuál tocó". */
function diaDesdeEpoca(hoy: string): number {
  const [anio, mes, dia] = hoy.split("-").map(Number);
  return Math.floor(Date.UTC(anio, mes - 1, dia) / 86_400_000);
}

function rotar<T>(lista: T[], dia: number): T {
  return lista[((dia % lista.length) + lista.length) % lista.length];
}

/** El título de un objetivo, corto: lo escribió la persona y puede ser un párrafo. */
function nombreCorto(titulo: string): string {
  const limpio = titulo.trim().replace(/\s+/g, " ");
  return limpio.length <= 40 ? limpio : `${limpio.slice(0, 39).trimEnd()}…`;
}

/** Cómo va el objetivo, en el tamaño de una notificación. Sin montos. Pura. */
export function avisoDeObjetivo(e: Pick<EstadoObjetivo, "titulo" | "progreso"> & { estado: string }): AvisoMotivacional {
  const nombre = nombreCorto(e.titulo);

  switch (e.estado) {
    case "cumplido":
      return { titulo: "Llegaste a tu objetivo", cuerpo: `Cumpliste "${nombre}". Buen momento para ponerte una meta nueva.` };
    case "atrasado":
      return {
        titulo: "Tu objetivo necesita un empujón",
        cuerpo: `Vas al ${e.progreso}% de "${nombre}" y el ritmo se atrasó. Abrí EOS y vemos cómo ajustarlo.`,
      };
    case "en_ritmo":
      return { titulo: "Vas en ritmo", cuerpo: `Vas al ${e.progreso}% de "${nombre}". Seguí así y llegás a tiempo.` };
    case "vencido":
      return {
        titulo: "Tu objetivo llegó a su fecha",
        cuerpo: `"${nombre}" quedó en ${e.progreso}%. Lo ahorrado no se pierde: pongámosle una fecha nueva.`,
      };
    case "sin_fecha":
      return { titulo: "Ponele fecha a tu meta", cuerpo: `Llevás ${e.progreso}% de "${nombre}". Con una fecha pasa de idea a plan.` };
    default:
      return { titulo: "Así va tu objetivo", cuerpo: `Vas al ${e.progreso}% de "${nombre}".` };
  }
}

/**
 * Consejos de la mañana para quien todavía no tiene un objetivo con plata.
 *
 * El título ES el consejo; el cuerpo, el porqué en una frase. Así se entiende
 * aunque la persona lea solo la primera línea, que es lo que pasa casi siempre.
 */
export const CONSEJOS_PUSH: AvisoMotivacional[] = [
  { titulo: "Separá el 10% apenas entra la plata", cuerpo: "Apartalo antes de gastar nada. En un año es un mes entero de respaldo." },
  { titulo: "Antes de una compra grande, 48 horas", cuerpo: "Si en dos días sigue pareciendo necesaria, probablemente lo sea. Si no, te ahorraste esa plata." },
  { titulo: "¿Qué deuda pagar primero?", cuerpo: "La de interés más alto, no la más chica. Es la que más te cuesta cada mes." },
  { titulo: "Un mes de gastos guardado", cuerpo: "Ese fondo, aunque lo armes de a poco, separa un imprevisto de una crisis." },
  { titulo: "¿En qué se te va la plata?", cuerpo: "Es la primera pregunta que conviene contestar. Preguntale a EOS y te lo muestra." },
  { titulo: "Renegociá antes de buscar más ingresos", cuerpo: "Bajar una tasa o una cuota es plata que no tenés que volver a ganar cada mes." },
  { titulo: "Cobrar también es vender", cuerpo: "Revisá quién te debe esta semana. Preguntale a EOS qué cobros tenés pendientes." },
  { titulo: "Tu plata y la del negocio, separadas", cuerpo: "Mezclarlas esconde cuánto gana de verdad el negocio. EOS las lleva por separado." },
  { titulo: "Una meta con fecha es un plan", cuerpo: "Decile a EOS cuánto querés juntar y para cuándo, y te va contando cómo venís." },
  { titulo: "Lo chico también suma", cuerpo: "Los gastos de todos los días son los que más se escapan. Anotalos con una frase y aparecen solos." },
];

/**
 * Franja "mañana": cómo va el objetivo financiero principal, o un consejo si
 * todavía no tiene uno.
 */
async function contenidoManana(admin: ClienteSinTipos, usuarioId: string, hoy: string, dia: number): Promise<AvisoMotivacional> {
  const estado = await objetivoPrincipal(admin, usuarioId, hoy);
  return estado ? avisoDeObjetivo(estado) : rotar(CONSEJOS_PUSH, dia);
}

type FilaUltimaAccion = { created_at: string };

/** Cuántos días pasaron desde la última acción completada (sin contar RESPONDER), o null si nunca hubo una. */
async function diasSinAccion(admin: ClienteSinTipos, usuarioId: string, hoy: string): Promise<number | null> {
  const { data, error } = await admin
    .from("eos_action_commands")
    .select("created_at")
    .eq("usuario_id", usuarioId)
    .eq("estado", "completada")
    .neq("accion", "RESPONDER")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const ultima = ((data as FilaUltimaAccion).created_at ?? "").slice(0, 10);
  if (!ultima) return null;

  const dias = diaDesdeEpoca(hoy) - diaDesdeEpoca(ultima);
  return dias >= 0 ? dias : 0;
}

/** Hasta dónde se mira para atrás al contar una racha: alcanza para el hito de 90 días. */
const DIAS_DE_HISTORIA = 95;

/**
 * Los días en que la persona hizo algo con EOS, para las rachas y el resumen
 * del lunes. Si no se puede leer, devuelve vacío: sin dato no hay festejo ni
 * aviso de racha, y cada franja cae a su texto de siempre.
 */
async function leerDiasActivos(admin: ClienteSinTipos, usuarioId: string, hoy: string): Promise<Set<string>> {
  const { data, error } = await admin
    .from("eos_action_commands")
    .select("created_at")
    .eq("usuario_id", usuarioId)
    .eq("estado", "completada")
    .neq("accion", "RESPONDER")
    // Un día de margen por el desfase entre UTC y Paraguay.
    .gte("created_at", `${sumarDias(hoy, -DIAS_DE_HISTORIA - 1)}T00:00:00Z`)
    .order("created_at", { ascending: false })
    .limit(3000);

  if (error || !Array.isArray(data)) return new Set();
  return diasActivos((data as { created_at?: string }[]).map((fila) => fila.created_at));
}

/** Franja "mediodía": una señal de uso real, no un texto genérico. */
async function contenidoMediodia(admin: ClienteSinTipos, usuarioId: string, hoy: string): Promise<AvisoMotivacional> {
  const dias = await diasSinAccion(admin, usuarioId, hoy);

  if (dias === 0) {
    // Ya anotó hoy: si con esto llega a un hito (3, 7, 14, 30 días…), se festeja.
    const festejo = avisoDeRacha(rachaHasta(await leerDiasActivos(admin, usuarioId, hoy), hoy));
    if (festejo) return festejo;

    return {
      titulo: "Vas bien hoy",
      cuerpo: "Ya le contaste algo a EOS hoy. Cada cosa que anotás ahora es una decisión más fácil mañana.",
    };
  }

  if (dias === null) {
    return {
      titulo: "Arrancá con lo de hoy",
      cuerpo: "Contale a EOS lo último que gastaste o vendiste. Una frase alcanza; ella lo clasifica y lo guarda.",
    };
  }

  if (dias <= 2) {
    return {
      titulo: "¿Qué pasó hoy?",
      cuerpo: `Hace ${dias === 1 ? "un día" : "dos días"} que no le contás nada a EOS. Un gasto o una venta de hoy alcanza para seguir el hilo.`,
    };
  }

  return {
    titulo: "Retomá con EOS",
    cuerpo: `Hace ${dias} días que no anotás nada. No hace falta ponerse al día de todo: contale lo de hoy y seguimos desde acá.`,
  };
}

/** Franja "noche": cierre del día, rotando por un pool chico. */
const CIERRES_NOCHE: AvisoMotivacional[] = [
  {
    titulo: "Cerrá el día",
    cuerpo: "Diez minutos antes de dormir alcanzan para no arrastrar nada a mañana. Contale a EOS lo que quedó suelto.",
  },
  {
    titulo: "Un repaso rápido",
    cuerpo: "¿Anotaste todo lo de hoy? Lo que no se anota, se olvida — y lo que se olvida no se puede decidir.",
  },
  {
    titulo: "Antes de cerrar",
    cuerpo: "Si hoy vendiste, gastaste o te prometiste algo con un cliente, decíselo a EOS ahora, mientras te acordás.",
  },
  {
    titulo: "Lo que ya hiciste hoy",
    cuerpo: "Cada venta cargada y cada gasto anotado ya es camino recorrido. Date un momento para verlo antes de cerrar el día.",
  },
  {
    titulo: "¿Cómo te fue hoy?",
    cuerpo: "Contámelo en una frase y lo dejo anotado. Mañana arrancás sabiendo dónde estás parado.",
  },
  {
    titulo: "Mañana se decide mejor con lo de hoy",
    cuerpo: "Lo que vendiste y lo que gastaste hoy es lo que mañana te dice si vas bien. Dejalo anotado.",
  },
  {
    titulo: "Dos minutos y cerrás",
    cuerpo: "¿Quedó algún cobro por hacer o un pago por recordar? Decímelo y te lo recuerdo yo.",
  },
  {
    titulo: "No te lleves pendientes a la cama",
    cuerpo: "Lo que te ronda la cabeza, dejámelo a mí. Anotalo en EOS y mañana lo retomamos.",
  },
];

function contenidoNoche(dia: number): AvisoMotivacional {
  return rotar(CIERRES_NOCHE, dia);
}

async function contenidoDeFranja(
  admin: ClienteSinTipos,
  usuarioId: string,
  franja: Franja,
  hoy: string,
  dia: number,
): Promise<{ indice: number; aviso: AvisoMotivacional }> {
  if (franja === "manana") {
    // El lunes la mañana es del resumen de la semana: es el único día en que
    // "cómo te fue" tiene una semana entera para contestar.
    if (esLunes(hoy)) {
      const activos = diasActivosEnLaSemana(await leerDiasActivos(admin, usuarioId, hoy), hoy);
      return { indice: 0, aviso: avisoSemanal(activos) };
    }
    return { indice: 0, aviso: await contenidoManana(admin, usuarioId, hoy, dia) };
  }
  if (franja === "mediodia") return { indice: 0, aviso: await contenidoMediodia(admin, usuarioId, hoy) };

  // A la noche, antes que el cierre genérico: si hay una racha y hoy todavía
  // no se anotó nada, eso es lo que la persona querría saber mientras puede.
  const enRiesgo = avisoRachaEnRiesgo(await leerDiasActivos(admin, usuarioId, hoy), hoy);
  if (enRiesgo) return { indice: 0, aviso: enRiesgo };

  const indice = ((dia % CIERRES_NOCHE.length) + CIERRES_NOCHE.length) % CIERRES_NOCHE.length;
  return { indice, aviso: contenidoNoche(dia) };
}

export type ResumenMotivacionalesPush = {
  franja: Franja;
  evaluados: number;
  enviados: number;
  sin_dispositivo: number;
  /** Tenía teléfono y el servicio de push lo rechazó. Distinto de no tener dónde mandar. */
  fallidos: number;
  apagados: number;
  con_error: number;
  /**
   * Por qué fallaron los que fallaron, sin repetir y sin tokens.
   *
   * Del 10 al 15 de noviembre de 2026 este resumen dijo "enviados: 0,
   * sin_dispositivo: 2" tres veces por día, en verde, mientras Apple
   * rechazaba la credencial (`InvalidProviderToken`). La razón existía, pero
   * se quedaba en `avisarNativo` y nunca llegaba a quien mira la corrida.
   */
  razones: string[];
};

const MAX_RAZONES = 6;

/** Le saca a la razón la cola del token (" · ...A1B2C3") para que dos teléfonos con el mismo fallo cuenten una vez. */
function razonSinToken(razon: string): string {
  return razon.replace(/ · \.\.\.[0-9A-Za-z_-]{1,8}/g, "").trim();
}

/** Quién tiene al menos un dispositivo nativo registrado: sin eso, no hay a quién mandarle nada. */
async function candidatos(admin: ClienteSinTipos): Promise<string[] | null> {
  const { data, error } = await admin.from("dispositivos_push").select("usuario_id").limit(2000);
  if (error) {
    console.error("Push motivacional: no se pudo leer dispositivos_push:", error);
    return null;
  }

  const ids = new Set<string>();
  for (const f of (data ?? []) as { usuario_id: string }[]) ids.add(f.usuario_id);
  return [...ids].slice(0, MAX_USUARIOS);
}

type Enviar = (
  admin: ClienteSinTipos,
  usuarioId: string,
  aviso: AvisoMotivacional,
) => Promise<{ enviados: number; fallidos?: number; razones?: string[] }>;

async function enviarDeVerdad(admin: ClienteSinTipos, usuarioId: string, aviso: AvisoMotivacional) {
  return avisarNativo(admin, usuarioId, {
    titulo: aviso.titulo,
    cuerpo: resumirParaPush(aviso.cuerpo, 160),
    url: "/eos/chat",
  });
}

export async function enviarMotivacionalesPush(
  admin: ClienteSinTipos,
  franja: Franja,
  opciones: { hoy?: string; enviar?: Enviar } = {},
): Promise<ResumenMotivacionalesPush> {
  const hoy = opciones.hoy ?? hoyEnParaguay();
  const enviar = opciones.enviar ?? enviarDeVerdad;
  const dia = diaDesdeEpoca(hoy);

  const resumen: ResumenMotivacionalesPush = {
    franja,
    evaluados: 0,
    enviados: 0,
    sin_dispositivo: 0,
    fallidos: 0,
    apagados: 0,
    con_error: 0,
    razones: [],
  };

  const ids = await candidatos(admin);
  if (ids === null) return resumen;

  const corte = new Date(Date.now() - DIAS_DE_GRACIA_CUENTA_NUEVA * 86_400_000).toISOString();

  for (const uid of ids) {
    resumen.evaluados += 1;

    try {
      const [{ data: preferencia }, { data: perfil }] = await Promise.all([
        admin.from("eos_followup_preferences").select("avisos_motivacionales_push").eq("usuario_id", uid).maybeSingle(),
        admin.from("usuarios").select("created_at").eq("id", uid).maybeSingle(),
      ]);

      if ((preferencia as { avisos_motivacionales_push?: boolean } | null)?.avisos_motivacionales_push === false) {
        resumen.apagados += 1;
        continue;
      }

      const creada = (perfil as { created_at?: string } | null)?.created_at;
      if (creada && creada > corte) {
        continue;
      }

      const { indice, aviso } = await contenidoDeFranja(admin, uid, franja, hoy, dia);

      const { error: errReclamo } = await admin
        .from(TABLA)
        .insert({ usuario_id: uid, fecha: hoy, franja, indice });

      // 23505: ya se mandó esta franja hoy (otra ejecución, o un reintento). No es un error.
      if (errReclamo) {
        if ((errReclamo as { code?: string }).code !== "23505") {
          console.error("Push motivacional: no se pudo reclamar el envío:", errReclamo);
          resumen.con_error += 1;
        }
        continue;
      }

      const resultado = await enviar(admin, uid, aviso);

      if (resultado.enviados > 0) {
        resumen.enviados += 1;
        continue;
      }

      // No llegó a ningún teléfono: se devuelve el reclamo. Si queda tomado,
      // arreglar la configuración a media tarde no alcanza para que la franja
      // de hoy salga — habría que esperar a mañana para saber si anduvo.
      await admin.from(TABLA).delete().eq("usuario_id", uid).eq("fecha", hoy).eq("franja", franja);

      if ((resultado.fallidos ?? 0) > 0) {
        resumen.fallidos += 1;
      } else {
        resumen.sin_dispositivo += 1;
      }

      for (const razon of resultado.razones ?? []) {
        const limpia = razonSinToken(razon);
        if (limpia && !resumen.razones.includes(limpia) && resumen.razones.length < MAX_RAZONES) {
          resumen.razones.push(limpia);
        }
      }
    } catch (error) {
      resumen.con_error += 1;
      console.error(`Push motivacional: falló ${uid} (${franja}):`, error instanceof Error ? error.message : error);
    }
  }

  return resumen;
}
