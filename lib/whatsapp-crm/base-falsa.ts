import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";

/**
 * Una base simulada para las pruebas: no ejecuta nada, anota qué se le pidió y
 * devuelve lo que el guion le diga.
 *
 * El guion tiene dos tipos de clave:
 *
 *   "tabla.operación"   (select | insert | update | delete)  →  qué devuelve esa consulta
 *   "rpc:nombre"                                              →  qué devuelve esa función
 *
 * y cada valor puede ser un resultado fijo `{ data, error }` o una función que
 * recibe lo que se pidió (`{ payload, filtros, args }`) y devuelve el resultado.
 * Lo que no está en el guion devuelve `{ data: null, error: null }`.
 *
 * Es soporte de pruebas: no lo importa ningún código de producción.
 */

export type Pedido = {
  clave: string;
  payload?: unknown;
  filtros: { metodo: string; args: unknown[] }[];
  args?: unknown;
};

type Resultado = { data: unknown; error: unknown };
type Guion = Record<string, Resultado | ((p: Pedido) => Resultado)>;

export function baseFalsa(guion: Guion = {}): { admin: ClienteSinTipos; pedidos: Pedido[] } {
  const pedidos: Pedido[] = [];

  const resolver = (p: Pedido): Resultado => {
    pedidos.push(p);
    const g = guion[p.clave];
    if (!g) return { data: null, error: null };
    return typeof g === "function" ? g(p) : g;
  };

  const constructor = (tabla: string) => {
    let operacion = "select";
    let payload: unknown;
    const filtros: Pedido["filtros"] = [];
    let terminal: "single" | "maybe" | null = null;

    const listo = (): Resultado => {
      const r = resolver({ clave: `${tabla}.${operacion}`, payload, filtros: [...filtros] });
      if (terminal === "single" && Array.isArray(r.data)) return { data: r.data[0] ?? null, error: r.error };
      return r;
    };

    const b: Record<string, unknown> = {};

    for (const op of ["select", "insert", "update", "delete", "upsert"]) {
      b[op] = (arg?: unknown) => {
        // `.insert(...).select()` sigue siendo un insert: el select solo pide qué devolver.
        if (!(op === "select" && operacion !== "select")) operacion = op;
        if (op !== "select") payload = arg;
        return b;
      };
    }

    for (const f of ["eq", "neq", "in", "not", "or", "is", "gte", "lte", "gt", "lt", "like", "ilike", "order", "limit", "filter", "contains"]) {
      b[f] = (...args: unknown[]) => {
        filtros.push({ metodo: f, args });
        return b;
      };
    }

    b.single = () => {
      terminal = "single";
      return Promise.resolve(listo());
    };
    b.maybeSingle = () => {
      terminal = "maybe";
      return Promise.resolve(listo());
    };
    b.then = (ok: (r: Resultado) => unknown, mal?: (e: unknown) => unknown) => Promise.resolve(listo()).then(ok, mal);

    return b;
  };

  const admin = {
    from: (tabla: string) => constructor(tabla),
    rpc: (nombre: string, args?: unknown) =>
      Promise.resolve(resolver({ clave: `rpc:${nombre}`, args, filtros: [] })),
  } as unknown as ClienteSinTipos;

  return { admin, pedidos };
}
