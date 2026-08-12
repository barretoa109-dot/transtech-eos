import { POST as runWorkerGate } from "@/lib/worker-gate-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return runWorkerGate(request);
}
