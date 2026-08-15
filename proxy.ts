import type { NextRequest } from "next/server";
import { middleware } from "./lib/middleware";

export async function proxy(request: NextRequest) {
  return middleware(request);
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
