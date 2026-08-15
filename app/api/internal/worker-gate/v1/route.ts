import { POST as runWorkerGate } from "@/lib/worker-gate-handler";
import { validateWorkerGatePayloadBinding } from "@/lib/worker-gate-payload-binding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const blocked = await validateWorkerGatePayloadBinding(request);
  if (blocked) return blocked;

  return runWorkerGate(request);
}
