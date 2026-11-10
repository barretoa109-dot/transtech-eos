import { hoyEnParaguay } from "../fecha.ts";
import { objetivoPrincipal, lineaDeObjetivo, lineaDeConsejoFinanciero } from "../email/consejoDeObjetivo.ts";
import { avisarNativo } from "./nativo.ts";
import { resumirParaPush } from "./enviar.ts";
import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";

/**
 * Push motivacional nativo, hasta 3 veces por día ("franjas").
 *
 * Convive con el correo de cada 3 días (`lib/email/motivacionales.ts`), no lo
 * reemplaza — decisión del dueño, 2026-11-10. Reutiliza su misma fuente de
 * contenido (`consejoDeObjetivo.ts`) para la franja de la mañana en vez de
 * inventar un segundo texto para la misma pregunta ("¿cómo va mi objetivo?").
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

/**
 * Franja "mañana": cómo va el objetivo financiero principal, o un consejo si
 * todavía no tiene uno — igual que el correo, mismo motor.
 */
async function contenidoManana(admin: ClienteSinTipos, usuarioId: string, hoy: string, dia: number): Promise<AvisoMotivacional> {
  const estado = await objetivoPrincipal(admin, usuarioId, hoy);
  const cuerpo = estado ? lineaDeObjetivo(estado) : lineaDeConsejoFinanciero(dia);
  return { titulo: "Arrancá el día con un número claro", cuerpo };
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

/** Franja "mediodía": una señal de uso real, no un texto genérico. */
async function contenidoMediodia(admin: ClienteSinTipos, usuarioId: string, hoy: string): Promise<AvisoMotivacional> {
  const dias = await diasSinAccion(admin, usuarioId, hoy);

  if (dias === 0) {
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
];

function contenidoNoche(dia: number): AvisoMotivacional {
  const indice = ((dia % CIERRES_NOCHE.length) + CIERRES_NOCHE.length) % CIERRES_NOCHE.length;
  return CIERRES_NOCHE[indice];
}

async function contenidoDeFranja(
  admin: ClienteSinTipos,
  usuarioId: string,
  franja: Franja,
  hoy: string,
  dia: number,
): Promise<{ indice: number; aviso: AvisoMotivacional }> {
  if (franja === "manana") return { indice: 0, aviso: await contenidoManana(admin, usuarioId, hoy, dia) };
  if (franja === "mediodia") return { indice: 0, aviso: await contenidoMediodia(admin, usuarioId, hoy) };
  const indice = ((dia % CIERRES_NOCHE.length) + CIERRES_NOCHE.length) % CIERRES_NOCHE.length;
  return { indice, aviso: contenidoNoche(dia) };
}

export type ResumenMotivacionalesPush = {
  franja: Franja;
  evaluados: number;
  enviados: number;
  sin_dispositivo: number;
  apagados: number;
  con_error: number;
};

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

type Enviar = (admin: ClienteSinTipos, usuarioId: string, aviso: AvisoMotivacional) => Promise<{ enviados: number }>;

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
    apagados: 0,
    con_error: 0,
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
      } else {
        resumen.sin_dispositivo += 1;
      }
    } catch (error) {
      resumen.con_error += 1;
      console.error(`Push motivacional: falló ${uid} (${franja}):`, error instanceof Error ? error.message : error);
    }
  }

  return resumen;
}
