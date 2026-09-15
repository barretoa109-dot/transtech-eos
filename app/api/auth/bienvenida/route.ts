import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { enviarBienvenida } from "@/lib/email/transaccionales";

export const runtime = "nodejs";

/**
 * Dispara el email de bienvenida para la cuenta que tiene la sesión abierta.
 *
 * Solo hace falta cuando la confirmación de correo está desactivada: ahí
 * `RegisterForm` ya tiene sesión en el mismo instante del registro y no pasa
 * nunca por `app/auth/callback` (que es el otro disparador, para cuando sí
 * hay que confirmar por correo). No hace falta ningún cuerpo en el POST: la
 * sesión ya dice de quién se trata, y `enviarBienvenida` no manda dos veces
 * aunque este endpoint se llame más de una vez.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return Response.json({ error: "Sesión inválida." }, { status: 401 });
  }

  await enviarBienvenida(adminSinTipos(), user.id);

  return Response.json({ ok: true });
}
