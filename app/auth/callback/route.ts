import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { destinoSeguro } from "@/lib/auth/destino";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = destinoSeguro(
    requestUrl.searchParams.get("next") || requestUrl.searchParams.get("redirect"),
    requestUrl.origin,
  );

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=callback_sin_codigo", requestUrl.origin),
    );
  }

  const supabase = await createClient();
  const { error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

  if (sessionError) {
    console.error("Error intercambiando sesión:", sessionError);

    return NextResponse.redirect(
      new URL("/login?error=sesion_no_valida", requestUrl.origin),
    );
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.redirect(
      new URL("/login?error=usuario_no_encontrado", requestUrl.origin),
    );
  }

  // El trigger auth.users -> public.handle_new_user() es el único dueño de la
  // creación inicial del perfil y fuerza el plan comercial desde el servidor.
  // El callback nunca debe escribir plan/rol/estado desde user_metadata.

  /*
   * ¿Esta cuenta acaba de nacer?
   *
   * Con correo y contraseña ya se sabe de antemano: el formulario manda
   * `next=/eos/onboarding` directamente. Pero "Continuar con Google" es el
   * mismo botón para quien se registra por primera vez y para quien ya
   * tiene cuenta, y acá —recién con el usuario ya resuelto— es el único
   * lugar donde se puede saber cuál de los dos es.
   *
   * La señal es la fila que `handle_new_user()` deja en `eos_onboarding` en
   * el mismo instante en que la cuenta se crea, no una comparación de
   * fechas: `created_at` y `last_sign_in_at` nunca son exactamente iguales,
   * ni siquiera en la primera sesión, porque crear la cuenta y abrir la
   * sesión son dos operaciones separadas.
   *
   * Si la fila no existe —cualquier cuenta de antes de este cambio, o
   * alguien que ya terminó la conversación— se seguía como siempre.
   */
  const { data: onboarding } = await supabase
    .from("eos_onboarding")
    .select("completado_en")
    .eq("usuario_id", user.id)
    .is("completado_en", null)
    .maybeSingle();

  const destino = onboarding ? "/eos/onboarding" : next;

  return NextResponse.redirect(new URL(destino, requestUrl.origin));
}
