import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Carcasa compartida de las páginas legales.
 *
 * Componente de servidor, con estilos en línea y sin styled-jsx: el scoping
 * de styled-jsx en este proyecto ya rompió estilos que solo fallaban en el
 * build de producción. Una política de privacidad ilegible es peor que
 * cualquier otra página rota, porque es la que alguien lee cuando ya
 * desconfía.
 */
export default function PaginaLegal({
  titulo,
  actualizado,
  children,
}: {
  titulo: string;
  actualizado: string;
  children: ReactNode;
}) {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "48px 20px 80px",
        color: "var(--foreground)",
        lineHeight: 1.65,
        fontSize: 16,
      }}
    >
      <Link
        href="/"
        style={{ fontSize: 14, color: "#2563eb", textDecoration: "none", fontWeight: 600 }}
      >
        ← Volver a TransTech EOS
      </Link>

      <h1 style={{ fontSize: 30, fontWeight: 700, margin: "22px 0 6px", lineHeight: 1.25 }}>
        {titulo}
      </h1>
      <p style={{ margin: 0, fontSize: 14, opacity: 0.7 }}>
        Última actualización: {actualizado}
      </p>

      <div style={{ marginTop: 28 }}>{children}</div>

      <hr style={{ margin: "40px 0 20px", border: 0, borderTop: "1px solid rgba(128,128,128,.25)" }} />
      <p style={{ fontSize: 14, opacity: 0.75 }}>
        ¿Dudas sobre este documento? Escribinos a{" "}
        <a href="mailto:soporte@transtech.com.py" style={{ color: "#2563eb" }}>
          soporte@transtech.com.py
        </a>
        .
      </p>
      <p style={{ fontSize: 14, marginTop: 12 }}>
        <Link href="/privacidad" style={{ color: "#2563eb", marginRight: 14 }}>
          Política de privacidad
        </Link>
        <Link href="/terminos" style={{ color: "#2563eb" }}>
          Términos del servicio
        </Link>
      </p>
    </main>
  );
}

/**
 * Lista con viñetas visibles.
 *
 * El preflight de Tailwind pone `list-style: none` en todo `ul`, así que sin
 * esto los ítems se leen como párrafos sueltos y se pierde la estructura —
 * justo en un documento donde la estructura es lo que lo hace legible.
 */
export function Lista({ children }: { children: ReactNode }) {
  return (
    <ul style={{ listStyle: "disc outside", paddingLeft: 22, margin: "0 0 12px" }}>{children}</ul>
  );
}

/** Sección con título, para no repetir estilos en cada bloque. */
export function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 30 }}>
      <h2 style={{ fontSize: 19, fontWeight: 700, margin: "0 0 10px" }}>{titulo}</h2>
      {children}
    </section>
  );
}
