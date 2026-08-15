import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const DESTINOS_AUTH_PERMITIDOS = ["/eos/chat", "/mobile", "/planes", "/pago"];

function destinoSeguro(raw: string | null, origin: string) {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/eos/chat";
  }

  try {
    const destino = new URL(raw, origin);

    if (destino.origin !== origin) {
      return "/eos/chat";
    }

    const permitido = DESTINOS_AUTH_PERMITIDOS.some(
      (base) => destino.pathname === base || destino.pathname.startsWith(`${base}/`),
    );

    if (!permitido) {
      return "/eos/chat";
    }

    return `${destino.pathname}${destino.search}`;
  } catch {
    return "/eos/chat";
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = destinoSeguro(requestUrl.searchParams.get("next"), requestUrl.origin);

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

  // `on_auth_user_created_eos -> handle_new_user_eos()` is the only owner of
  // public.usuarios creation and forces the initial commercial state server-side.
  // The callback must never upsert role/plan/profile fields from user metadata.
  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
