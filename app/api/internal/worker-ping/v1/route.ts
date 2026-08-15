import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Authorization",
  };
}

function authorized(request: Request) {
  const expected = process.env.EOS_WORKER_GATE_SECRET;
  if (!expected) return { ok: false, unavailable: true };

  const header = request.headers.get("authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied) return { ok: false, unavailable: false };

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length) {
    return { ok: false, unavailable: false };
  }

  return {
    ok: timingSafeEqual(expectedBuffer, suppliedBuffer),
    unavailable: false,
  };
}

export async function POST(request: Request) {
  const authorization = authorized(request);

  if (authorization.unavailable) {
    return NextResponse.json(
      { ok: false, error: "Worker Gate no configurado." },
      { status: 503, headers: noStoreHeaders() },
    );
  }

  if (!authorization.ok) {
    return NextResponse.json(
      { ok: false, error: "No autorizado." },
      { status: 401, headers: noStoreHeaders() },
    );
  }

  return NextResponse.json(
    { ok: true, service: "eos-worker-gate", version: "rc1" },
    { headers: noStoreHeaders() },
  );
}
