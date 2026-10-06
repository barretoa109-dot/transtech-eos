"use client";

import { createContext, useContext } from "react";

import type { Espacio } from "./espacios";

/**
 * En qué espacio está la persona, para que cualquier pantalla lo pueda decir.
 *
 * Cada encabezado lleva arriba del título, en la etiqueta azul de siempre,
 * "GRANJA 79 · NEGOCIO" o "AUGUSTO · PERSONAL". Es lo que hace que el espacio
 * activo se vea en todo momento y no solo en el selector del lateral.
 */
export type EspacioActual = {
  espacio: Espacio;
  /** El nombre de la persona (Personal) o del negocio. */
  nombre: string;
};

const Contexto = createContext<EspacioActual>({ espacio: "personal", nombre: "" });

export const ProveedorEspacio = Contexto.Provider;

export function useEspacio(): EspacioActual {
  return useContext(Contexto);
}

/** El texto de la etiqueta azul: "Granja 79 · Negocio". Sin nombre, solo el espacio. */
export function useEtiquetaEspacio(): string {
  const { espacio, nombre } = useEspacio();
  const tipo = espacio === "personal" ? "Personal" : "Negocio";
  return nombre ? `${nombre} · ${tipo}` : tipo;
}
