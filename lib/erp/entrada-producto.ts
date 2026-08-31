export type NumeroProducto =
  | { ok: true; valor: number }
  | { ok: false; motivo: "numero-invalido" | "numero-negativo" };

/** Convierte un importe o saldo sin transformar basura, NaN o infinito en cero. */
export function numeroProducto(valor: unknown): NumeroProducto {
  if (valor === "" || valor === null || valor === undefined || typeof valor === "boolean") {
    return { ok: false, motivo: "numero-invalido" };
  }

  const numero = Number(valor);
  if (!Number.isFinite(numero)) return { ok: false, motivo: "numero-invalido" };
  if (numero < 0) return { ok: false, motivo: "numero-negativo" };

  return { ok: true, valor: numero };
}

export function numeroProductoOpcional(valor: unknown): NumeroProducto | { ok: true; valor: null } {
  if (valor === null || valor === undefined) return { ok: true, valor: null };
  return numeroProducto(valor);
}
