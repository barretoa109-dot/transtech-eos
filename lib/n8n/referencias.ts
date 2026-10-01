/**
 * Referencias entre nodos de un workflow de n8n que pueden fallar en vivo.
 *
 * Un nodo de código o una expresión puede leer la salida de otro nodo con
 * `$('Nombre')`, `$node["Nombre"]` o `$items("Nombre")`. Si ese nodo no
 * existe, o existe pero no está ANTES en el camino (no es un ancestro en las
 * conexiones), n8n tira "Referenced node is unexecuted" o "Node does not
 * exist" recién cuando la ejecución pasa por ahí: el workflow se ve verde en
 * el editor y se cae con un mensaje real. Es la familia de incidentes de
 * "nodos no ejecutados" de RC1 (memoria/objetivos, preparar prompt,
 * subworkflows desconectados).
 *
 * Esto lo encuentra leyendo el JSON exportado, sin ejecutar nada.
 */

export type Flujo = {
  nodes?: { name: string; type?: string; disabled?: boolean; parameters?: unknown }[];
  connections?: Record<string, Record<string, ({ node: string }[] | null)[]>>;
};

export type ReferenciaRota = {
  nodo: string;
  referencia: string;
  motivo: "no_existe" | "no_es_anterior" | "desactivado";
};

const PATRONES = [
  /\$\(\s*(['"`])((?:(?!\1).)+)\1\s*\)/g,
  /\$node\s*\[\s*(['"`])((?:(?!\1).)+)\1\s*\]/g,
  /\$items\(\s*(['"`])((?:(?!\1).)+)\1/g,
];

function textos(valor: unknown, salida: string[] = []): string[] {
  if (typeof valor === "string") salida.push(valor);
  else if (Array.isArray(valor)) for (const v of valor) textos(v, salida);
  else if (valor && typeof valor === "object") for (const v of Object.values(valor)) textos(v, salida);
  return salida;
}

/** Los nombres que un nodo lee de otros nodos. */
export function nombresReferidos(parametros: unknown): string[] {
  const nombres = new Set<string>();
  for (const texto of textos(parametros)) {
    for (const patron of PATRONES) {
      for (const m of texto.matchAll(patron)) {
        // Un nombre armado con `${...}` no se puede resolver leyendo el JSON.
        if (!m[2].includes("${")) nombres.add(m[2]);
      }
    }
  }
  return [...nombres];
}

/** Todos los nodos desde los que se llega a `destino` siguiendo conexiones. */
export function ancestros(flujo: Flujo, destino: string): Set<string> {
  const entrantes = new Map<string, Set<string>>();
  for (const [origen, salidas] of Object.entries(flujo.connections ?? {})) {
    for (const ramas of Object.values(salidas ?? {})) {
      for (const rama of ramas ?? []) {
        for (const c of rama ?? []) {
          if (!entrantes.has(c.node)) entrantes.set(c.node, new Set());
          entrantes.get(c.node)!.add(origen);
        }
      }
    }
  }
  const vistos = new Set<string>();
  const pendientes = [destino];
  while (pendientes.length) {
    const actual = pendientes.pop()!;
    for (const anterior of entrantes.get(actual) ?? []) {
      if (!vistos.has(anterior)) {
        vistos.add(anterior);
        pendientes.push(anterior);
      }
    }
  }
  return vistos;
}

export function referenciasRotas(flujo: Flujo): ReferenciaRota[] {
  const porNombre = new Map((flujo.nodes ?? []).map((n) => [n.name, n]));
  const rotas: ReferenciaRota[] = [];
  for (const nodo of flujo.nodes ?? []) {
    if (nodo.disabled) continue;
    const previos = ancestros(flujo, nodo.name);
    for (const referencia of nombresReferidos(nodo.parameters)) {
      const ref = porNombre.get(referencia);
      if (!ref) rotas.push({ nodo: nodo.name, referencia, motivo: "no_existe" });
      else if (ref.disabled) rotas.push({ nodo: nodo.name, referencia, motivo: "desactivado" });
      else if (!previos.has(referencia)) rotas.push({ nodo: nodo.name, referencia, motivo: "no_es_anterior" });
    }
  }
  return rotas;
}
