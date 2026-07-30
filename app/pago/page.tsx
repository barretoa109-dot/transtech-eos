import { Suspense } from "react";
import PagoCheckout from "./PagoCheckout";

export const dynamic = "force-dynamic";

export default function PagoPage() {
  return (
    <Suspense fallback={<CargandoPago />}>
      <PagoCheckout />
    </Suspense>
  );
}

function CargandoPago() {
  return (
    <main style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      padding: "24px",
      background: "linear-gradient(180deg, #ffffff 0%, #f5f9ff 52%, #edf4ff 100%)",
      color: "#071226",
      fontFamily: "Inter, Arial, Helvetica, sans-serif",
    }}>
      <strong>Preparando tu compra...</strong>
    </main>
  );
}
