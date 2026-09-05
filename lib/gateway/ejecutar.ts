/**
 * Etapa 3: el Background Worker, adentro de Vercel.
 *
 * ============================================================
 * LO QUE ESTO ELIMINA NO ES UN NODO, ES UN VIAJE
 * ============================================================
 *
 * El Worker de n8n no ejecuta nada por su cuenta: lo único que hace es llamar
 * de vuelta a Vercel. El recorrido de hoy para registrar una venta es:
 *
 *   Vercel → n8n → Vercel (autorizar) → n8n → Vercel (efecto) → n8n → Vercel
 *
 * Seis saltos de red para dos llamadas a funciones que ya viven en este mismo
 * repositorio. Adentro del proceso, el recorrido es:
 *
 *   autorizar() → efecto()
 *
 * Se llaman los MISMOS handlers (`worker-authorize/v1` y `action-effects/v1`)
 * con un `Request` armado a mano, igual que `app/api/eos/route.ts` ya hace con
 * `ingestDocument`. No se duplica ni una línea de la lógica de autorización:
 * si se copiara, un día las dos copias dirían cosas distintas sobre si una
 * venta se puede ejecutar.
 *
 * ============================================================
 * TRES DE LAS CINCO RAMAS DEL WORKER ESTÁN ROTAS HOY
 * ============================================================
 *
 * Al portarlas se descubrió que apuntan a endpoints que NO EXISTEN en este
 * repositorio. Comprobado contra la lista de rutas del build, donde bajo
 * `/api/internal/` solo hay cuatro: `action-effects`, `consultar`, `salud` y
 * `worker-authorize`.
 *
 *   · DASH y BRIEF llaman a `/api/internal/worker-ping/v1`. No existe. El nodo
 *     sigue igual por `onError: continueRegularOutput`, pero `ping.ok` nunca
 *     es cierto, así que `authorized` queda en falso y la rama devuelve
 *     `{ok:false, error:'Worker no autorizado.'}`. Traducido: pedir el
 *     dashboard o el briefing por chat contesta hoy "No pude completar
 *     automáticamente".
 *   · FILE llama a `/api/internal/action-claims/v1` y
 *     `/api/internal/action-results/v1`. Ninguno de los dos existe.
 *   · RESP también pinga, pero no importa: el gateway saltea esa rama entera
 *     cuando no hay acciones, que es siempre.
 *
 * Acá adentro el ping sobra —ya estamos del lado autorizado, no hay red que
 * cruzar— así que DASH y BRIEF vuelven a funcionar solas. FILE no se porta:
 * ver abajo.
 *
 * Aparte, y para el camino que corre HOY, se agregó
 * `app/api/internal/worker-ping/v1`: es un arreglo de producción que no
 * depende de ninguna bandera.
 */

import { adminSinTipos } from "../supabase/sin-tipos.ts";
import type { Job } from "./jobs.ts";
import type { ResultadoWorker } from "./resultados.ts";

/**
 * Los dos handlers que este ejecutor orquesta.
 *
 * Se inyectan en vez de importarse arriba, por dos motivos. El primero es que
 * las rutas usan el alias `@/`, que Next resuelve al construir pero
 * `node --test` no: un import estático dejaría este archivo fuera de los
 * tests. El segundo es mejor: permite probar el reparto de ramas sin abrir una
 * conexión a Supabase ni tocar la puerta de autonomía.
 */
export type Puertas = {
  autorizar: (r: Request) => Promise<Response>;
  efecto: (r: Request) => Promise<Response>;
};

async function puertasReales(): Promise<Puertas> {
  const [gate, efectos] = await Promise.all([
    import("@/app/api/internal/worker-authorize/v1/route"),
    import("@/app/api/internal/action-effects/v1/route"),
  ]);
  return { autorizar: gate.POST, efecto: efectos.POST };
}

/** Las que la rama INT del worker acepta. Misma lista que n8n. */
export const ACCIONES_INTERNAS = new Set([
  "CREAR_TAREA",
  "CREAR_OBJETIVO",
  "GUARDAR_MEMORIA",
  "REGISTRAR_VENTA",
  "AJUSTAR_STOCK",
  "CREAR_CONTACTO",
]);

/** Qué se le dice a la persona cuando la acción salió bien. */
const HECHO: Record<string, string> = {
  CREAR_TAREA: "La tarea quedó registrada.",
  CREAR_OBJETIVO: "El objetivo quedó creado.",
  GUARDAR_MEMORIA: "Guardé esa información en la memoria empresarial.",
  REGISTRAR_VENTA: "La venta quedó registrada. La ves en Negocio > Ventas.",
  AJUSTAR_STOCK: "Ajusté el stock. Lo ves en Negocio > Productos.",
  CREAR_CONTACTO: "El contacto quedó guardado. Lo ves en Negocio > Contactos.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function esUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/**
 * Llama a un handler de este mismo repo sin salir a la red.
 *
 * El `Authorization` va igual: el handler lo comprueba con `timingSafeEqual` y
 * saltearlo pediría una segunda puerta de entrada sin token, que es
 * exactamente la clase de atajo que después queda abierto.
 */
async function enProceso(
  handler: (r: Request) => Promise<Response>,
  url: string,
  cuerpo: unknown,
  secreto: string,
): Promise<Record<string, unknown>> {
  const respuesta = await handler(
    new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secreto}` },
      body: JSON.stringify(cuerpo),
    }),
  );

  const datos: unknown = await respuesta.json().catch(() => null);
  return datos && typeof datos === "object" && !Array.isArray(datos)
    ? (datos as Record<string, unknown>)
    : { ok: false, error: `Respuesta ilegible (${respuesta.status}).` };
}

/**
 * La rama INT: autorizar y, si corresponde, ejecutar.
 *
 * `execute` sale de la puerta de autonomía, no de acá. Cuando dice que no, la
 * acción NO se ejecuta y se explica por qué: puede estar esperando aprobación,
 * puede haberse hecho ya, o puede estar bloqueada. Los tres casos se ven
 * distinto para quien pregunta y por eso se distinguen.
 */
async function ramaInterna(
  job: Job,
  secreto: string,
  puertas: Puertas,
): Promise<ResultadoWorker> {
  const cuerpoAuth = {
    usuario_id: job.usuario_id,
    request_id: job.request_id,
    accion: job.accion.tipo,
    /*
     * Este objeto es el que se convierte en la huella durable del comando.
     * Su forma tiene que ser IDÉNTICA a la que arma el nodo `01 INT Preparar`
     * de n8n: si cambiara, un mismo pedido tendría huellas distintas según
     * quién lo atendió, y el gate dejaría de reconocer los reintentos.
     */
    payload: {
      mensaje: job.mensaje,
      datos: job.accion.datos,
      metadata: job.metadata,
    },
    conversacion_id: job.conversacion_id,
    origen: "vercel-gateway-ts",
  };

  const auth = await enProceso(
    puertas.autorizar,
    "https://eos.internal/api/internal/worker-authorize/v1",
    cuerpoAuth,
    secreto,
  );

  const puedeEjecutar = auth.ok === true && auth.execute === true && esUuid(auth.command_id);

  if (!puedeEjecutar) {
    const yaEstaba = auth.decision === "completed";
    const decision = String(auth.decision ?? "block");

    const respuesta = yaEstaba
      ? "Esta acción ya había sido completada y no se repitió."
      : decision === "approval" || decision === "approval_ready"
        ? "Esta acción requiere aprobación antes de ejecutarse."
        : decision === "prepare" || decision === "recommend"
          ? "La acción quedó sin ejecución automática por la configuración de autonomía actual."
          : String(auth.reason ?? auth.error ?? "La acción fue bloqueada por seguridad.");

    return {
      // `ok: false` solo cuando la puerta falló de verdad. Que una acción
      // quede esperando aprobación NO es un error: es el sistema haciendo lo
      // que se le pidió, y mostrarlo como fallo asusta sin motivo.
      ok: auth.ok !== false,
      executed: false,
      idempotent: yaEstaba || auth.command_idempotent === true,
      decision,
      reason: String(auth.reason ?? auth.error ?? ""),
      respuesta,
      request_id: job.request_id,
      command_id: auth.command_id ?? null,
      accion: job.accion.tipo,
      estado: yaEstaba ? "completada" : null,
      resultado: auth.resultado ?? {},
    };
  }

  const resultado = await enProceso(
    puertas.efecto,
    "https://eos.internal/api/internal/action-effects/v1",
    { command_id: auth.command_id },
    secreto,
  );

  const salioBien = resultado.ok === true && Boolean(resultado.command_id);

  return {
    ok: salioBien,
    executed: salioBien,
    idempotent: resultado.idempotent === true,
    request_id: job.request_id,
    command_id: resultado.command_id ?? auth.command_id,
    accion: job.accion.tipo,
    estado: resultado.estado ?? (salioBien ? "completada" : "error"),
    effect_type: resultado.effect_type ?? "",
    effect_id: resultado.effect_id ?? null,
    resultado: resultado.resultado ?? {},
    respuesta: salioBien
      ? (HECHO[job.accion.tipo] ?? "La acción quedó completada.")
      : String(resultado.error ?? "No fue posible completar la acción interna."),
  };
}

/**
 * Las lecturas: dashboard y briefing.
 *
 * En n8n estas dos ramas piden permiso a un endpoint que no existe y por eso
 * fallan siempre. Acá no hay a quién pedirle permiso: la sesión ya se validó
 * en `app/api/eos/route.ts` y el `usuario_id` del job viene de ahí, no del
 * cuerpo del pedido. Se lee con `adminSinTipos()` —que NO pasa por RLS— así
 * que el filtro por usuario va a mano y es el que no se puede olvidar.
 */
async function ramaLectura(job: Job): Promise<ResultadoWorker> {
  const esDashboard = job.accion.tipo === "VER_DASHBOARD";
  const tabla = esDashboard ? "eos_dashboard_metrics" : "eos_daily_briefings";

  const { data, error } = await adminSinTipos()
    .from(tabla)
    .select("*")
    .eq("usuario_id", job.usuario_id)
    .order(esDashboard ? "updated_at" : "created_at", { ascending: false })
    .limit(esDashboard ? 10 : 1);

  if (error) {
    console.error("Gateway TS: no se pudo leer", tabla, error);
    return {
      ok: false,
      executed: false,
      request_id: job.request_id,
      accion: job.accion.tipo,
      error: esDashboard ? "No pude leer tu dashboard." : "No pude leer tu briefing.",
    };
  }

  const filas = (data ?? []) as Record<string, unknown>[];

  if (esDashboard) {
    const lineas = filas
      .map(
        (m) =>
          `- ${m.metric_label ?? m.metric_key ?? "Métrica"}: ${m.metric_value ?? m.metric_number ?? "sin valor"}`,
      )
      .join("\n");

    return {
      ok: true,
      executed: true,
      request_id: job.request_id,
      accion: job.accion.tipo,
      tipo: "texto",
      respuesta: `Dashboard EOS:\n${lineas || "Todavía no hay métricas cargadas para este usuario."}`,
    };
  }

  /*
   * El briefing se arma con las mismas columnas y en el mismo orden que n8n:
   * `resumen` y las tres prioridades. La tabla no tiene un campo con el texto
   * ya escrito —lo arma quien lo muestra— así que acá se repite la forma.
   */
  const b = filas[0];
  const resumen = typeof b?.resumen === "string" ? b.resumen.trim() : "";

  const prioridad = (n: 1 | 2 | 3) => {
    const v = b?.[`prioridad_${n}`];
    return typeof v === "string" && v.trim() ? v.trim() : "Sin prioridad";
  };

  const texto = resumen
    ? `Briefing EOS:\n${resumen}\n\nPrioridades:\n1. ${prioridad(1)}\n2. ${prioridad(2)}\n3. ${prioridad(3)}`
    : "Todavía no hay briefing generado para este usuario.";

  return {
    ok: true,
    executed: true,
    request_id: job.request_id,
    accion: job.accion.tipo,
    tipo: "texto",
    respuesta: texto,
  };
}

/**
 * Un job, ejecutado adentro del proceso.
 *
 * ============================================================
 * POR QUÉ NO SE PORTA LA RAMA DE ARCHIVOS
 * ============================================================
 *
 * `GENERAR_EXCEL`, `GENERAR_PDF` y `GENERAR_WORD` van por la rama FILE de
 * n8n, que llama a `/api/internal/action-claims/v1` y
 * `/api/internal/action-results/v1`. **Ninguno de los dos existe en este
 * repositorio**, así que esa rama no puede completarse hoy por ningún camino.
 *
 * Portarla exigiría inventar los dos endpoints —con sus leases y su
 * idempotencia— para un camino que además quedó superado: desde que el modelo
 * manda `documento`, los archivos los arma `app/api/eos/route.ts` con
 * `guardarDocumento`, y `respuesta.ts` descarta las acciones GENERAR_* cuando
 * viene documento justamente para que no se hagan las dos cosas.
 *
 * Así que se devuelve un error claro en vez de un fracaso genérico. El
 * resultado visible para la persona es el mismo que hoy —el archivo no sale
 * por este camino— pero ahora dice por qué, y no se construyó un sistema
 * entero para sostener algo que ya tiene reemplazo.
 */
export async function ejecutarEnProceso(job: Job, puertas?: Puertas): Promise<ResultadoWorker> {
  const secreto = (process.env.EOS_WORKER_GATE_SECRET ?? "").trim();
  const tipo = job.accion.tipo;

  if (tipo === "RESPONDER") {
    // No hay nada que ejecutar: el texto ya lo escribió el modelo. En n8n esta
    // rama daba una vuelta entera para pegar un ping y devolver esto mismo.
    return {
      ok: true,
      executed: false,
      request_id: job.request_id,
      accion: "RESPONDER",
      respuesta: job.respuesta_gateway,
      tipo: "texto",
    };
  }

  if (tipo === "VER_DASHBOARD" || tipo === "VER_BRIEFING") {
    return ramaLectura(job);
  }

  if (ACCIONES_INTERNAS.has(tipo)) {
    if (!secreto) {
      // Sin el secreto no se puede autorizar, y sin autorizar no se ejecuta
      // nada. Se reporta y se termina: NO se intenta por otro lado.
      return {
        ok: false,
        executed: false,
        request_id: job.request_id,
        accion: tipo,
        error: "Falta EOS_WORKER_GATE_SECRET: no se puede autorizar la acción.",
      };
    }
    return ramaInterna(job, secreto, puertas ?? (await puertasReales()));
  }

  return {
    ok: false,
    executed: false,
    request_id: job.request_id,
    accion: tipo,
    error:
      "Los archivos no se generan por este camino. Pedilo de nuevo y EOS lo arma como documento.",
  };
}
