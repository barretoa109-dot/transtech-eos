import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

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
  const next = request.nextUrl.searchParams.get("next");

  if (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/dashboard-eos" ||
    pathname.startsWith("/dashboard-eos/")
  ) {
    const eosUrl = request.nextUrl.clone();
    eosUrl.pathname = "/eos/chat";
    eosUrl.search = "";

    return NextResponse.redirect(eosUrl);
  }

  const rutaProtegida =
    pathname.startsWith("/eos/chat") || pathname.startsWith("/mobile");

  if (rutaProtegida && !user) {
    const loginUrl = request.nextUrl.clone();

    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", pathname);

    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/login" && user) {
    const destino = next === "/mobile" ? "/mobile" : "/eos/chat";
    const destinoUrl = request.nextUrl.clone();

    destinoUrl.pathname = destino;
    destinoUrl.search = "";

    return NextResponse.redirect(destinoUrl);
  }

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
