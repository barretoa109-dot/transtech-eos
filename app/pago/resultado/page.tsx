import { Suspense } from "react";
import ResultadoPago from "./ResultadoPago";

export const dynamic = "force-dynamic";

export default function ResultadoPagoPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>Cargando...</main>}>
      <ResultadoPago />
    </Suspense>
  );
}
