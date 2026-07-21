import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);

  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") || "/dashboard";

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=callback_sin_codigo", requestUrl.origin)
    );
  }

  const supabase = await createClient();

  const { error: sessionError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (sessionError) {
    console.error("Error intercambiando sesión:", sessionError);

    return NextResponse.redirect(
      new URL("/login?error=sesion_no_valida", requestUrl.origin)
    );
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.redirect(
      new URL("/login?error=usuario_no_encontrado", requestUrl.origin)
    );
  }

  const nombre =
    user.user_metadata?.nombre ??
    user.email?.split("@")[0] ??
    "Usuario";

  const whatsapp = user.user_metadata?.whatsapp || null;
  const plan = user.user_metadata?.plan || "free";

  const { error: profileError } = await supabase
    .from("usuarios")
    .upsert(
      {
        id: user.id,
        nombre,
        email: user.email,
        whatsapp,
        plan,
      },
      {
        onConflict: "id",
      }
    );

  if (profileError) {
    console.error("Error creando perfil:", profileError);

    return NextResponse.redirect(
      new URL("/login?error=perfil_no_creado", requestUrl.origin)
    );
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}