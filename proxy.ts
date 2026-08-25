import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { destinoSeguro } from "@/lib/auth/destino";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  if (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/dashboard-eos" ||
    pathname.startsWith("/dashboard-eos/") ||
    pathname === "/mobile" ||
    pathname.startsWith("/mobile/")
  ) {
    const eosUrl = request.nextUrl.clone();
    eosUrl.pathname = "/eos/chat";
    eosUrl.search = "";

    return NextResponse.redirect(eosUrl);
  }

  // El onboarding necesita sesión igual que el chat: sin ella, todas las
  // respuestas del usuario se pierden con un 401 que él no ve, y la pantalla
  // le promete justo lo contrario ("cada respuesta queda guardada").
  const rutaProtegida =
    pathname.startsWith("/eos/chat") || pathname.startsWith("/eos/onboarding");

  if (rutaProtegida && !user) {
    const loginUrl = request.nextUrl.clone();

    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", pathname);

    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/login" && user) {
    /*
     * Al que ya tiene sesión, el login no tiene nada que ofrecerle; el
     * destino que venía pidiendo, sí.
     *
     * Antes se descartaba la query acá mismo, así que el enlace de un aviso
     * —"tu renovación no se pudo cobrar, vení a pagar"— terminaba en el chat
     * justamente para quien conserva la sesión abierta, que es el caso
     * normal a los pocos días. El formulario nunca llegaba a renderizarse:
     * el rebote ocurre antes.
     */
    const pedido = destinoSeguro(
      request.nextUrl.searchParams.get("next") ||
        request.nextUrl.searchParams.get("redirect"),
      request.nextUrl.origin,
    );

    return NextResponse.redirect(new URL(pedido, request.nextUrl.origin));
  }

  return response;
}

export const config = {
  matcher: [
    "/login",
    "/dashboard/:path*",
    "/dashboard-eos/:path*",
    "/eos/chat/:path*",
    "/eos/onboarding/:path*",
    "/mobile/:path*",
  ],
};
