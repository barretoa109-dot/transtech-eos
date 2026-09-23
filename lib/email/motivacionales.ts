import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { crearTokenBaja } from "./baja.ts";
import { envolverEmailDeMarca, escaparHtml, primerNombre } from "./marca.ts";
import { lineaPersonal } from "./consejoDeObjetivo.ts";

/**
 * Correo motivacional, uno cada 3 días.
 *
 * Reglas, todas deliberadas:
 *
 *  - EL RELOJ ES UN NÚMERO, no una fecha guardada. `cicloDe(hoy)` sube de a uno
 *    cada 3 días calendario, y el UNIQUE (usuario_id, ciclo) de la tabla hace
 *    de idempotencia y de cadencia a la vez. El cron corre todos los días; solo
 *    el primero de cada ciclo encuentra gente sin su correo.
 *  - SE RECLAMA ANTES DE MANDAR, como los transaccionales: dos ejecuciones
 *    solapadas del cron no mandan el mismo correo dos veces. Si Resend falla,
 *    se suelta el reclamo y mañana (mismo ciclo) se reintenta.
 *  - NO SE MANDA A LA CUENTA RECIÉN NACIDA. Ya recibió la bienvenida; uno de
 *    acompañamiento el mismo día es ruido.
 *  - TIENE BAJA DE UN CLIC en cada correo. Es lo que separa un correo de
 *    acompañamiento de spam.
 *  - UN MENSAJE POR CICLO PARA TODOS (`ciclo % mensajes`): no hace falta contar
 *    lo que ya recibió cada uno, y la rotación es la misma para todas las
 *    cuentas. La parte de ARRIBA del mensaje (el título, el cierre, el botón)
 *    es igual para todos por ciclo; la de ABAJO del saludo es personal —cómo
 *    va su objetivo, o un consejo financiero si todavía no tiene uno— y se
 *    arma por persona (`lib/email/consejoDeObjetivo.ts`). Ver ahí por qué hoy
 *    casi siempre es el consejo: 0 de 6 cuentas reales tenían un objetivo con
 *    plata el 21 de septiembre de 2026.
 */

export const MOTIVO_BAJA = "motivacionales";
const TABLA = "eos_emails_motivacionales_v188";
const DIAS_POR_CICLO = 3;
const DIAS_DE_GRACIA_CUENTA_NUEVA = 3;
const PAGINA = 500;

export type Mensaje = {
  asunto: string;
  titulo: string;
  parrafos: string[];
  ctaTexto: string;
};

/**
 * El pool rota por ciclo: a los 3 días toca el siguiente, y con 12 mensajes
 * cada uno vuelve a aparecer cada 36 días. Ninguno promete nada del producto
 * que no exista hoy: hablan de hábitos, y el botón lleva al chat.
 */
export const MENSAJES: Mensaje[] = [
  {
    asunto: "Lo que anotás hoy es lo que decidís mañana",
    titulo: "Lo que anotás hoy es lo que decidís mañana",
    parrafos: [
      "Un gasto chico anotado a tiempo vale más que un balance perfecto a fin de mes. Lo que no se anota se olvida, y lo que se olvida no se puede decidir.",
      "Contale a EOS lo último que gastaste o vendiste. Una frase alcanza; ella lo clasifica y lo guarda.",
    ],
    ctaTexto: "Contarle a EOS",
  },
  {
    asunto: "Un paso chico también es avanzar",
    titulo: "Un paso chico también es avanzar",
    parrafos: [
      "No hace falta ordenar todo hoy. Alcanza con un movimiento: una venta cargada, una deuda anotada, un cliente nuevo.",
      "La constancia le gana a la perfección. Lo que hacés cada semana pesa más que lo que prometés hacer algún día.",
    ],
    ctaTexto: "Dar un paso",
  },
  {
    asunto: "Tu negocio no se maneja de memoria",
    titulo: "Tu negocio no se maneja de memoria",
    parrafos: [
      "Cuando todo está en tu cabeza, cada decisión pesa el doble: tenés que acordarte y además pensar.",
      "Pasale a EOS lo que tenés en la cabeza. Te lo devuelve ordenado y vos te quedás con lo importante: decidir.",
    ],
    ctaTexto: "Sacármelo de la cabeza",
  },
  {
    asunto: "Cinco minutos para ordenar la semana",
    titulo: "Cinco minutos para ordenar la semana",
    parrafos: [
      "Casi nadie se arrepiente de haberse tomado cinco minutos para mirar qué viene. Casi todos se arrepienten de no haberlo hecho antes de que llegara el vencimiento.",
      "Preguntale a EOS qué tenés pendiente esta semana y con eso armás el día.",
    ],
    ctaTexto: "Ver mi semana",
  },
  {
    asunto: "Los números tranquilizan",
    titulo: "Los números tranquilizan",
    parrafos: [
      "La incertidumbre cansa más que una mala noticia. Saber cuánto tenés, cuánto debés y cuánto viene te devuelve el control aunque el número no sea el que querías.",
      "Preguntale a EOS cómo estás hoy. Vas a saberlo en una respuesta.",
    ],
    ctaTexto: "¿Cómo estoy hoy?",
  },
  {
    asunto: "Constancia antes que perfección",
    titulo: "Constancia antes que perfección",
    parrafos: [
      "Un registro incompleto que se hace todos los días sirve más que uno impecable que se abandona a la segunda semana.",
      "Si te salteaste unos días, no pasa nada: no hace falta ponerse al día de todo. Contale a EOS lo de hoy y seguimos desde acá.",
    ],
    ctaTexto: "Retomar hoy",
  },
  {
    asunto: "Ese cliente que quedó pendiente",
    titulo: "Ese cliente que quedó pendiente",
    parrafos: [
      "Casi siempre hay una venta esperando un mensaje tuyo: un presupuesto sin respuesta, un cliente al que le prometiste llamar.",
      "Anotalo con EOS ahora, mientras te acordás. Un seguimiento a tiempo es plata que ya estaba en la mesa.",
    ],
    ctaTexto: "Anotar el pendiente",
  },
  {
    asunto: "Ponele nombre a tu próxima meta",
    titulo: "Ponele nombre a tu próxima meta",
    parrafos: [
      "Una meta con nombre y fecha deja de ser un deseo y pasa a ser un plan. \"Juntar para el auto\" no es lo mismo que \"juntar Gs. 5.000.000 para diciembre\".",
      "Decile a EOS qué querés lograr y ella te ayuda a seguirlo.",
    ],
    ctaTexto: "Crear mi meta",
  },
  {
    asunto: "Lo que se mide, mejora",
    titulo: "Lo que se mide, mejora",
    parrafos: [
      "No hace falta medir todo. Elegí un número que te importe —lo que vendiste esta semana, lo que gastaste en salidas— y mirálo cada tanto.",
      "Con solo mirarlo ya empezás a cuidarlo. EOS te lo tiene siempre a mano.",
    ],
    ctaTexto: "Ver mis números",
  },
  {
    asunto: "Cerrá la semana con la cabeza liviana",
    titulo: "Cerrá la semana con la cabeza liviana",
    parrafos: [
      "Lo que queda sin anotar se acumula y después cuesta el triple. Diez minutos ahora te ahorran la tarde entera del fin de mes.",
      "Contale a EOS lo que quedó suelto esta semana y cerrá tranquilo.",
    ],
    ctaTexto: "Cerrar la semana",
  },
  {
    asunto: "Mirá todo lo que ya hiciste",
    titulo: "Mirá todo lo que ya hiciste",
    parrafos: [
      "Es fácil mirar solo lo que falta. Pero cada venta cargada, cada deuda saldada y cada mes ordenado ya es camino recorrido.",
      "Date un momento para verlo. Y si hoy hiciste algo que vale la pena, contáselo a EOS.",
    ],
    ctaTexto: "Ver lo que llevo",
  },
  {
    asunto: "Vos decidís, EOS se ocupa del resto",
    titulo: "Vos decidís, EOS se ocupa del resto",
    parrafos: [
      "El trabajo manual no es tu trabajo: es de EOS. Clasificar, guardar, sumar y avisarte a tiempo lo hace ella.",
      "Tu parte es la más valiosa: mirar, decidir y avanzar. Empezá por contarle algo de tu día.",
    ],
    ctaTexto: "Abrir EOS",
  },
];

/** Cuántos días completos pasaron desde 1970 hasta la fecha `YYYY-MM-DD`. */
function diasDesdeEpoca(hoy: string): number {
  const [anio, mes, dia] = hoy.split("-").map(Number);
  return Math.floor(Date.UTC(anio, mes - 1, dia) / 86_400_000);
}

/** Número de ciclo de 3 días al que pertenece `hoy` (`YYYY-MM-DD`). */
export function cicloDe(hoy: string): number {
  return Math.floor(diasDesdeEpoca(hoy) / DIAS_POR_CICLO);
}

export function mensajeDelCiclo(ciclo: number): { indice: number; mensaje: Mensaje } {
  const indice = ((ciclo % MENSAJES.length) + MENSAJES.length) % MENSAJES.length;
  return { indice, mensaje: MENSAJES[indice] };
}

export function urlDeBaja(appUrl: string, usuarioId: string, secreto: string): string {
  const token = crearTokenBaja(usuarioId, MOTIVO_BAJA, secreto);
  return `${appUrl}/api/correos/baja?u=${encodeURIComponent(usuarioId)}&t=${token}`;
}

export function redactarMotivacional(params: {
  mensaje: Mensaje;
  nombre: string | null | undefined;
  appUrl: string;
  urlBaja: string;
  /** Cómo va su objetivo, o un consejo financiero. Ver `consejoDeObjetivo.ts`. */
  lineaPersonal: string;
}): { asunto: string; html: string; texto: string } {
  const { mensaje, appUrl, urlBaja, lineaPersonal } = params;
  const nombre = primerNombre(params.nombre);
  const saludo = nombre ? `Hola ${nombre},` : "Hola,";
  const urlChat = `${appUrl}/eos/chat`;

  // La línea personal va justo después del saludo y antes del mensaje
  // rotativo: es lo más importante que el correo tiene para decirle a ESTA
  // persona, y no un párrafo más entre otros.
  const parrafos = [saludo, lineaPersonal, ...mensaje.parrafos];

  const html = envolverEmailDeMarca({
    titulo: mensaje.titulo,
    parrafos: parrafos.map(escaparHtml),
    ctaTexto: mensaje.ctaTexto,
    ctaUrl: urlChat,
    pieHtml: `<p style="margin:24px 0 0;color:#94a3b8;line-height:1.6;font-size:12px;">Te escribimos porque tenés una cuenta en EOS. Si no querés recibir estos correos, <a href="${urlBaja}" style="color:#94a3b8;">darte de baja</a> lleva un clic.</p>`,
  });

  const texto = [
    ...parrafos.flatMap((p) => [p, ""]),
    `${mensaje.ctaTexto}: ${urlChat}`,
    "",
    `Si no querés recibir estos correos, date de baja acá: ${urlBaja}`,
  ].join("\n");

  return { asunto: mensaje.asunto, html, texto };
}

export type CorreoMotivacional = {
  para: string;
  asunto: string;
  html: string;
  texto: string;
  urlBaja: string;
};

export type ResumenMotivacionales = {
  ciclo: number;
  enviados: number;
  fallidos: number;
  /** Quedaron cuentas sin correo por el tope de la ejecución: siguen mañana. */
  pendientes: boolean;
};

/**
 * Manda el correo del ciclo a quien todavía no lo recibió.
 *
 * Idempotente: se puede llamar todos los días. Los días que no es el primero
 * del ciclo solo encuentra a quien falló o quedó fuera del tope de la vez
 * anterior.
 */
export async function enviarMotivacionales(
  admin: ClienteSinTipos,
  opciones: {
    hoy: string;
    appUrl: string;
    secreto: string;
    enviar: (correo: CorreoMotivacional) => Promise<void>;
    ahora?: Date;
    max?: number;
  },
): Promise<ResumenMotivacionales> {
  const { hoy, appUrl, secreto, enviar, ahora = new Date(), max = 200 } = opciones;

  const ciclo = cicloDe(hoy);
  const { indice, mensaje } = mensajeDelCiclo(ciclo);
  const resumen: ResumenMotivacionales = { ciclo, enviados: 0, fallidos: 0, pendientes: false };

  const [{ data: reclamados, error: errReclamados }, { data: bajas, error: errBajas }] =
    await Promise.all([
      admin.from(TABLA).select("usuario_id").eq("ciclo", ciclo),
      admin.from("eos_followup_preferences").select("usuario_id").eq("correos_motivacionales", false),
    ]);

  // Sin saber quién ya lo recibió o quién se dio de baja, no se manda a nadie:
  // adivinar acá termina en correos a quien pidió que no se los manden.
  if (errReclamados || errBajas) {
    throw new Error(
      `No se pudo leer el estado de los envíos: ${(errReclamados ?? errBajas)?.message ?? "desconocido"}`,
    );
  }

  const excluidos = new Set<string>([
    ...((reclamados ?? []) as { usuario_id: string }[]).map((r) => r.usuario_id),
    ...((bajas ?? []) as { usuario_id: string }[]).map((r) => r.usuario_id),
  ]);

  const corte = new Date(
    ahora.getTime() - DIAS_DE_GRACIA_CUENTA_NUEVA * 86_400_000,
  ).toISOString();

  for (let desde = 0; ; desde += PAGINA) {
    const { data: usuarios, error } = await admin
      .from("usuarios")
      .select("id,nombre,email")
      .not("email", "is", null)
      .lte("created_at", corte)
      .order("id")
      .range(desde, desde + PAGINA - 1);

    if (error) throw new Error(`No se pudieron leer los usuarios: ${error.message ?? "desconocido"}`);

    const pagina = (usuarios ?? []) as { id: string; nombre: string | null; email: string | null }[];

    for (const u of pagina) {
      if (!u.email || excluidos.has(u.id)) continue;

      if (resumen.enviados + resumen.fallidos >= max) {
        resumen.pendientes = true;
        return resumen;
      }

      const { error: errReclamo } = await admin
        .from(TABLA)
        .insert({ usuario_id: u.id, ciclo, indice });

      // 23505: otra ejecución ya lo reclamó. Cualquier otro error: no se manda.
      if (errReclamo) {
        if ((errReclamo as { code?: string }).code !== "23505") {
          console.error("Motivacionales: no se pudo reclamar el envío:", errReclamo);
        }
        continue;
      }

      const urlBaja = urlDeBaja(appUrl, u.id, secreto);
      // Nunca lanza por un problema de datos: sin objetivo, o si algo falla al
      // leerlo, cae sola al consejo financiero del ciclo (ver consejoDeObjetivo.ts).
      const personal = await lineaPersonal(admin, u.id, hoy, ciclo);
      const { asunto, html, texto } = redactarMotivacional({
        mensaje,
        nombre: u.nombre,
        appUrl,
        urlBaja,
        lineaPersonal: personal,
      });

      try {
        await enviar({ para: u.email, asunto, html, texto, urlBaja });
        resumen.enviados += 1;
      } catch (e) {
        resumen.fallidos += 1;
        console.error(`Motivacionales: falló el envío a ${u.id}:`, e instanceof Error ? e.message : e);

        // Se suelta el reclamo: el próximo cron del mismo ciclo lo reintenta.
        await admin.from(TABLA).delete().eq("usuario_id", u.id).eq("ciclo", ciclo);
      }
    }

    if (pagina.length < PAGINA) break;
  }

  return resumen;
}
