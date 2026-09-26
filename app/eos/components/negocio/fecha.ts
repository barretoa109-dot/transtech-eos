/** "2026-09-25" → "25/9", como se dice una fecha en el mostrador. */
export function diaMes(iso: string): string {
  const [, mes, dia] = iso.slice(0, 10).split("-");
  return `${Number(dia)}/${Number(mes)}`;
}
