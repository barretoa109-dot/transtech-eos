import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "../../../lib/supabase/server";

function obtenerRutaSegura(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/dashboard";
  }

  return next;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);

  const code = url.searchParams.get("code");
  const next = obtenerRutaSegura(url.searchParams.get("next"));
  const errorDescription = url.searchParams.get("error_description");

  if (errorDescription) {
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("error", errorDescription);

    return NextResponse.redirect(loginUrl);
  }

  if (!code) {
    const loginUrl = new URL("/login", url.origin);

    loginUrl.searchParams.set(
      "error",
      "No se recibió el código de autenticación."
    );

    return NextResponse.redirect(loginUrl);
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Error intercambiando código OAuth:", error);

    const loginUrl = new URL("/login", url.origin);

    loginUrl.searchParams.set(
      "error",
      "No se pudo completar el inicio de sesión."
    );

    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
