import {
  ArrowLeftRight,
  BarChart3,
  CalendarClock,
  CalendarDays,
  FileText,
  Handshake,
  House,
  LineChart,
  Package,
  Repeat,
  ScrollText,
  Settings,
  ShoppingCart,
  Tag,
  Target,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * Los espacios de EOS: Personal y el negocio (etapa 1 de la reorganización,
 * 05/10/2026).
 *
 * Hasta acá Personal y Negocio eran dos entradas más del mismo menú, al lado
 * de Dashboard, CRM, Briefing y Calendario. El menú mezclaba la plata de la
 * persona con la de la empresa y quien entraba no sabía en cuál de las dos
 * estaba. Ahora se elige el espacio arriba a la izquierda y el menú muestra
 * solo lo de ese espacio.
 *
 * Los datos ya estaban separados en la base (`ambito` desde la v136 y
 * `empresa_id` desde la v110): esto es la pantalla alcanzando a la base.
 */

export type Espacio = "personal" | "negocio";

export type Destino =
  | "chat"
  | "perfil"
  | "calendario"
  | "briefing"
  | "memoria"
  | "p-inicio"
  | "p-mes"
  | "p-fijos"
  | "p-viene"
  | "p-tengo"
  | "p-metas"
  | "p-informes"
  | "p-ajustes"
  | "n-resumen"
  | "n-ventas"
  | "n-compras"
  | "n-fijos"
  | "n-catalogo"
  | "n-clientes"
  | "n-numeros"
  | "n-ajustes";

export type ItemMenu = {
  destino: Destino;
  etiqueta: string;
  Icono: LucideIcon;
  /** Una nota corta a la derecha, en gris (p. ej. "todos" en Calendario). */
  nota?: string;
  /**
   * Agrupa este ítem bajo una etiqueta de sección (p. ej. "Tu plata"). Solo
   * Personal la usa por ahora: Negocio queda como estaba, sin agrupar.
   */
  grupo?: string;
  /**
   * Ítem de menor peso visual, al pie del menú en vez de entre las preguntas
   * del día a día. Es el caso de Ajustes en Personal: configuración de una
   * sola vez, no algo que se mira seguido.
   */
  chico?: boolean;
};

/** Lo que un negocio puede sacar de su menú (v232). */
export type FuncionOcultable = "catalogo" | "clientes";

/**
 * Agrupado bajo "Tu plata" desde la reorganización del 2026-10 (maqueta
 * aprobada): Inicio es el pulso del día y queda solo, afuera del grupo; las
 * seis preguntas sobre el dinero van juntas, con una etiqueta que lo dice.
 */
export const MENU_PERSONAL: ItemMenu[] = [
  { destino: "p-inicio", etiqueta: "Inicio", Icono: House },
  { destino: "p-mes", etiqueta: "Ingresos y gastos", Icono: ArrowLeftRight, grupo: "Tu plata" },
  { destino: "p-fijos", etiqueta: "Fijos y recurrentes", Icono: Repeat, grupo: "Tu plata" },
  { destino: "p-viene", etiqueta: "Lo que viene", Icono: CalendarClock, grupo: "Tu plata" },
  { destino: "p-tengo", etiqueta: "Tengo y debo", Icono: Wallet, grupo: "Tu plata" },
  { destino: "p-metas", etiqueta: "Mis metas", Icono: Target, grupo: "Tu plata" },
  { destino: "p-informes", etiqueta: "Informes", Icono: FileText, grupo: "Tu plata" },
];

export function menuNegocio(ocultas: FuncionOcultable[]): ItemMenu[] {
  const items: ItemMenu[] = [
    { destino: "n-resumen", etiqueta: "Resumen", Icono: BarChart3 },
    { destino: "briefing", etiqueta: "Briefing del día", Icono: FileText },
    { destino: "n-ventas", etiqueta: "Ventas y cobros", Icono: Tag },
    { destino: "n-compras", etiqueta: "Compras y gastos", Icono: ShoppingCart },
    { destino: "n-fijos", etiqueta: "Fijos y recurrentes", Icono: Repeat },
  ];
  if (!ocultas.includes("catalogo")) items.push({ destino: "n-catalogo", etiqueta: "Catálogo", Icono: Package });
  if (!ocultas.includes("clientes")) items.push({ destino: "n-clientes", etiqueta: "Clientes", Icono: Handshake });
  items.push({ destino: "n-numeros", etiqueta: "Números y reportes", Icono: LineChart });
  return items;
}

/**
 * Lo que va al final del menú en los dos espacios.
 *
 * En Personal, Ajustes pasa al pie, chico: es configuración de una sola vez,
 * no una pregunta del día a día, y competía con el resto por el mismo peso
 * visual. En Negocio queda exactamente como estaba (mismo orden, sin agrupar)
 * — esa reorganización fue solo para Personal.
 */
export function menuComun(espacio: Espacio): ItemMenu[] {
  const decisiones: ItemMenu = { destino: "memoria", etiqueta: "Decisiones y aprendizajes", Icono: ScrollText };
  const ajustes: ItemMenu = {
    destino: espacio === "personal" ? "p-ajustes" : "n-ajustes",
    etiqueta: espacio === "personal" ? "Ajustes de Personal" : "Ajustes del negocio",
    Icono: Settings,
  };
  // El calendario cruza los dos espacios: cobros del negocio y cuotas de la persona.
  const calendario: ItemMenu = { destino: "calendario", etiqueta: "Calendario", Icono: CalendarDays, nota: "todos" };

  if (espacio === "personal") {
    return [
      { ...decisiones, grupo: "General" },
      { ...calendario, grupo: "General" },
      { ...ajustes, chico: true },
    ];
  }

  return [decisiones, ajustes, calendario];
}

/** A qué espacio pertenece un destino. `null` = sirve en los dos (chat, perfil, calendario, memoria). */
export function espacioDe(destino: Destino): Espacio | null {
  if (destino.startsWith("p-")) return "personal";
  if (destino.startsWith("n-") || destino === "briefing") return "negocio";
  return null;
}

/** El inicio de cada espacio: adonde se va al cambiar de espacio. */
export function inicioDe(espacio: Espacio): Destino {
  return espacio === "personal" ? "p-inicio" : "n-resumen";
}

/**
 * Los enlaces viejos (`?vista=...`) siguen funcionando.
 *
 * Los correos del briefing, del calendario y de los primeros días apuntan a
 * `/eos/chat?vista=...` con los nombres de antes. Un correo ya enviado no se
 * puede corregir, así que cada nombre viejo sigue llevando al mismo lugar.
 */
const DESDE_VISTA_VIEJA: Record<string, Destino> = {
  chat: "chat",
  perfil: "perfil",
  calendario: "calendario",
  briefing: "briefing",
  decisions: "memoria",
  learnings: "memoria",
  dashboard: "n-resumen",
  negocio: "n-resumen",
  crm: "n-clientes",
  gastos: "p-inicio",
};

const DESTINOS = new Set<string>([
  "chat",
  "perfil",
  "calendario",
  "briefing",
  "memoria",
  ...MENU_PERSONAL.map((i) => i.destino),
  ...menuNegocio([]).map((i) => i.destino),
  "p-ajustes",
  "n-ajustes",
]);

export function destinoDesdeUrl(valor: string | null): Destino | null {
  if (!valor) return null;
  if (DESTINOS.has(valor)) return valor as Destino;
  return DESDE_VISTA_VIEJA[valor] ?? null;
}

/** El nombre que va en la pestaña del navegador y en el correo de soporte. */
export function nombreDeDestino(destino: Destino, espacio: Espacio): string {
  const todos = [...MENU_PERSONAL, ...menuNegocio([]), ...menuComun(espacio)];
  return todos.find((i) => i.destino === destino)?.etiqueta ?? (destino === "perfil" ? "Perfil" : "Chat");
}
