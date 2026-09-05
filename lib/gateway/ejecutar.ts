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
 * TRES DE LAS CINCO RAMAS DEL WORKER ESTABAN ROTAS
 * ============================================================
 *
 * Al portarlas se descubrió que apuntaban a endpoints que NO EXISTÍAN en este
 * repositorio. Comprobado contra la lista de rutas del build, donde bajo
 * `/api/internal/` solo había cuatro: `action-effects`, `consultar`, `salud` y
 * `worker-authorize`.
 *
 *   · DASH y BRIEF llamaban a `/api/internal/worker-ping/v1`. No existía. El
 *     nodo sigue igual por `onError: continueRegularOutput`, pero `ping.ok`
 *     nunca era cierto, así que `authorized` quedaba en falso y la rama
 *     devolvía `{ok:false, error:'Worker no autorizado.'}`. Traducido: pedir
 *     el dashboard o el briefing por chat contestaba "No pude completar
 *     automáticamente".
 *   · FILE llamaba a `/api/internal/action-claims/v1` y
 *     `/api/internal/action-results/v1`. Tampoco existían, así que no salía
 *     ninguna planilla.
 *   · RESP también pinga, pero no importa: el gateway saltea esa rama entera
 *     cuando no hay acciones, que es siempre.
 *
 * Lo difícil, en los tres casos, YA ESTABA: `eos_claim_action_command_v65` y
 * `eos_finalize_action_command_v70` viven en la base desde la v65 y la v70,
 * con lease, intentos contados y fencing token, y pasaron por cinco
 * migraciones de endurecimiento. Lo único que faltaba eran las puertas HTTP.
 *
 * Se escribieron las tres —`worker-ping/v1`, `action-claims/v1` y
 * `action-results/v1`— y **no dependen de ninguna bandera**: le devuelven el
 * dashboard, el briefing y las planillas al camino que corre HOY.
 *
 * Acá adentro, además, el ping sobra: ya estamos del lado autorizado y no hay
 * red que cruzar.
 */

import { adminSinTipos } from "../supabase/sin-tipos.ts";
import type { Job } from "./jobs.ts";
import type { ResultadoWorker } from "./resultados.ts";

/**
 * Los handlers que este ejecutor orquesta.
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
  /** Toma la orden con lease y fencing token. Solo la usa la rama de archivos. */
  tomar: (r: Request) => Promise<Response>;
  /** La cierra presentando el lease. Solo la usa la rama de archivos. */
  cerrar: (r: Request) => Promise<Response>;
};

async function puertasReales(): Promise<Puertas> {
  const [gate, efectos, claims, results] = await Promise.all([
    import("@/app/api/internal/worker-authorize/v1/route"),
    import("@/app/api/internal/action-effects/v1/route"),
    import("@/app/api/internal/action-claims/v1/route"),
    import("@/app/api/internal/action-results/v1/route"),
  ]);
  return {
    autorizar: gate.POST,
    efecto: efectos.POST,
    tomar: claims.POST,
    cerrar: results.POST,
  };
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

/** Las tres que van por la rama de archivos. */
export const ACCIONES_DE_ARCHIVO = new Set(["GENERAR_EXCEL", "GENERAR_PDF", "GENERAR_WORD"]);

/**
 * El nombre de archivo, sin acentos ni espacios.
 *
 * Igual que en n8n: `/descargar` vuelve a limpiarlo por su cuenta, pero el
 * nombre viaja también adentro del `resultado` durable, y ahí no lo limpia
 * nadie.
 */
function normalizarNombre(texto: string): string {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * La plantilla y el rubro, deducidos de lo que dijo la persona.
 *
 * OJO: hoy `/descargar` IGNORA el parámetro `plantilla` y siempre arma el
 * mismo Excel con `crearExcelNegocioUniversal`. O sea que esta elección
 * cambia el NOMBRE del archivo y nada más. Se conserva igual, y con los
 * mismos parámetros en la URL, para que este camino y el de n8n produzcan
 * exactamente la misma cadena mientras convivan y se puedan comparar.
 */
export function plantillaDe(texto: string, rubroDeclarado: string) {
  const t = texto.toLowerCase();

  if (/finanzas personales|deuda|deudas|ahorro|presupuesto personal|salir de deudas/.test(t)) {
    return { plantilla: "personal", rubro: "persona_fisica" };
  }
  if (/restaurante|gastronomia|comida|hamburg|pizza|cafeteria|bar/.test(t)) {
    return { plantilla: "business", rubro: "gastronomia" };
  }
  return { plantilla: "business", rubro: rubroDeclarado || "negocio_general" };
}

/**
 * La rama FILE: autorizar, tomar la orden, generar y cerrar.
 *
 * ============================================================
 * POR QUÉ ACÁ HAY UN CLAIM Y EN LA RAMA INTERNA NO
 * ============================================================
 *
 * Un efecto interno lo resuelve una sola función de Postgres y termina. Un
 * archivo puede tardar y puede reintentarse, así que el comando se TOMA con un
 * lease y se cierra presentando su `lease_token` y su `attempt_count`. Eso es
 * lo que impide que un intento que se colgó vuelva más tarde y pise el
 * resultado del intento bueno.
 *
 * ============================================================
 * PDF Y WORD NO ESTÁN CONECTADOS, Y SE DICE
 * ============================================================
 *
 * `/descargar` solo sabe hacer Excel: con cualquier otro `tipo` responde 400.
 * n8n ya cerraba esos comandos como `no_disponible` con un código explícito, y
 * acá se hace igual. La orden se cierra igual —no queda colgada ocupando su
 * lease— y la persona recibe una frase que dice qué pasó, no un error genérico.
 */
async function ramaArchivo(
  job: Job,
  secreto: string,
  puertas: Puertas,
  base: string,
): Promise<ResultadoWorker> {
  const datos = job.accion.datos;
  const tipo = job.accion.tipo;

  const auth = await enProceso(
    puertas.autorizar,
    "https://eos.internal/api/internal/worker-authorize/v1",
    {
      usuario_id: job.usuario_id,
      request_id: job.request_id,
      accion: tipo,
      // La misma forma que la rama interna: de acá sale la huella durable.
      payload: { mensaje: job.mensaje, datos, metadata: job.metadata },
      conversacion_id: job.conversacion_id,
      origen: "vercel-gateway-ts",
    },
    secreto,
  );

  if (!(auth.ok === true && auth.execute === true && esUuid(auth.command_id))) {
    const previo = (auth.resultado ?? {}) as Record<string, unknown>;
    const yaEstaba = auth.decision === "completed";
    const decision = String(auth.decision ?? "block");
    const urlPrevia = typeof previo.archivo_url === "string" ? previo.archivo_url : "";

    return {
      ok: auth.ok !== false,
      executed: false,
      idempotent: yaEstaba || auth.command_idempotent === true,
      decision,
      reason: String(auth.reason ?? auth.error ?? ""),
      request_id: job.request_id,
      command_id: auth.command_id ?? null,
      accion: tipo,
      estado: yaEstaba ? "completada" : null,
      archivo_url: urlPrevia,
      archivo_tipo: String(previo.archivo_tipo ?? ""),
      archivo_nombre: String(previo.archivo_nombre ?? ""),
      resultado: previo,
      respuesta:
        yaEstaba && urlPrevia
          ? `El archivo ya estaba listo.\n\nDescargar archivo: ${urlPrevia}`
          : yaEstaba
            ? "Esta generación ya había terminado y no se repitió."
            : decision === "approval" || decision === "approval_ready"
              ? "La generación requiere aprobación antes de ejecutarse."
              : decision === "prepare" || decision === "recommend"
                ? "La generación no se ejecutó automáticamente por la configuración de autonomía actual."
                : String(auth.reason ?? auth.error ?? "La generación fue bloqueada por seguridad."),
    };
  }

  const claim = await enProceso(
    puertas.tomar,
    "https://eos.internal/api/internal/action-claims/v1",
    { command_id: auth.command_id, lease_seconds: 300 },
    secreto,
  );

  const tomado =
    claim.ok === true &&
    claim.claimed === true &&
    esUuid(claim.command_id) &&
    esUuid(claim.lease_token) &&
    Number.isInteger(Number(claim.attempt_count)) &&
    Number(claim.attempt_count) > 0;

  if (!tomado) {
    // Dos casos distintos: ya estaba hecho, o lo tiene otro intento vivo.
    // Confundirlos haría que un archivo listo parezca un trabajo en curso.
    const previo = (claim.resultado ?? {}) as Record<string, unknown>;
    const completado = claim.code === "EOS_COMMAND_ALREADY_COMPLETED" || claim.estado === "completada";
    const urlPrevia = typeof previo.archivo_url === "string" ? previo.archivo_url : "";

    return {
      ok: claim.ok !== false,
      executed: false,
      idempotent: claim.idempotent === true,
      decision: String(claim.code ?? "not_claimed"),
      reason: String(claim.error ?? claim.code ?? ""),
      request_id: job.request_id,
      command_id: claim.command_id ?? auth.command_id,
      accion: tipo,
      estado: claim.estado ?? null,
      archivo_url: urlPrevia,
      archivo_tipo: String(previo.archivo_tipo ?? ""),
      archivo_nombre: String(previo.archivo_nombre ?? ""),
      resultado: previo,
      respuesta:
        completado && urlPrevia
          ? `El archivo ya estaba listo.\n\nDescargar archivo: ${urlPrevia}`
          : completado
            ? "Esta generación ya estaba completada y no se repitió."
            : "La generación ya está siendo procesada; no se inició una segunda copia.",
    };
  }

  const comandoId = String(claim.command_id);
  const esExcel = tipo === "GENERAR_EXCEL";

  let archivoUrl = "";
  let archivoNombre = "";
  const archivoTipo = esExcel ? "excel" : tipo === "GENERAR_PDF" ? "pdf" : "word";
  let estado = "no_disponible";
  let resultado: Record<string, unknown> = {};
  let codigoError: string | null = null;
  let mensajeError: string | null = null;

  if (esExcel) {
    const texto = [job.mensaje, datos.tema, datos.tipo, datos.rubro, datos.negocio, datos.descripcion]
      .filter(Boolean)
      .join(" ");

    const { plantilla, rubro } = plantillaDe(texto, String(datos.rubro ?? ""));
    const nombreBase = String(datos.negocio ?? datos.nombre ?? job.nombre ?? "usuario");

    archivoNombre =
      plantilla === "personal"
        ? `plan_financiero_eos_${normalizarNombre(nombreBase)}.xlsx`
        : `control_negocio_eos_${normalizarNombre(nombreBase)}.xlsx`;

    /*
     * Los mismos parámetros que manda n8n, en el mismo orden y con la MISMA
     * codificación.
     *
     * No se usa `URLSearchParams`: codifica el espacio como `+` y n8n como
     * `%20`. Las dos formas funcionan —`/descargar` decodifica las dos— pero
     * producen cadenas distintas, y esa cadena se guarda adentro del
     * `resultado` durable. Mientras los dos caminos convivan conviene que la
     * URL salga byte por byte igual, para que comparar una ejecución de n8n
     * con una de acá no muestre una diferencia que no significa nada.
     *
     * `plantilla`, `tema` y `command_id` hoy `/descargar` los ignora: solo lee
     * `tipo`, `nombre`, `rubro` y `negocio`. Se mandan igual por lo mismo.
     */
    const query = Object.entries({
      tipo: "excel",
      plantilla,
      nombre: archivoNombre.replace(/\.xlsx$/i, ""),
      rubro: String(rubro),
      negocio: nombreBase,
      tema: String(datos.tema ?? job.mensaje ?? "control general"),
      command_id: comandoId,
    })
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    archivoUrl = `${base}/descargar?${query}`;
    estado = "completada";
    resultado = {
      archivo_url: archivoUrl,
      archivo_tipo: archivoTipo,
      archivo_nombre: archivoNombre,
      artifact_key: `${comandoId}.xlsx`,
      command_id: comandoId,
    };
  } else {
    codigoError = tipo === "GENERAR_PDF" ? "PDF_GENERATOR_NOT_CONNECTED" : "WORD_GENERATOR_NOT_CONNECTED";
    mensajeError =
      tipo === "GENERAR_PDF"
        ? "El generador PDF todavía no está conectado."
        : "El generador Word todavía no está conectado.";
    resultado = { archivo_tipo: archivoTipo, disponible: false, command_id: comandoId };
  }

  const cierre = await enProceso(
    puertas.cerrar,
    "https://eos.internal/api/internal/action-results/v1",
    {
      command_id: comandoId,
      lease_token: claim.lease_token,
      attempt_count: Number(claim.attempt_count),
      estado,
      resultado,
      error_code: codigoError,
      error_message: mensajeError,
    },
    secreto,
  );

  const cerrado = cierre.ok === true;

  return {
    ok: cerrado,
    executed: cerrado && estado === "completada",
    idempotent: cierre.idempotent === true,
    request_id: job.request_id,
    command_id: cierre.command_id ?? comandoId,
    accion: tipo,
    estado: cierre.estado ?? estado,
    // Solo se ofrece la descarga si el cierre quedó registrado: un enlace a un
    // archivo cuyo comando no cerró es una promesa que nadie anotó.
    archivo_url: cerrado && esExcel ? archivoUrl : "",
    archivo_tipo: archivoTipo,
    archivo_nombre: archivoNombre,
    resultado: cierre.resultado ?? resultado,
    respuesta: cerrado
      ? esExcel
        ? `Tu Excel ya está listo.\n\nDescargar archivo: ${archivoUrl}`
        : (mensajeError ?? "Ese formato todavía no está disponible.")
      : String(cierre.error ?? "No fue posible cerrar el resultado del archivo de forma segura."),
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
 * DOS CAMINOS PARA UN ARCHIVO, Y NO SE PISAN
 * ============================================================
 *
 * Desde que el modelo manda `documento`, los archivos los arma
 * `app/api/eos/route.ts` con `guardarDocumento`, y `respuesta.ts` DESCARTA las
 * acciones `GENERAR_*` cuando viene documento, justamente para que no se hagan
 * las dos cosas y la persona reciba dos archivos por un pedido.
 *
 * La rama de archivos de acá es el otro camino: el que queda cuando el modelo
 * pide `GENERAR_EXCEL` sin mandar documento. Sigue vivo, ahora funciona, y no
 * compite con el otro porque nunca llegan los dos juntos.
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

  const necesitaPuerta = ACCIONES_INTERNAS.has(tipo) || ACCIONES_DE_ARCHIVO.has(tipo);

  if (necesitaPuerta && !secreto) {
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

  if (ACCIONES_INTERNAS.has(tipo)) {
    return ramaInterna(job, secreto, puertas ?? (await puertasReales()));
  }

  if (ACCIONES_DE_ARCHIVO.has(tipo)) {
    /*
     * La URL de descarga tiene que ser absoluta: viaja adentro del resultado
     * durable y se la va a abrir alguien desde su teléfono, no este proceso.
     * `EOS_APP_BASE_URL` es la misma variable que usa n8n; `NEXT_PUBLIC_SITE_URL`
     * queda de respaldo para desarrollo.
     */
    const base = (process.env.EOS_APP_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "")
      .trim()
      .replace(/\/$/, "");

    if (!base) {
      return {
        ok: false,
        executed: false,
        request_id: job.request_id,
        accion: tipo,
        error: "Falta EOS_APP_BASE_URL: no se puede armar el enlace de descarga.",
      };
    }

    return ramaArchivo(job, secreto, puertas ?? (await puertasReales()), base);
  }

  return {
    ok: false,
    executed: false,
    request_id: job.request_id,
    accion: tipo,
    error: `Acción no soportada por este worker: ${tipo}.`,
  };
}
