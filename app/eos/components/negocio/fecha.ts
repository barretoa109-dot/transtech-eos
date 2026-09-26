/** "2026-09-25" → "25/9", como se dice una fecha en el mostrador. */
export function diaMes(iso: string): string {
  const [, mes, dia] = iso.slice(0, 10).split("-");
  return `${Number(dia)}/${Number(mes)}`;
}

/** Hoy en el reloj de quien mira, como `YYYY-MM-DD`: el mismo formato de `vence_el`. */
export function hoyIso(): string {
  const d = new Date();
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}
