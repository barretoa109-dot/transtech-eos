/**
 * T-01 del plan maestro de auditoría (07/11/2026): la resolución del buzón
 * destino de un correo entrante no tenía ninguna prueba propia — vivía
 * inline en `app/api/finanzas/correo/route.ts`, sin test, junto a código que
 * sí depende de Resend y de la base.
 *
 * Esta pieza es pura y determinística, así que se separa para poder
 * probarla sin red ni base de datos.
 *
 * Las direcciones son `eos-<token>@<dominio de ingesta>`. Se contempla el
 * sufijo con `+` porque algunos clientes de correo lo agregan al reenviar.
 */
export function extraerToken(destinatarios: string[]): string | null {
  for (const crudo of destinatarios) {
    const direccion = crudo.includes("<") ? (crudo.match(/<([^>]+)>/)?.[1] ?? crudo) : crudo;
    const local = direccion.split("@")[0]?.trim().toLowerCase();
    if (!local) continue;

    const sinSufijo = local.split("+")[0];
    if (!sinSufijo.startsWith("eos-")) continue;

    const token = sinSufijo.slice(4);
    if (/^[a-f0-9]{16,64}$/.test(token)) return token;
  }

  return null;
}
