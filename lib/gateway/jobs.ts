/**
 * Etapa 2: traducir lo que pidió el modelo a jobs para el Worker.
 *
 * Puerto del nodo `06 GW Preparar Jobs Worker`, 11,2 KB. A diferencia de la
 * etapa 1, acá SÍ hay efectos durables del otro lado: una venta, un movimiento
 * de stock, un contacto.
 *
 * ============================================================
 * LA CANONICALIZACIÓN NO ES PROLIJIDAD, ES EXACT-ONCE
 * ============================================================
 *
 * El Worker Gate guarda una huella (sha256) del payload de cada comando, y la
 * usa para reconocer un reintento y no ejecutarlo dos veces. Ver `fingerprint`
 * en `lib/worker-gate-handler.ts`.
 *
 * OpenAI expresa el mismo concepto con nombres distintos: `titulo`, `nombre`,
 * `name` y `asunto` son la misma idea. Si el payload viajara tal cual sale del
 * modelo, dos llamadas con la misma intención darían dos huellas distintas, el
 * gate no reconocería el reintento y la venta se cargaría dos veces.
 *
 * Por eso todos los alias se llevan al MISMO contrato antes de armar el job.
 * Cualquier cambio acá cambia la huella de comandos ya emitidos y provoca
 * `EOS_COMMAND_PAYLOAD_MISMATCH` sobre reintentos legítimos.
 *
 * ============================================================
 * LO QUE NUNCA PUEDE ENTRAR EN EL JOB
 * ============================================================
 *
 * Nada que cambie entre dos ejecuciones de OpenAI para el mismo mensaje:
 * `openai_response_id`, `openai_status`, `openai_model`, ni ningún timestamp
 * de inferencia. Todos ellos cambian en cada llamada, y si formaran parte del
 * payload durable, cada reintento se vería como un comando nuevo.
 *
 * Hay un test que recorre el job entero y falla si alguno aparece.
 */

import type { Entrada } from "./entrada.ts";
import type { Accion, RespuestaGateway } from "./respuesta.ts";

/** A qué webhook del Worker va cada acción. */
export const RUTAS: Record<string, string> = {
  RESPONDER: "eos-worker-rc1-respond",
  CREAR_TAREA: "eos-worker-rc1-internal",
  CREAR_OBJETIVO: "eos-worker-rc1-internal",
  GUARDAR_MEMORIA: "eos-worker-rc1-internal",
  GENERAR_EXCEL: "eos-worker-rc1-file",
  GENERAR_PDF: "eos-worker-rc1-file",
  GENERAR_WORD: "eos-worker-rc1-file",
  VER_DASHBOARD: "eos-worker-rc1-dashboard",
  VER_BRIEFING: "eos-worker-rc1-briefing",

  /*
   * Todo lo que deja un efecto durable en la base va por el mismo camino
   * interno: una venta, un producto, un movimiento personal, una corrección.
   * Lo que las distingue no es el worker sino su riesgo, y eso lo decide
   * `lib/autonomia/riesgo.ts`.
   *
   * Este mapa se había quedado en tres mientras n8n llegaba a doce, igual que
   * `ACCIONES_PERMITIDAS` y `ACCIONES_INTERNAS`. Como el gateway en TypeScript
   * vive detrás de una bandera, la diferencia no se veía: el día que se
   * prendiera, una venta habría salido sin ruta. Hay una prueba que lo compara
   * contra la lista del prompt.
   */
  REGISTRAR_VENTA: "eos-worker-rc1-internal",
  AJUSTAR_STOCK: "eos-worker-rc1-internal",
  CREAR_CONTACTO: "eos-worker-rc1-internal",
  CREAR_PRODUCTO: "eos-worker-rc1-internal",
  ACTUALIZAR_PRODUCTO: "eos-worker-rc1-internal",
  REGISTRAR_COMPRA: "eos-worker-rc1-internal",
  REGISTRAR_GASTO_FIJO: "eos-worker-rc1-internal",
  REGISTRAR_MOVIMIENTO_PERSONAL: "eos-worker-rc1-internal",
  REGISTRAR_TRANSFERENCIA: "eos-worker-rc1-internal",
  REGISTRAR_DEUDA: "eos-worker-rc1-internal",
  REGISTRAR_PAGO_DEUDA: "eos-worker-rc1-internal",
  CORREGIR_MOVIMIENTO: "eos-worker-rc1-internal",
  DECLARAR_SALDO: "eos-worker-rc1-internal",
  REGISTRAR_COBRO: "eos-worker-rc1-internal",
  REGISTRAR_PAGO_COMPRA: "eos-worker-rc1-internal",
  REGISTRAR_TARJETA: "eos-worker-rc1-internal",
  REGISTRAR_COMPRA_TARJETA: "eos-worker-rc1-internal",
  REGISTRAR_OPORTUNIDAD: "eos-worker-rc1-internal",

  /*
   * Anular va por el mismo camino interno: deja un efecto durable igual que
   * las demás. Lo que la distingue es que el efecto es sobre filas que YA
   * existían —la venta, el stock y el movimiento de plata— y eso lo resuelve
   * el ejecutor, no la ruta.
   */
  ANULAR_VENTA: "eos-worker-rc1-internal",
  CORREGIR_VENTA: "eos-worker-rc1-internal",
  // Las simétricas de compra (v170): mismo camino interno.
  ANULAR_COMPRA: "eos-worker-rc1-internal",
  CORREGIR_COMPRA: "eos-worker-rc1-internal",
  // Escribirle a un cliente por el WhatsApp de la empresa (v186): el ejecutor valida y el
  // servidor envía con la misma política que la pantalla.
  ENVIAR_WHATSAPP_CLIENTE: "eos-worker-rc1-internal",
};

export type Job = {
  request_id: string;
  usuario_id: string;
  usuario_id_original: string;
  usuario_key: string;
  conversacion_id: string;
  nombre: string;
  plan: string;
  origen: string;
  mensaje: string;
  /** Puede variar entre llamadas: el gate NO debe usarlo en la huella. */
  respuesta_gateway: string;
  accion: { tipo: string; datos: Record<string, unknown> };
  action_index: number;
  action_count: number;
  worker_path: string;
  sin_acciones: boolean;
  historial: unknown[];
  metadata: Record<string, unknown>;
  received_at: string;
};

export class AccionNoPermitida extends Error {}

/** El primer valor que sea texto o número. Nunca devuelve "undefined". */
function texto(...valores: unknown[]): string {
  for (const v of valores) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

/** 1 a 5. Lo que no es número cae en 3, que es el medio. */
export function prioridad(valor: unknown): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, Math.round(n)));
}

/** 1 a 10. Lo que no es número cae en 5. */
export function importancia(valor: unknown): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(10, Math.round(n)));
}

/**
 * Los alias de OpenAI llevados a un solo contrato.
 *
 * El orden de cada `texto(...)` es el orden de preferencia y NO se puede
 * cambiar: si mañana `nombre` ganara sobre `titulo`, dos payloads que hoy dan
 * la misma huella pasarían a dar huellas distintas.
 */
export function normalizarDatos(tipo: string, entrada: unknown): Record<string, unknown> {
  const d = (entrada && typeof entrada === "object" && !Array.isArray(entrada)
    ? entrada
    : {}) as Record<string, unknown>;

  if (tipo === "CREAR_TAREA") {
    // Lo que la persona DIJO ("el 25", "mañana", "el lunes", "a las 10"): la base
    // hace la cuenta con la fecha de Paraguay (v189). Es el gemelo del nodo
    // "06 GW Preparar Jobs Worker" de n8n, que descarta en silencio lo que no
    // nombra. Entran SOLO si vinieron con algo: agregarlos siempre, aunque vacíos,
    // cambiaría la huella de todas las tareas y con ella el exactly-once.
    const cuando: Record<string, string> = {};
    for (const campo of ["vence_dia", "vence_en_dias", "vence_semana", "vence_el", "hora", "repite"]) {
      const valor = texto(d[campo]);
      if (valor) cuando[campo] = valor;
    }

    return {
      titulo: texto(d.titulo, d.nombre, d.name, d.asunto, d.tarea),
      descripcion: texto(d.descripcion, d.description, d.detalle, d.detalles),
      prioridad: prioridad(d.prioridad ?? d.priority),
      fecha_limite: texto(d.fecha_limite, d.fecha, d.deadline, d.due_date, d.vencimiento),
      ...cuando,
    };
  }

  if (tipo === "GUARDAR_MEMORIA") {
    return {
      titulo: texto(d.titulo, d.nombre, d.name),
      categoria: texto(d.categoria, d.category),
      contenido: texto(d.contenido, d.texto, d.descripcion, d.memoria, d.valor),
      importancia: importancia(d.importancia ?? d.importance),
    };
  }

  if (tipo === "GENERAR_EXCEL" || tipo === "GENERAR_PDF" || tipo === "GENERAR_WORD") {
    return {
      tema: texto(d.tema, d.asunto, d.objetivo, d.titulo, d.topic),
      tipo: texto(d.tipo, d.type, d.plantilla, d.template),
      rubro: texto(d.rubro, d.sector, d.categoria, d.industry),
      negocio: texto(d.negocio, d.empresa, d.nombre_negocio, d.nombre_empresa, d.business, d.nombre),
      descripcion: texto(d.descripcion, d.description, d.detalle, d.detalles),
    };
  }

  // CREAR_OBJETIVO conserva sus datos crudos: su contrato lo valida el worker
  // por su cuenta. Las lecturas y RESPONDER no llevan datos.
  if (tipo === "VER_DASHBOARD" || tipo === "VER_BRIEFING" || tipo === "RESPONDER") return {};

  return d;
}

/**
 * La metadata que viaja en el job.
 *
 * Es un subconjunto deliberado de `respuesta.metadata`: se dejan afuera
 * `openai_response_id`, `openai_status`, `openai_model` y `gateway`, que
 * cambian entre ejecuciones. Ver el encabezado.
 */
export function metadataEstable(e: Entrada): Record<string, unknown> {
  return {
    plan: e.plan || "free",
    origen: e.origen || "eos-web",
    tiene_archivo: e.tiene_archivo,
    archivo_entrada_nombre: e.archivo_nombre,
    archivo_entrada_tipo: e.archivo_tipo,
    imagen_analizada: e.archivo_categoria === "imagen" && e.imagen_data_url !== "",
  };
}

/**
 * Un job por acción.
 *
 * Sin acciones se fabrica uno de `RESPONDER` con `sin_acciones: true`, igual
 * que n8n. Ese job no produce ningún efecto durable —la rama RESPONDER del
 * Worker solo hace un health ping— y por eso quien llama puede saltearlo. Se
 * arma igual para que la forma no dependa del caso.
 */
/**
 * El `request_id` de la N-ésima acción del MISMO tipo en un mensaje.
 *
 * ============================================================
 * EL DEFECTO (24 de septiembre de 2026, usando EOS de verdad)
 * ============================================================
 *
 * El Worker Gate identifica cada orden por (usuario, request_id, acción). Si
 * el modelo pide dos acciones del mismo tipo en un mensaje —dos memorias, dos
 * tarjetas, dos tareas— la segunda llega con la misma identidad que la
 * primera y otro contenido, y el gate la rechaza como un replay alterado:
 * `409 EOS_COMMAND_PAYLOAD_MISMATCH`. La persona leyó ese JSON en el chat.
 *
 * La primera de cada tipo conserva el `request_id` del mensaje (la traza por
 * request_id sigue igual para el caso común). De la segunda en adelante se
 * deriva uno determinístico: el mismo mensaje con las mismas acciones da
 * siempre los mismos ids, así que un reintento sigue siendo reconocido como
 * reintento. Conserva la versión y la variante del UUID original, que es lo
 * que validan el Worker y el gate.
 *
 * El mismo cálculo vive en el nodo `06 GW Preparar Jobs Worker` de n8n
 * (`n8n/parches/cambios-acciones-repetidas.mjs`); un test verifica que den lo
 * mismo.
 */
export function requestIdDeAccion(requestId: string, ordinal: number): string {
  if (!ordinal) return requestId;
  const id = String(requestId).toLowerCase();
  const nodo = parseInt(id.slice(-12), 16);
  const derivado = (nodo + ordinal * 0x9e3779b1) % 0x1000000000000;
  return id.slice(0, -12) + derivado.toString(16).padStart(12, "0");
}

/** Clave estable de una acción ya canonicalizada, para descartar las idénticas. */
function claveDeAccion(tipo: string, datos: unknown): string {
  const ordenar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(ordenar);
    if (!v || typeof v !== "object") return v;
    return Object.keys(v as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = ordenar((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
  };
  return `${tipo}|${JSON.stringify(ordenar(datos))}`;
}

/** Acciones que pueden CREAR un producto en el catálogo. */
const CREAN_PRODUCTO = new Set(["REGISTRAR_VENTA", "REGISTRAR_COMPRA", "CREAR_PRODUCTO"]);

/**
 * Un `ACTUALIZAR_PRODUCTO` que solo pone costo va DESPUÉS de lo que crea el
 * producto (24/09/2026).
 *
 * "Registrá esta venta: Campera, 230.000, costo 207.052": si el costo corriera
 * antes que la venta, el producto todavía no existiría y el costo se perdería.
 * El modelo casi siempre las manda en el orden bueno, pero "casi siempre" no es
 * una garantía. Solo se mueve el que pone costo sin tocar el precio: un cambio
 * de precio antes de una venta puede ser a propósito ("subilo a 200 y vendí 2").
 * El resto del orden no cambia. Mismo cálculo en el nodo 06 de n8n.
 */
export function costoDespuesDeCrear(acciones: Accion[]): Accion[] {
  const tipo = (a: Accion) => String(a.tipo || "").trim().toUpperCase();
  let ultimoCreador = -1;
  acciones.forEach((a, i) => {
    if (CREAN_PRODUCTO.has(tipo(a))) ultimoCreador = i;
  });
  if (ultimoCreador < 0) return acciones;

  const soloCosto = (a: Accion) => {
    if (tipo(a) !== "ACTUALIZAR_PRODUCTO") return false;
    const productos = normalizarDatos("ACTUALIZAR_PRODUCTO", a.datos).productos;
    return (
      Array.isArray(productos) &&
      productos.length > 0 &&
      productos.every((p) => {
        const r = (p ?? {}) as Record<string, unknown>;
        const precio = r.precio_venta ?? r.precio;
        return r.costo !== undefined && r.costo !== null && (precio === undefined || precio === null);
      })
    );
  };

  const diferidas = acciones.filter((a, i) => i < ultimoCreador && soloCosto(a));
  if (diferidas.length === 0) return acciones;

  const resto = acciones.filter((a) => !diferidas.includes(a));
  const corte = resto.indexOf(acciones[ultimoCreador]) + 1;
  return [...resto.slice(0, corte), ...diferidas, ...resto.slice(corte)];
}

/**
 * El costo que el modelo ESCRIBIÓ en la respuesta viaja con la venta
 * (25/09/2026, v198).
 *
 * Caso real: "Zapatos Mary Jane: venta ₲180.000, costo ₲146.473,876, margen
 * 18,63%" en el texto, y la venta sin `costo_unitario`. El prompt ya le pide
 * que lo mande, pero eso es "casi siempre". Si el texto le muestra a la persona
 * un costo para un producto de la venta, ese costo va en el ítem: lo que se le
 * dice y lo que queda guardado no pueden ser dos cosas distintas.
 *
 * Solo completa, nunca pisa: un `costo_unitario` que el modelo mandó gana. Solo
 * mira la MISMA línea que nombra al producto, y solo un número pegado a la
 * palabra "costo". En el texto del modelo la coma es decimal y el punto es de
 * miles (así escribe los guaraníes). La base igual descarta un costo absurdo.
 * Mismo cálculo en el nodo 06 de n8n (`n8n/parches/cambios-costo-del-texto.mjs`).
 */
export function costoDesdeLaRespuesta(acciones: Accion[], respuesta: string): Accion[] {
  const plano = (t: string) =>
    String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

  const lineas = String(respuesta ?? "").split("\n").map(plano);
  if (!lineas.some((l) => l.includes("costo"))) return acciones;

  const leer = (t: string): number | null => {
    const limpio = t.replace(/[.,]+$/, "");
    let n: number;
    if (limpio.includes(",")) n = Number(limpio.replace(/\./g, "").replace(",", "."));
    else if (/^\d{1,3}(\.\d{3})+$/.test(limpio)) n = Number(limpio.replace(/\./g, ""));
    else n = Number(limpio);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const costoDe = (producto: string): number | null => {
    const nombre = plano(producto);
    if (nombre.length < 3) return null;
    for (const linea of lineas) {
      const desde = linea.indexOf(nombre);
      if (desde < 0) continue;
      const m = linea.slice(desde + nombre.length).match(/\bcosto(?: unitario)?:? (?:de )?(?:(?:₲|gs\.?) ?)?(\d[\d.,]*)/);
      if (m) return leer(m[1]);
    }
    return null;
  };

  return acciones.map((a) => {
    if (String(a.tipo || "").trim().toUpperCase() !== "REGISTRAR_VENTA") return a;
    const datos = (a.datos && typeof a.datos === "object" ? a.datos : {}) as Record<string, unknown>;
    if (!Array.isArray(datos.items)) return a;

    let cambio = false;
    const items = datos.items.map((item) => {
      if (!item || typeof item !== "object") return item;
      const r = item as Record<string, unknown>;
      if (r.costo_unitario != null || r.costo != null) return item;
      const costo = costoDe(String(r.producto ?? r.nombre ?? r.descripcion ?? ""));
      if (costo === null) return item;
      cambio = true;
      return { ...r, costo_unitario: costo };
    });

    return cambio ? { ...a, datos: { ...datos, items } } : a;
  });
}

export function armarJobs(e: Entrada, r: RespuestaGateway): Job[] {
  const sinAcciones = r.acciones.length === 0;
  const pedidas: Accion[] = sinAcciones ? [{ tipo: "RESPONDER", datos: {} }] : r.acciones;

  /*
   * Dos acciones IDÉNTICAS (mismo tipo, mismos datos) son la misma: el modelo
   * a veces repite la memoria que ya pidió. Se deja una sola, antes de numerar,
   * para que la derivación de ids no la ejecute dos veces.
   */
  const vistas = new Set<string>();
  const unicas = pedidas.filter((accion) => {
    const tipo = String(accion.tipo || "RESPONDER").trim().toUpperCase();
    const clave = claveDeAccion(tipo, normalizarDatos(tipo, accion.datos));
    if (vistas.has(clave)) return false;
    vistas.add(clave);
    return true;
  });

  const acciones = costoDesdeLaRespuesta(costoDespuesDeCrear(unicas), r.respuesta);

  const porTipo = new Map<string, number>();

  return acciones.map((accion, index) => {
    const tipo = String(accion.tipo || "RESPONDER").trim().toUpperCase();
    const worker_path = RUTAS[tipo];
    const ordinal = porTipo.get(tipo) ?? 0;
    porTipo.set(tipo, ordinal + 1);

    if (!worker_path) {
      // No debería pasar: `prepararRespuesta` ya filtró por la lista blanca.
      // El guard queda porque el día que alguien agregue una acción a la lista
      // y se olvide de la ruta, esto tiene que gritar y no mandar el job a
      // ningún lado.
      throw new AccionNoPermitida(`Acción Worker no permitida: ${tipo}`);
    }

    return {
      request_id: requestIdDeAccion(e.request_id, ordinal),
      usuario_id: e.usuario_id,
      usuario_id_original: e.usuario_id,
      usuario_key: e.usuario_id,
      conversacion_id: e.conversacion_id,
      nombre: e.nombre || "Usuario",
      plan: e.plan || "free",
      origen: e.origen || "eos-web",
      mensaje: e.mensaje,
      respuesta_gateway: r.respuesta,
      accion: { tipo, datos: normalizarDatos(tipo, accion.datos) },
      action_index: index,
      action_count: acciones.length,
      worker_path,
      sin_acciones: sinAcciones,
      historial: e.historial,
      metadata: metadataEstable(e),
      received_at: e.received_at,
    };
  });
}
