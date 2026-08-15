import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const DESTINOS_LOGIN_PERMITIDOS = ["/eos/chat", "/mobile", "/planes", "/pago"];

function destinoLoginSeguro(request: NextRequest) {
  const raw =
    request.nextUrl.searchParams.get("next") ||
    request.nextUrl.searchParams.get("redirect");

  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/eos/chat";
  }

  try {
    const destino = new URL(raw, request.nextUrl.origin);

    if (destino.origin !== request.nextUrl.origin) {
      return "/eos/chat";
    }

    const permitido = DESTINOS_LOGIN_PERMITIDOS.some(
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

export async function middleware(request: NextRequest) {
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

        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });

          Object.entries(headers).forEach(([key, value]) => {
            response.headers.set(key, value);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  function redirectConSesion(url: URL) {
    const redirect = NextResponse.redirect(url);

    response.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie);
    });

    for (const header of ["cache-control", "expires", "pragma"]) {
      const value = response.headers.get(header);
      if (value) redirect.headers.set(header, value);
    }

    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  }

  const pathname = request.nextUrl.pathname;

  if (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/dashboard-eos" ||
    pathname.startsWith("/dashboard-eos/")
  ) {
    const eosUrl = request.nextUrl.clone();
    eosUrl.pathname = "/eos/chat";
    eosUrl.search = "";

    return redirectConSesion(eosUrl);
  }

  const rutaProtegida =
    pathname.startsWith("/eos/chat") || pathname.startsWith("/mobile");

  if (rutaProtegida && !user) {
    const loginUrl = request.nextUrl.clone();
    const retorno = `${pathname}${request.nextUrl.search}`;

    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", retorno);

    return redirectConSesion(loginUrl);
  }

  if (pathname === "/login" && user) {
    const destino = new URL(destinoLoginSeguro(request), request.nextUrl.origin);
    return redirectConSesion(destino);
  }

  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    "/login",
    "/dashboard/:path*",
    "/dashboard-eos/:path*",
    "/eos/chat/:path*",
    "/mobile/:path*",
  ],
};
