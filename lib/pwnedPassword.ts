async function sha1Hex(text: string) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-1", data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * Chequea la contraseña contra HaveIBeenPwned vía k-anonymity: solo se
 * envían los primeros 5 caracteres del hash SHA-1, nunca la contraseña
 * ni el hash completo. Reemplaza la protección equivalente de Supabase
 * Auth (password_hibp_enabled), que requiere plan Pro.
 */
export async function isPasswordPwned(password: string): Promise<boolean> {
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { "Add-Padding": "true" },
  });

  if (!response.ok) {
    // Si el servicio no responde, no bloqueamos el registro/cambio de
    // contraseña por una dependencia externa caída.
    return false;
  }

  const body = await response.text();

  return body
    .split("\n")
    .some((line) => line.split(":")[0]?.trim() === suffix);
}
