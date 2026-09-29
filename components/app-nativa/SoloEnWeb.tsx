"use client";

import type { ReactNode } from "react";
import { useEsAppNativa } from "@/lib/app-nativa/cliente";

/**
 * Muestra su contenido en la web y lo esconde en la app nativa.
 *
 * Es para todo lo que invita a elegir un plan o a pagar: las tiendas no dejan
 * que una app lleve a comprar por fuera de su cobro (App Store 3.1.1 y
 * 3.1.3, pagos de Google Play). En la app se muestra `enApp`, si se pasa.
 */
export default function SoloEnWeb({
  children,
  enApp = null,
}: {
  children: ReactNode;
  enApp?: ReactNode;
}) {
  const appNativa = useEsAppNativa();
  return <>{appNativa ? enApp : children}</>;
}
