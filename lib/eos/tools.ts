import { formatearValor } from "../kpi/formato.ts";
import { formatearMonto } from "../finanzas/formato.ts";
import { descomponerVentas, redactar } from "../kpi/causa.ts";
import { frase as fraseDeSerie, rachaDe, type PuntoHistoria } from "../kpi/historia.ts";
import { avisoDeCobertura, type BusinessScore } from "../kpi/score.ts";
import type { Anomalia } from "../kpi/anomalias.ts";
import type { Hechos, Periodo, ResultadoKPI } from "../kpi/tipos.ts";

/**
 * Las herramientas que el modelo puede pedir, y que el servidor calcula.
 *
 * ============================================================
 * POR QUÉ EXISTE ESTO
 * ============================================================
 *
 * Hoy el chat recibe un texto precocido de menos de 2.000 caracteres con el
 * resumen del negocio. Alcanza para "¿cómo va el mes?" y no para "¿cuál fue el
 * margen de agosto?" o "¿qué producto explica la caída?": esos números no
 * están en el blob, y un modelo al que le falta un dato tiende a producir uno
 * plausible en vez de decir que no lo tiene.
 *
 * La salida no es agrandar el blob —tiene tope duro y se paga en cada
 * mensaje— sino que el modelo PIDA lo que necesita. Cada herramienta de acá
 * devuelve un número calculado por el mismo motor que pinta la pantalla, así
 * que el chat y el panel no pueden decir cosas distintas.
 *
 * ============================================================
 * SOLO LECTURA
 * ============================================================
 *
 * Ninguna de estas herramientas escribe. Escribir sigue pasando —y va a seguir
 * pasando— por el Worker Gate: acción allowlisted, tabla de riesgo, aprobación
 * explícita y ejecución idempotente. Meter una escritura acá sería abrir una
 * segunda puerta al lado de la que se construyó con candado.
 *
 * ============================================================
 * DEVUELVEN TEXTO YA FORMATEADO
 * ============================================================
 *
 * Mismo criterio que `lib/eos/contexto-negocio.ts`: el formato de cada monto
 * se decide UNA vez, en el servidor. Si se mandara el número pelado, el modelo
 * elegiría cómo mostrarlo y escribiría "Gs. 1,250,000" o "1.25M" según el día.
 */

export type Parametro = {
  nombre: string;
  tipo: "string" | "number";
  descripcion: string;
  requerido: boolean;
};

export type Herramienta = {
  nombre: string;
  descripcion: string;
  parametros: Parametro[];
};

/**
 * El catálogo, en el formato mínimo que necesita cualquier runtime.
 *
 * Deliberadamente NO es el esquema de function-calling de un proveedor
 * concreto: quien lo consuma lo traduce. Atarlo hoy a la forma de OpenAI
 * obligaría a reescribirlo si el loop cambia de modelo, que es exactamente lo
 * que este proyecto está tratando de dejar de tener con n8n.
 */
export const HERRAMIENTAS: Herramienta[] = [
  {
    nombre: "ver_indicador",
    descripcion:
      "El valor de un indicador del negocio en el período actual, con su variación contra el anterior. Usar cuando pregunten por un número concreto: ventas, margen, ganancia, ROI, ticket promedio, cobros, stock.",
    parametros: [
      { nombre: "id", tipo: "string", descripcion: "Id del indicador, por ejemplo margen_bruto o ventas_netas.", requerido: true },
      { nombre: "moneda", tipo: "string", descripcion: "Código de moneda. Por defecto la principal del negocio.", requerido: false },
    ],
  },
  {
    nombre: "ver_salud",
    descripcion:
      "El EOS Business Score con sus dimensiones y su cobertura. Usar para '¿cómo está mi empresa?' o '¿cómo vengo?'.",
    parametros: [],
  },
  {
    nombre: "ver_hallazgos",
    descripcion:
      "Las situaciones que EOS detectó, ordenadas por prioridad. Usar para '¿qué debería preocuparme?' o '¿hay algo mal?'.",
    parametros: [],
  },
  {
    nombre: "explicar_movimiento",
    descripcion:
      "Qué productos y qué clientes explican el cambio de las ventas contra el período anterior. Usar para '¿por qué cayeron las ventas?'. Devuelve el reparto aritmético, NO la causa.",
    parametros: [
      { nombre: "moneda", tipo: "string", descripcion: "Código de moneda. Por defecto la principal.", requerido: false },
    ],
  },
  {
    nombre: "ver_historia",
    descripcion:
      "Cómo viene un indicador en los últimos días: si trae una racha y hace cuánto. Usar para '¿viene mejorando?' o '¿hace cuánto que baja?'.",
    parametros: [
      { nombre: "id", tipo: "string", descripcion: "Id del indicador.", requerido: true },
      { nombre: "moneda", tipo: "string", descripcion: "Código de moneda. Por defecto la principal.", requerido: false },
    ],
  },
];

export type Respuesta = { ok: true; texto: string } | { ok: false; error: string };

/** Todo lo que las herramientas necesitan, ya leído. Ninguna consulta la base. */
export type Contexto = {
  resultados: ResultadoKPI[];
  anomalias: Anomalia[];
  score: BusinessScore | null;
  hechos: Hechos;
  periodo: Periodo;
  anterior: Periodo;
  series: Map<string, PuntoHistoria[]>;
  monedaPrincipal: string | null;
};

function resolverMoneda(ctx: Contexto, pedida: unknown): string | null {
  if (typeof pedida === "string" && pedida.trim()) return pedida.trim().toUpperCase();
  return ctx.monedaPrincipal;
}

/**
 * Cuando no se encuentra el indicador pedido.
 *
 * Distingue dos casos que NO son lo mismo y que el modelo va a contar
 * distinto:
 *
 *   · El negocio no tiene datos todavía. El indicador existe perfectamente;
 *     lo que falta es que alguien cargue una venta. Decir "no existe ese
 *     indicador" acá sería mandar al usuario a buscar un problema donde no
 *     hay ninguno.
 *
 *   · El id no está en el catálogo. Ahí sí no existe, y se listan los que sí
 *     para que el próximo intento del modelo sea correcto en vez de adivinar
 *     otro nombre — o, mejor, para que diga que EOS no calcula eso en vez de
 *     producir un número plausible.
 */
function noExiste(ctx: Contexto, id: string): Respuesta {
  if (ctx.resultados.length === 0) {
    return {
      ok: false,
      error:
        "Todavía no hay datos cargados en el negocio, así que ningún indicador se puede calcular. No es que el indicador no exista.",
    };
  }

  const disponibles = [...new Set(ctx.resultados.map((r) => r.id))].sort().join(", ");
  return {
    ok: false,
    error: `No existe el indicador "${id}". Los que EOS puede calcular con los datos de este negocio son: ${disponibles}.`,
  };
}

export function ejecutar(
  nombre: string,
  argumentos: Record<string, unknown>,
  ctx: Contexto,
): Respuesta {
  switch (nombre) {
    case "ver_indicador": {
      const id = String(argumentos.id ?? "").trim();
      const moneda = resolverMoneda(ctx, argumentos.moneda);
      const r = ctx.resultados.find((x) => x.id === id && x.moneda === moneda);
      if (!r) return noExiste(ctx, id);

      if (r.valor === null) {
        return { ok: true, texto: `${r.nombre}: no se puede calcular. ${r.falta ?? ""}`.trim() };
      }

      const partes = [`${r.nombre} (${r.moneda}): ${formatearValor(r.valor, r.unidad, r.moneda)}`];

      if (r.variacion_pct !== null) {
        const signo = r.variacion_pct > 0 ? "+" : "";
        partes.push(`${signo}${Math.round(r.variacion_pct * 10) / 10}% contra el período anterior`);
      }
      // La confianza se dice cuando NO es total: es la diferencia entre un
      // número y un número que se calculó con la mitad de los datos.
      if (r.confianza.nivel < 1 && r.confianza.motivos.length > 0) {
        partes.push(`ojo: ${r.confianza.motivos.join("; ")}`);
      }

      return { ok: true, texto: partes.join(". ") + "." };
    }

    case "ver_salud": {
      if (!ctx.score || ctx.score.puntaje === null) {
        return {
          ok: true,
          texto: "Todavía no hay con qué calcular el score: hacen falta indicadores con umbral declarado o un período anterior con el cual comparar.",
        };
      }

      const dims = ctx.score.dimensiones
        .filter((d) => d.puntaje !== null)
        .map((d) => `${d.nombre} ${d.puntaje}`)
        .join(", ");

      const aviso = avisoDeCobertura(ctx.score);

      return {
        ok: true,
        texto:
          `EOS Business Score: ${ctx.score.puntaje}/100 (${ctx.score.moneda}). ${dims}.` +
          (aviso ? ` ${aviso}` : "") +
          " El score compara contra los umbrales de cada indicador y contra el período anterior, no contra ninguna industria.",
      };
    }

    case "ver_hallazgos": {
      if (ctx.anomalias.length === 0) {
        return { ok: true, texto: "EOS no detectó ninguna situación para señalar en este período." };
      }
      const lista = ctx.anomalias
        .slice(0, 5)
        .map((a, i) => `${i + 1}. ${a.titulo} ${a.evidencia}`)
        .join(" ");
      return { ok: true, texto: lista };
    }

    case "explicar_movimiento": {
      const moneda = resolverMoneda(ctx, argumentos.moneda);
      if (!moneda) return { ok: true, texto: "Todavía no hay ventas cargadas." };

      const fmt = (n: number) => formatearMonto(n, moneda);
      const porProducto = descomponerVentas(ctx.hechos, ctx.periodo, ctx.anterior, "producto", moneda);
      const porCliente = descomponerVentas(ctx.hechos, ctx.periodo, ctx.anterior, "cliente", moneda);

      const textos = [redactar(porProducto, fmt), redactar(porCliente, fmt)].filter(Boolean);

      if (textos.length === 0) {
        return { ok: true, texto: "Las ventas no se movieron contra el período anterior." };
      }

      // La aclaración va SIEMPRE, no solo cuando queda lindo: es la diferencia
      // entre un reparto aritmético y una causa, y el modelo la necesita para
      // no escribir "las ventas cayeron porque...".
      return {
        ok: true,
        texto: `${textos.join(" ")} Es el reparto del cambio, no su causa: EOS no sabe por qué se movieron.`,
      };
    }

    case "ver_historia": {
      const id = String(argumentos.id ?? "").trim();
      const moneda = resolverMoneda(ctx, argumentos.moneda);
      const r = ctx.resultados.find((x) => x.id === id && x.moneda === moneda);
      if (!r) return noExiste(ctx, id);

      const puntos = ctx.series.get(`${id}:${moneda}`) ?? [];
      const conValor = puntos.filter((p) => p.valor !== null).length;

      if (conValor === 0) {
        return {
          ok: true,
          texto: `Todavía no hay historia de ${r.nombre.toLowerCase()}. EOS saca una foto por día.`,
        };
      }

      const serie = { indicador: id, moneda: moneda as string, unidad: r.unidad, puntos };
      const dicho = fraseDeSerie(serie);
      const racha = rachaDe(puntos);

      return {
        ok: true,
        texto:
          `${r.nombre}: ${conValor} días registrados. ` +
          (dicho ??
            (racha.direccion === "estable"
              ? "Viene sin moverse."
              : "Todavía no alcanza para hablar de una tendencia: hacen falta al menos tres días seguidos para el mismo lado.")),
      };
    }

    default: {
      const nombres = HERRAMIENTAS.map((h) => h.nombre).join(", ");
      return { ok: false, error: `No existe la herramienta "${nombre}". Las disponibles son: ${nombres}.` };
    }
  }
}
