/**
 * Corpus de acciones del gateway.
 *
 * ============================================================
 * ESTE CORPUS MIDE LA ACCIÓN, NO LA PROSA
 * ============================================================
 *
 * `docs/salida-de-n8n.md` pide, para la etapa 2, "consultas reales con la
 * ACCIÓN esperada (no la prosa), corridas contra los dos caminos hasta que
 * coincidan". Esto es esa suite.
 *
 * Lo que se mide es el tramo determinístico: dado lo que devolvió el modelo,
 * ¿qué job sale? Si el texto de la respuesta cambia no importa —el modelo
 * puede decir lo mismo de mil formas— pero si cambia el `tipo` de la acción o
 * un campo de sus `datos`, cambia lo que se ejecuta y cambia la huella del
 * Worker Gate.
 *
 * ============================================================
 * POR QUÉ CASI TODO ES CRÍTICO
 * ============================================================
 *
 * De las once acciones, tres tocan la plata y el stock de un negocio real:
 * REGISTRAR_VENTA, AJUSTAR_STOCK y CREAR_CONTACTO. Equivocar el tipo de acción
 * descuenta stock que no se vendió o carga una venta que no ocurrió.
 *
 * Y hay un modo de fallar más silencioso: que la acción sea la correcta pero
 * los datos salgan con otra forma. Ahí el Worker Gate deja de reconocer un
 * reintento y ejecuta dos veces. Por eso cada caso compara los datos
 * canónicos completos y no solo el tipo.
 */

import { prepararEntrada } from "../../lib/gateway/entrada.ts";
import { prepararRespuesta } from "../../lib/gateway/respuesta.ts";
import { armarJobs } from "../../lib/gateway/jobs.ts";
import type { Caso, Suite } from "../tipos.ts";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-9222-222222222222";
const UUID_C = "33333333-3333-4333-a333-333333333333";

type Esperado = {
  tipo: string;
  /**
   * Los datos canónicos COMPLETOS, no un subconjunto.
   *
   * La primera versión de este archivo comparaba solo las claves declaradas, y
   * no servía: con `datos: {}` esperado, recorrer cero claves da verdadero sin
   * mirar nada. Se comprobó rompiendo `normalizarDatos` a propósito y la suite
   * siguió en verde.
   *
   * Además de tapar ese agujero, exigir el objeto entero es lo correcto: la
   * huella del Worker Gate se calcula sobre todo el payload, así que un campo
   * de más o de menos ya es otro comando.
   */
  datos?: Record<string, unknown>;
  worker_path?: string;
};

/**
 * Un caso: el mensaje de la persona, lo que devolvió el modelo, y qué job
 * tiene que salir.
 *
 * `salidaDelModelo` es el JSON crudo tal como lo escribe OpenAI, con sus
 * alias y sus rarezas incluidas. Es a propósito: el corpus tiene que tener la
 * forma que el mundo manda de verdad, no la forma prolija.
 */
function caso(
  nombre: string,
  mensaje: string,
  salidaDelModelo: Record<string, unknown>,
  esperado: Esperado[],
  severidad: Caso["severidad"],
  porque: string,
): Caso {
  return {
    nombre,
    severidad,
    porque,
    evaluar: () => {
      const entrada = prepararEntrada({
        request_id: UUID_A,
        usuario_id: UUID_B,
        conversacion_id: UUID_C,
        mensaje,
        fecha: "2026-09-03T12:00:00.000Z",
      });

      const respuesta = prepararRespuesta(entrada, {
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(salidaDelModelo) }],
          },
        ],
      });

      let jobs;
      try {
        jobs = armarJobs(entrada, respuesta);
      } catch (error) {
        return {
          ok: false,
          esperado: describir(esperado),
          obtenido: `lanzó: ${error instanceof Error ? error.message : "error"}`,
        };
      }

      // Sin acciones se fabrica un RESPONDER; el corpus lo declara así.
      const obtenido: Esperado[] = jobs.map((j) => ({
        tipo: j.accion.tipo,
        datos: j.accion.datos,
        worker_path: j.worker_path,
      }));

      const ok =
        obtenido.length === esperado.length &&
        esperado.every((e, i) => {
          if (obtenido[i].tipo !== e.tipo) return false;
          if (e.worker_path && obtenido[i].worker_path !== e.worker_path) return false;
          if (!e.datos) return true;
          // Comparación exacta y con las claves ordenadas, igual que la huella.
          return estable(obtenido[i].datos ?? {}) === estable(e.datos);
        });

      return { ok, esperado: describir(esperado), obtenido: describir(obtenido) };
    },
  };
}

/** El mismo orden de claves que usa el `fingerprint` del Worker Gate. */
function estable(valor: unknown): string {
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
  return JSON.stringify(ordenar(valor));
}

function describir(lista: Esperado[]): string {
  if (lista.length === 0) return "ningún job";
  return lista
    .map((e) => (e.datos ? `${e.tipo}(${JSON.stringify(e.datos)})` : e.tipo))
    .join(" + ");
}

export const acciones: Suite = {
  nombre: "acciones",
  descripcion:
    "Qué job sale de lo que devuelve el modelo. Mide la acción y sus datos canónicos, no el texto.",
  casos: [
    // -----------------------------------------------------------------
    // Conversación pura: lo más frecuente, y no puede fabricar acciones
    // -----------------------------------------------------------------

    caso(
      "una pregunta no dispara ninguna acción",
      "¿cómo vengo este mes?",
      { respuesta: "Vas 12% arriba del mes pasado.", acciones: [] },
      [{ tipo: "RESPONDER", worker_path: "eos-worker-rc1-respond", datos: {} }],
      "critico",
      "Si una pregunta fabricara una acción, EOS escribiría en la base por conversar.",
    ),

    caso(
      "un saludo tampoco",
      "buenas",
      { respuesta: "Buenas, ¿qué necesitás?", acciones: [] },
      [{ tipo: "RESPONDER", datos: {} }],
      "critico",
      "Es el mensaje más común de todos.",
    ),

    caso(
      "pedir consejo no es pedir una acción",
      "¿me conviene comprar más harina?",
      {
        respuesta: "Con la rotación que tenés, te alcanza dos semanas más.",
        acciones: [],
      },
      [{ tipo: "RESPONDER" }],
      "deseable",
      "Un consejo malinterpretado como orden compra mercadería sola.",
    ),

    // -----------------------------------------------------------------
    // Las tres del negocio
    // -----------------------------------------------------------------

    caso(
      "una venta llega con sus ítems intactos",
      "vendí 3 panes a Ana",
      {
        respuesta: "Lo dejo listo para que lo confirmes.",
        acciones: [
          {
            tipo: "REGISTRAR_VENTA",
            datos: { items: [{ producto: "pan francés", cantidad: 3 }], contacto: "Ana" },
          },
        ],
      },
      [
        {
          tipo: "REGISTRAR_VENTA",
          worker_path: "eos-worker-rc1-internal",
          datos: { items: [{ producto: "pan francés", cantidad: 3 }], contacto: "Ana" },
        },
      ],
      "critico",
      "Perder o alterar un ítem carga una venta distinta de la que se dijo.",
    ),

    caso(
      "un ajuste de stock por conteo conserva stock_contado",
      "conté y hay 40 gaseosas",
      {
        respuesta: "Lo dejo listo.",
        acciones: [
          { tipo: "AJUSTAR_STOCK", datos: { producto: "gaseosa", stock_contado: 40, motivo: "conteo" } },
        ],
      },
      [
        {
          tipo: "AJUSTAR_STOCK",
          datos: { producto: "gaseosa", stock_contado: 40, motivo: "conteo" },
        },
      ],
      "critico",
      "stock_contado y delta significan cosas opuestas: 40 unidades contra 40 más.",
    ),

    caso(
      "una pérdida conserva delta negativo",
      "se me rompieron 3 botellas",
      {
        respuesta: "Lo dejo listo.",
        acciones: [{ tipo: "AJUSTAR_STOCK", datos: { producto: "botella", delta: -3, motivo: "rotura" } }],
      },
      [{ tipo: "AJUSTAR_STOCK", datos: { producto: "botella", delta: -3, motivo: "rotura" } }],
      "critico",
      "Si el signo se perdiera, una rotura sumaría stock en vez de restarlo.",
    ),

    caso(
      "un contacto nuevo no inventa el dígito verificador",
      "agendá a Don Luis, RUC 800123",
      {
        respuesta: "Lo dejo listo.",
        acciones: [{ tipo: "CREAR_CONTACTO", datos: { nombre: "Don Luis", ruc: "800123" } }],
      },
      [{ tipo: "CREAR_CONTACTO", datos: { nombre: "Don Luis", ruc: "800123" } }],
      "critico",
      "El sistema calcula el dígito; un RUC alterado acá emite facturas a otro contribuyente.",
    ),

    // -----------------------------------------------------------------
    // Canonicalización: el modo silencioso de fallar
    // -----------------------------------------------------------------

    caso(
      "los alias de una tarea se llevan al contrato",
      "recordame llamar a Ana mañana",
      {
        respuesta: "Anotado.",
        acciones: [{ tipo: "CREAR_TAREA", datos: { nombre: "Llamar a Ana", due_date: "2026-09-04" } }],
      },
      [
        {
          tipo: "CREAR_TAREA",
          datos: { titulo: "Llamar a Ana", fecha_limite: "2026-09-04", descripcion: "", prioridad: 3 },
        },
      ],
      "critico",
      "Sin canonicalizar, dos formas de la misma tarea dan huellas distintas y se crea dos veces.",
    ),

    caso(
      "cuando dos alias compiten, gana el que gana en n8n",
      "anotá: revisar la caja",
      {
        respuesta: "Anotado.",
        // El modelo manda los dos. Cuál gana no es una preferencia de estilo:
        // si mañana ganara `nombre`, huellas ya emitidas dejarían de coincidir
        // y comandos viejos se volverían a ejecutar.
        acciones: [
          { tipo: "CREAR_TAREA", datos: { titulo: "Revisar la caja", nombre: "Caja" } },
        ],
      },
      [
        {
          tipo: "CREAR_TAREA",
          datos: { titulo: "Revisar la caja", descripcion: "", prioridad: 3, fecha_limite: "" },
        },
      ],
      "critico",
      "El orden de preferencia de los alias es parte del contrato de exact-once.",
    ),

    caso(
      "una prioridad fuera de rango se recorta en vez de romper",
      "urgentísimo: pagar el alquiler",
      {
        respuesta: "Anotado.",
        acciones: [{ tipo: "CREAR_TAREA", datos: { titulo: "Pagar alquiler", prioridad: 99 } }],
      },
      [{ tipo: "CREAR_TAREA", datos: { titulo: "Pagar alquiler", descripcion: "", prioridad: 5, fecha_limite: "" } }],
      "deseable",
      "El modelo a veces exagera el número; el worker espera 1 a 5.",
    ),

    caso(
      "una memoria toma el contenido desde cualquiera de sus alias",
      "acordate que el proveedor cierra los lunes",
      {
        respuesta: "Lo guardo.",
        acciones: [
          { tipo: "GUARDAR_MEMORIA", datos: { titulo: "Proveedor", texto: "Cierra los lunes" } },
        ],
      },
      [
        {
          tipo: "GUARDAR_MEMORIA",
          datos: { titulo: "Proveedor", categoria: "", contenido: "Cierra los lunes", importancia: 5 },
        },
      ],
      "deseable",
      "Perder el contenido guarda una memoria vacía, que es peor que no guardarla.",
    ),

    // -----------------------------------------------------------------
    // Varias acciones en un mensaje
    // -----------------------------------------------------------------

    caso(
      "dos pedidos en un mensaje dan dos jobs en orden",
      "vendí 2 tortas y recordame reponer harina",
      {
        respuesta: "Lo dejo listo.",
        acciones: [
          { tipo: "REGISTRAR_VENTA", datos: { items: [{ producto: "torta", cantidad: 2 }] } },
          { tipo: "CREAR_TAREA", datos: { titulo: "Reponer harina", descripcion: "", prioridad: 3, fecha_limite: "" } },
        ],
      },
      [
        { tipo: "REGISTRAR_VENTA", datos: { items: [{ producto: "torta", cantidad: 2 }] } },
        {
          tipo: "CREAR_TAREA",
          datos: { titulo: "Reponer harina", descripcion: "", prioridad: 3, fecha_limite: "" },
        },
      ],
      "critico",
      "El orden es el que la persona dijo; invertirlo puede reponer antes de descontar.",
    ),

    // -----------------------------------------------------------------
    // Lo que el gateway tiene que descartar
    // -----------------------------------------------------------------

    caso(
      "una acción que no existe se descarta sin frenar la respuesta",
      "mandale un mail a Ana",
      {
        respuesta: "No puedo mandar correos todavía.",
        acciones: [{ tipo: "ENVIAR_EMAIL", datos: { a: "ana@x.com" } }],
      },
      [{ tipo: "RESPONDER" }],
      "critico",
      "Frenar la conversación por una acción inventada deja a la persona sin respuesta.",
    ),

    caso(
      "con documento se descartan las acciones de generar archivo",
      "armame una planilla de ventas del mes",
      {
        respuesta: "Ahí va.",
        documento: { titulo: "Ventas de septiembre", bloques: [{ tipo: "parrafo", texto: "x" }] },
        acciones: [{ tipo: "GENERAR_EXCEL", datos: { tema: "ventas" } }],
      },
      [{ tipo: "RESPONDER" }],
      "critico",
      "Dejar las dos manda dos archivos distintos por un solo pedido.",
    ),

    caso(
      "sin documento, el pedido de archivo sí genera su job",
      "pasame un pdf con el resumen",
      {
        respuesta: "Ahí va.",
        acciones: [{ tipo: "GENERAR_PDF", datos: { asunto: "resumen del mes" } }],
      },
      [
        {
          tipo: "GENERAR_PDF",
          worker_path: "eos-worker-rc1-file",
          datos: { tema: "resumen del mes", tipo: "", rubro: "", negocio: "", descripcion: "" },
        },
      ],
      "deseable",
      "Es el camino viejo de archivos y sigue vivo mientras el modelo no mande documento.",
    ),

    // -----------------------------------------------------------------
    // Lecturas
    // -----------------------------------------------------------------

    caso(
      "ver el panel no lleva datos",
      "mostrame el dashboard",
      { respuesta: "Ahí va.", acciones: [{ tipo: "VER_DASHBOARD", datos: { periodo: "mes" } }] },
      [{ tipo: "VER_DASHBOARD", worker_path: "eos-worker-rc1-dashboard", datos: {} }],
      "deseable",
      "Arrastrar datos en una lectura cambia su huella sin cambiar lo que hace.",
    ),
  ],
};
