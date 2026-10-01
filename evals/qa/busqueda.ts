/**
 * ¿EOS sabe CUÁNDO buscar y CÓMO pedir la búsqueda? (01/10/2026)
 *
 * Solo el primer paso: lo que decide el modelo con la conversación y el
 * contexto. No busca de verdad (eso es evals/qa/busqueda-real.mts). Mide:
 * busca cuando hace falta un dato actual; no busca cuando no; la consulta sale
 * general y sin datos privados; el país es el pedido o Paraguay; en un
 * seguimiento usa lo que ya buscó; y las acciones pedidas siguen.
 */
import { CONTEXTOS_RUBRO } from "../bateria/rubros.ts";
import { CONTEXTO_NEGOCIO, type Turno } from "../bateria/frases.ts";
import type { CasoQA } from "./casos.ts";

type Acciones = { tipo: string; datos: Record<string, unknown> }[];

const FERRETERIA = CONTEXTOS_RUBRO.ferreteria;
const ROPA = CONTEXTOS_RUBRO.ropa;

const TRAS_BUSQUEDA: Turno[] = [
  { rol: "usuario", texto: "¿a cuánto se vende la bolsa de cemento de 50 kg en Paraguay?" },
  {
    rol: "eos",
    texto:
      "🔎 Busqué en la web el 01/10/2026 (Paraguay).\n\nLa bolsa de 50 kg se publica entre ₲ 52.900 (promoción) [2] y ₲ 58.000 [1]. Mi lectura: tu precio de ₲ 58.000 está en la línea del mercado.\n\nFuentes:\n[1] Cemento — Ferretería Uno — ferre.com.py\nhttps://ferre.com.py/cemento\n[2] Cemento 50 kg — tienda.com.py\nhttps://tienda.com.py/cemento-50",
  },
];

function caso(
  id: string,
  mensaje: string,
  espera: { busca: boolean; otras?: string[]; pais?: string; privados?: RegExp[]; historial?: Turno[]; contexto?: string; critico?: boolean },
): CasoQA {
  return {
    id,
    critico: espera.critico ?? true,
    mensaje,
    historial: espera.historial,
    contexto: espera.contexto ?? CONTEXTO_NEGOCIO,
    evaluar(verbos: string[], _texto: string, acciones?: Acciones) {
      const f: string[] = [];
      const busqueda = (acciones ?? []).find((a) => a.tipo === "BUSCAR_WEB");
      if (espera.busca && !busqueda) f.push("no pidió BUSCAR_WEB");
      if (!espera.busca && busqueda) f.push(`buscó sin necesidad: "${String(busqueda.datos.consulta)}"`);
      const otras = verbos.filter((v) => v !== "BUSCAR_WEB" && v !== "GUARDAR_MEMORIA").sort().join("+");
      const esperadas = [...(espera.otras ?? [])].sort().join("+");
      if (otras !== esperadas) f.push(`otras acciones: esperaba ${esperadas || "ninguna"}, vino ${otras || "ninguna"}`);
      if (busqueda) {
        const consulta = String(busqueda.datos.consulta ?? "");
        const pais = String(busqueda.datos.pais ?? "PY").toUpperCase();
        if (espera.pais && pais !== espera.pais) f.push(`país ${pais}, esperaba ${espera.pais}`);
        for (const p of espera.privados ?? []) if (p.test(consulta)) f.push(`la consulta lleva un dato privado (${p}): "${consulta}"`);
        if (consulta.length > 180) f.push("consulta demasiado larga");
      }
      return { ok: f.length === 0, motivo: f.join("; ") };
    },
  };
}

export const CASOS_BUSQUEDA: CasoQA[] = [
  caso("bus-precio-producto-py", "¿cuánto cuesta actualmente un iPhone 15 de 128 GB en Paraguay?", { busca: true, pais: "PY" }),
  caso("bus-tendencias-rubro", "¿qué tendencias hay ahora en ropa deportiva femenina y qué precios se están viendo en el mercado?", { busca: true, pais: "PY", contexto: ROPA }),
  caso("bus-competidores", "compará los precios del cemento de 50 kg en las ferreterías grandes de Asunción, con fuentes", { busca: true, pais: "PY", contexto: FERRETERIA }),
  caso("bus-sin-ubicacion", "¿a cuánto está el litro de nafta?", { busca: true, pais: "PY" }),
  caso("bus-no-hace-falta-contexto", "¿cuánto vendí este mes?", { busca: false, critico: false }),
  caso("bus-no-hace-falta-consejo", "dame 3 ideas para vender más los domingos", { busca: false, critico: false }),
  caso("bus-privados", "fijate en internet a cuánto se vende la bolsa de balanceado, porque Juan Pérez me debe 900 mil y le quiero cobrar bien", {
    busca: true,
    privados: [/juan/i, /p[eé]rez/i, /900/, /deb/i],
  }),
  caso("bus-seguimiento", "¿y cuál me conviene a mí?", { busca: false, historial: TRAS_BUSQUEDA, contexto: FERRETERIA }),
  caso("bus-contradice", "un proveedor me dijo que el cemento de 50 kg está a 40 mil en todos lados, ¿es así?", { busca: true, contexto: FERRETERIA }),
  caso("bus-con-venta", "vendí 3 bolsas de balanceado a 180 mil y fijate cómo está el precio del balanceado en el mercado", { busca: true, otras: ["REGISTRAR_VENTA"] }),
];
