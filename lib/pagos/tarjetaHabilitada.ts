/*
 * ¿Puede esta persona pagar con tarjeta ahora?
 *
 * Mientras Bancard esté en `staging`, el sitio de producción cobra contra el
 * entorno de PRUEBA: no entra dinero, pero la confirmación es real para EOS y
 * activa el plan. Las tarjetas de prueba de Bancard circulan en su documentación
 * de integración; cualquiera que las tenga activaba un plan pago gratis.
 *
 * Entonces, en staging, la tarjeta solo está para quien la tiene que probar:
 * la cuenta de certificación (`EOS_CERT_EMAIL`, por defecto demo@) y los
 * administradores (`ADMIN_EMAILS`). El resto paga por transferencia, que es el
 * camino comercial de hoy. El día que `BANCARD_ENV=production`, se abre para
 * todos sin tocar código.
 */
export function tarjetaHabilitadaPara(
  email: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if ((env.BANCARD_ENV || "staging").trim().toLowerCase() === "production") return true;

  const correo = (email ?? "").trim().toLowerCase();
  if (!correo) return false;

  const permitidos = [
    ...(env.ADMIN_EMAILS || "").split(","),
    env.EOS_CERT_EMAIL || "demo@transtech.com.py",
  ]
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  return permitidos.includes(correo);
}

export const MOTIVO_TARJETA_NO_HABILITADA =
  "El pago con tarjeta se habilita en octubre. Por ahora podés pagar por transferencia bancaria.";
