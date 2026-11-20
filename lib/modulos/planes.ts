/**
 * Los planes que se venden (v263).
 *
 * El 20/11/2026 el dueño cambió "armá tu EOS" por cuatro planes cerrados:
 * Gratis, Finanzas Personales, Emprendedor / Empresas y Full. La pantalla de
 * planes los muestra desde acá para que se vean sin esperar a la base (la
 * página se prerenderiza entera).
 *
 * ESTE ARCHIVO NO COBRA. El precio que se cobra sale de `eos_paquetes`, en la
 * base, y lo copia `eos_guardar_paquete_v263` a la compra. `planes.test.ts`
 * compara estos números con los de la migración para que no se separen.
 *
 * Ningún texto de acá dice "ilimitado", "sin tope" ni "sin límite": todo plan
 * tiene tope interno y al cliente no se le promete lo contrario.
 */

export type CodigoPlan = "finanzas_personales" | "emprendedor" | "full";

export type Plan = {
  codigo: CodigoPlan;
  nombre: string;
  /** A quién le habla, en una línea. */
  para: string;
  precio_mensual_pyg: number;
  precio_anual_pyg: number;
  /** Los módulos que activa. Tienen que ser los mismos que en `eos_paquetes`. */
  modulos: readonly string[];
  /** Lo que se lista en la tarjeta. */
  incluye: readonly string[];
  destacado?: boolean;
};

/** Los mensajes por día del plan Gratis. La autoridad es `planes.limite_mensajes` de `free`. */
export const MENSAJES_GRATIS_POR_DIA = 10;

const PERSONALES = [
  "Panel de tu plata, en cada moneda",
  "Lectura automática de los avisos del banco",
  "Avisos antes de que no te alcance",
] as const;

const NEGOCIO = [
  "Ventas, compras y stock hablando o por audio",
  "Clientes y quién te debe",
  "Comprobantes de venta (beta)",
  "Usuarios para tu equipo, con roles",
] as const;

const COMUNES = ["Resumen diario en tu correo", "Documentos a pedido: Excel, PDF o Word"] as const;

export const PLANES: readonly Plan[] = [
  {
    codigo: "finanzas_personales",
    nombre: "Finanzas Personales",
    para: "Para ordenar tu plata personal.",
    precio_mensual_pyg: 50_000,
    precio_anual_pyg: 500_000,
    modulos: ["conversaciones_full", "dashboard", "lectura", "alertas", "briefing", "decisiones", "documentos"],
    incluye: ["Hablar con EOS todos los días", ...PERSONALES, ...COMUNES],
  },
  {
    codigo: "emprendedor",
    nombre: "Emprendedor / Empresas",
    para: "Para llevar tu negocio hablando, sin planillas.",
    precio_mensual_pyg: 100_000,
    precio_anual_pyg: 1_000_000,
    modulos: [
      "conversaciones_full",
      "dashboard",
      "erp",
      "crm",
      "facturacion",
      "briefing",
      "decisiones",
      "documentos",
    ],
    incluye: ["Hablar con EOS todos los días", ...NEGOCIO, ...COMUNES],
    destacado: true,
  },
  {
    codigo: "full",
    nombre: "Full",
    para: "Tu negocio y tu plata personal, cada uno en su lugar.",
    precio_mensual_pyg: 130_000,
    precio_anual_pyg: 1_300_000,
    modulos: [
      "conversaciones_full",
      "dashboard",
      "lectura",
      "alertas",
      "erp",
      "crm",
      "facturacion",
      "briefing",
      "decisiones",
      "documentos",
    ],
    incluye: ["Todo lo de Finanzas Personales", "Todo lo de Emprendedor / Empresas"],
  },
];

export function esCodigoPlan(valor: unknown): valor is CodigoPlan {
  return typeof valor === "string" && PLANES.some((p) => p.codigo === valor);
}

export function planPorCodigo(codigo: string | null | undefined): Plan | null {
  return PLANES.find((p) => p.codigo === codigo) ?? null;
}

export function precioDelPlan(plan: Plan, periodicidad: "mensual" | "anual"): number {
  return periodicidad === "anual" ? plan.precio_anual_pyg : plan.precio_mensual_pyg;
}
