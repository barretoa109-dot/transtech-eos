import { Suspense } from "react";
import ResultadoPago from "./ResultadoPago";

export const dynamic = "force-dynamic";

export default function ResultadoPagoPage() {
  return (
    <Suspense fallback={<CargandoResultado />}>
      <ResultadoPago />
    </Suspense>
  );
}

function CargandoResultado() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background:
          "linear-gradient(180deg, #ffffff 0%, #f5f9ff 52%, #edf4ff 100%)",
        color: "#071226",
        fontFamily: "Inter, Arial, Helvetica, sans-serif",
      }}
    >
      <section
        style={{
          width: "min(580px, 100%)",
          minHeight: "240px",
          display: "grid",
          placeContent: "center",
          gap: "12px",
          padding: "30px",
          border: "1px solid #dbe5f2",
          borderRadius: "28px",
          background: "#ffffff",
          textAlign: "center",
          boxShadow: "0 24px 70px rgba(15, 23, 42, 0.08)",
        }}
      >
        <strong style={{ fontSize: "22px" }}>
          Verificando tu pago...
        </strong>

        <span
          style={{
            color: "#64748b",
            fontSize: "13px",
          }}
        >
          Estamos consultando el estado real del pedido.
        </span>
      </section>
    </main>
  );
}