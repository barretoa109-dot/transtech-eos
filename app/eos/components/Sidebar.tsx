"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { filtrarConversaciones } from "@/lib/eos/buscar-chats";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronRight,
  ChevronsUpDown,
  Ellipsis,
  Lock,
  Pencil,
  Plus,
  Share2,
  Store,
  Trash2,
  User,
  PanelLeftClose,
} from "lucide-react";
import type { Destino, Espacio, ItemMenu } from "./espacios";

type Conversacion = {
  id: string;
  titulo: string | null;
  created_at?: string;
  archivada_at?: string | null;
};

/** Ancho del menú de tres puntos, para alinearlo al borde derecho del chat. */
const ANCHO_MENU = 196;
/** Alto aproximado: si no entra debajo del chat, se abre hacia arriba. */
const ALTO_MENU = 190;

type MenuAbierto = { id: string; top: number; left: number; haciaArriba: boolean };
type TextoCompartir = { id: string; texto: Promise<string | null>; listo?: string | null };

/** Una opción del selector de espacios: Personal o uno de los negocios de la persona. */
export type OpcionEspacio = {
  /** "personal" o el id de la empresa. */
  clave: string;
  espacio: Espacio;
  nombre: string;
  detalle: string;
};

type SidebarProps = {
  nombre: string;
  plan: string;
  /** Dónde está la persona: el ítem del menú marcado, o "chat"/"perfil". */
  destino: Destino;
  espacio: Espacio;
  /** El menú del espacio activo, ya armado (sin lo que el negocio apagó). */
  itemsMenu: ItemMenu[];
  /** Números rojos al lado de un ítem (p. ej. fijos vencidos sin registrar). */
  avisos?: Partial<Record<Destino, number>>;
  opcionesEspacio: OpcionEspacio[];
  claveEspacioActivo: string;
  onElegirEspacio: (opcion: OpcionEspacio) => void;
  selectorAbierto: boolean;
  onSelectorAbierto: (abierto: boolean) => void;
  busqueda: string;
  /** Chats con un mensaje que coincide con la búsqueda, y el pedazo que coincide. */
  coincidencias?: Record<string, string>;
  /** Mientras se busca en los mensajes. */
  buscando?: boolean;
  conversacionId: string;
  conversaciones: Conversacion[];
  colapsado: boolean;
  onToggleColapsado: () => void;
  onDestino: (destino: Destino) => void;
  onBusquedaChange: (value: string) => void;
  onNuevoChat: () => void;
  onAbrirConversacion: (id: string) => void;
  /** Cada una devuelve si se pudo; si no, la barra avisa y no cambia nada. */
  onRenombrar: (id: string, titulo: string) => Promise<boolean>;
  onArchivar: (id: string, archivar: boolean) => Promise<boolean>;
  onEliminar: (id: string) => Promise<boolean>;
  /** El texto de la conversación para compartir, o null si no se pudo leer. */
  onTextoParaCompartir: (id: string, titulo: string) => Promise<string | null>;
};

export default function Sidebar({
  nombre,
  plan,
  destino,
  espacio,
  itemsMenu,
  avisos = {},
  opcionesEspacio,
  claveEspacioActivo,
  onElegirEspacio,
  selectorAbierto,
  onSelectorAbierto,
  busqueda,
  coincidencias = {},
  buscando = false,
  conversacionId,
  conversaciones,
  onToggleColapsado,
  onDestino,
  onBusquedaChange,
  onNuevoChat,
  onAbrirConversacion,
  onRenombrar,
  onArchivar,
  onEliminar,
  onTextoParaCompartir,
}: SidebarProps) {
  const [menu, setMenu] = useState<MenuAbierto | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [tituloEditado, setTituloEditado] = useState("");
  const [verArchivados, setVerArchivados] = useState(false);
  const [aviso, setAviso] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  /*
   * El texto a compartir se empieza a leer al ABRIR el menú, no al tocar
   * "Compartir". En el celular, la hoja de compartir solo se abre si se pide
   * enseguida del toque; si antes hay que esperar a la base, Safari la
   * rechaza por no venir de un gesto de la persona.
   */
  const textoCompartirRef = useRef<TextoCompartir | null>(null);

  // Por título y por lo que se habló (`lib/eos/buscar-chats.ts`). Buscando
  // aparecen también los archivados: a veces lo que se busca está justo en
  // un chat que se guardó para que no estorbe.
  const conversacionesFiltradas = busqueda
    ? filtrarConversaciones(conversaciones, busqueda, coincidencias)
    : conversaciones.filter((c) => !c.archivada_at);
  const archivadas = busqueda ? [] : conversaciones.filter((c) => c.archivada_at);

  useEffect(() => {
    if (!menu) return;

    function alTocarAfuera(evento: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(evento.target as Node)) setMenu(null);
    }
    function alPresionarTecla(evento: KeyboardEvent) {
      if (evento.key === "Escape") setMenu(null);
    }

    document.addEventListener("pointerdown", alTocarAfuera);
    document.addEventListener("keydown", alPresionarTecla);
    return () => {
      document.removeEventListener("pointerdown", alTocarAfuera);
      document.removeEventListener("keydown", alPresionarTecla);
    };
  }, [menu]);

  useEffect(() => {
    if (!aviso) return;
    const timeout = window.setTimeout(() => setAviso(""), 3500);
    return () => window.clearTimeout(timeout);
  }, [aviso]);

  function abrirMenu(evento: React.MouseEvent<HTMLButtonElement>, c: Conversacion) {
    evento.stopPropagation();

    if (menu?.id === c.id) {
      setMenu(null);
      return;
    }

    /*
     * El menú se dibuja fuera de la lista y se ubica a mano: dentro de
     * `.conv-scroll` quedaría cortado en el último chat, porque la lista
     * tiene su propio scroll.
     */
    const boton = evento.currentTarget;
    const lateral = boton.closest(".eos-sidebar");
    if (!lateral) return;

    const b = boton.getBoundingClientRect();
    const l = lateral.getBoundingClientRect();
    const haciaArriba = b.bottom + ALTO_MENU > window.innerHeight - 8;

    setMenu({
      id: c.id,
      top: haciaArriba ? b.top - l.top - 4 : b.bottom - l.top + 4,
      left: Math.max(8, b.right - l.left - ANCHO_MENU),
      haciaArriba,
    });

    const pedido: TextoCompartir = { id: c.id, texto: onTextoParaCompartir(c.id, c.titulo || "Nuevo chat") };
    void pedido.texto.then((texto) => {
      pedido.listo = texto;
    });
    textoCompartirRef.current = pedido;
  }

  async function compartir(c: Conversacion) {
    setMenu(null);

    const pedido = textoCompartirRef.current;
    const texto = pedido?.id === c.id ? (pedido.listo !== undefined ? pedido.listo : await pedido.texto) : null;

    if (!texto) {
      setAviso("No pudimos leer la conversación. Probá de nuevo.");
      return;
    }

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: c.titulo || "Nuevo chat", text: texto });
        return;
      } catch (error) {
        // Cerrar la hoja sin elegir nada no es un error.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(texto);
      setAviso("Copiamos la conversación. Pegala donde quieras mandarla.");
    } catch {
      setAviso("No pudimos compartirla desde este navegador.");
    }
  }

  function empezarRenombrar(c: Conversacion) {
    setMenu(null);
    setEditandoId(c.id);
    setTituloEditado(c.titulo || "");
  }

  async function terminarRenombrar(c: Conversacion) {
    // Enter y después el blur del campo llaman dos veces: la segunda no hace nada.
    if (editandoId !== c.id) return;
    setEditandoId(null);

    const nuevo = tituloEditado.trim();
    if (!nuevo || nuevo === (c.titulo || "").trim()) return;

    if (!(await onRenombrar(c.id, nuevo))) setAviso("No pudimos cambiar el nombre. Probá de nuevo.");
  }

  async function archivar(c: Conversacion) {
    setMenu(null);
    const archivar = !c.archivada_at;

    if (await onArchivar(c.id, archivar)) {
      setAviso(archivar ? "Chat archivado. Lo encontrás en Archivados, al final de la lista." : "El chat volvió a la lista.");
    } else {
      setAviso(archivar ? "No pudimos archivar el chat. Probá de nuevo." : "No pudimos sacarlo de archivados.");
    }
  }

  async function eliminar(c: Conversacion) {
    setMenu(null);
    const titulo = c.titulo || "Nuevo chat";

    if (!window.confirm(`¿Eliminar "${titulo}"?\n\nSe borra la conversación con todos sus mensajes y no se puede deshacer.`)) {
      return;
    }

    if (!(await onEliminar(c.id))) setAviso("No pudimos eliminar el chat. Probá de nuevo.");
  }

  function filaDeChat(c: Conversacion) {
    const activo = destino === "chat" && c.id === conversacionId;
    const titulo = c.titulo || "Nuevo chat";

    if (editandoId === c.id) {
      return (
        <div key={c.id} className="conv-row">
          <div className={`conv editing ${activo ? "active" : ""}`}>
            <input
              className="conv-rename"
              aria-label="Nuevo nombre del chat"
              value={tituloEditado}
              maxLength={80}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setTituloEditado(e.target.value)}
              onBlur={() => void terminarRenombrar(c)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void terminarRenombrar(c);
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setEditandoId(null);
                }
              }}
            />
          </div>
        </div>
      );
    }

    return (
      <div key={c.id} className={`conv-row ${menu?.id === c.id ? "menu-open" : ""}`}>
        <button
          type="button"
          className={`conv ${activo ? "active" : ""}`}
          onClick={() => onAbrirConversacion(c.id)}
        >
          <span className="t">{titulo}</span>
          {busqueda && coincidencias[c.id] ? <span className="frag">{coincidencias[c.id]}</span> : null}
          <span className="d">
            {formatearFecha(c.created_at)}
            {busqueda && c.archivada_at ? " · Archivado" : ""}
          </span>
        </button>
        <button
          type="button"
          className="conv-more"
          aria-label={`Opciones de ${titulo}`}
          aria-haspopup="menu"
          aria-expanded={menu?.id === c.id}
          onClick={(e) => abrirMenu(e, c)}
        >
          <Ellipsis size={16} />
        </button>
      </div>
    );
  }

  const conversacionDelMenu = menu ? conversaciones.find((c) => c.id === menu.id) : undefined;

  const iniciales =
    nombre
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join("") || "U";

  const planFormateado = capitalizar(plan || "free");

  return (
    <>
      <div className="side-top">
        <div className="brand">
          <Image className="brand-logo" src="/transtech-logo.png" alt="TransTech" width={26} height={26} />
          <div>
            <div className="brand-word">EOS</div>
            <div className="brand-sub">Executive Operating System</div>
          </div>
        </div>
        <button type="button" className="sidebar-toggle" onClick={onToggleColapsado} aria-label="Colapsar menú">
          <PanelLeftClose size={16} />
        </button>
      </div>

      <SelectorEspacio
        opciones={opcionesEspacio}
        claveActiva={claveEspacioActivo}
        abierto={selectorAbierto}
        onAbierto={onSelectorAbierto}
        onElegir={onElegirEspacio}
      />

      <button type="button" className="row-item new" onClick={onNuevoChat}>
        <div className="ic">
          <Plus size={16} />
        </div>
        <span className="label">Nuevo chat</span>
      </button>

      <div className="search-row">
        <input
          type="search"
          aria-label="Buscar en tus chats"
          placeholder="Buscar en tus chats"
          value={busqueda}
          onChange={(e) => onBusquedaChange(e.target.value)}
        />
      </div>

      <div className="conv-scroll" onScroll={() => menu && setMenu(null)}>
        <nav className="side-nav" aria-label={espacio === "personal" ? "Secciones de Personal" : "Secciones del negocio"}>
          {itemsMenu.map((item) => (
            <button
              key={item.destino}
              type="button"
              className={`row-item nav-item ${destino === item.destino ? "active-view" : ""}`}
              aria-current={destino === item.destino ? "page" : undefined}
              onClick={() => onDestino(item.destino)}
            >
              <div className="ic">
                <item.Icono size={16} />
              </div>
              <span className="label">{item.etiqueta}</span>
              {avisos[item.destino] ? (
                <span className="side-aviso" aria-label={`${avisos[item.destino]} para atender`}>
                  {avisos[item.destino]}
                </span>
              ) : item.nota ? (
                <span className="side-nota">{item.nota}</span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="section-label">Conversaciones</div>

        {conversacionesFiltradas.length === 0 ? (
          <div className="conv" style={{ color: "var(--muted)", cursor: "default" }}>
            {busqueda ? (buscando ? "Buscando…" : "Sin resultados") : "Todavía no hay conversaciones"}
          </div>
        ) : (
          conversacionesFiltradas.map(filaDeChat)
        )}

        {archivadas.length > 0 ? (
          <>
            <button
              type="button"
              className={`section-label archived-toggle ${verArchivados ? "open" : ""}`}
              aria-expanded={verArchivados}
              onClick={() => setVerArchivados((v) => !v)}
            >
              <ChevronRight size={13} />
              Archivados ({archivadas.length})
            </button>
            {verArchivados ? archivadas.map(filaDeChat) : null}
          </>
        ) : null}
      </div>

      {menu && conversacionDelMenu ? (
        <div
          ref={menuRef}
          className={`conv-menu ${menu.haciaArriba ? "up" : ""}`}
          role="menu"
          style={{ top: menu.top, left: menu.left, width: ANCHO_MENU }}
        >
          <button type="button" role="menuitem" onClick={() => void compartir(conversacionDelMenu)}>
            <Share2 size={15} /> Compartir
          </button>
          <button type="button" role="menuitem" onClick={() => empezarRenombrar(conversacionDelMenu)}>
            <Pencil size={15} /> Renombrar
          </button>
          <button type="button" role="menuitem" onClick={() => void archivar(conversacionDelMenu)}>
            {conversacionDelMenu.archivada_at ? (
              <>
                <ArchiveRestore size={15} /> Desarchivar
              </>
            ) : (
              <>
                <Archive size={15} /> Archivar
              </>
            )}
          </button>
          <button type="button" role="menuitem" className="danger" onClick={() => void eliminar(conversacionDelMenu)}>
            <Trash2 size={15} /> Eliminar
          </button>
        </div>
      ) : null}

      {aviso ? (
        <div className="conv-aviso" role="status">
          {aviso}
        </div>
      ) : null}

      <div className="side-bottom">
        <button type="button" className="profile-row" onClick={() => onDestino("perfil")}>
          <div className="avatar">{iniciales}</div>
          <div>
            <div className="pname">{nombre || "Usuario"}</div>
            <div className="plan">Plan {planFormateado}</div>
          </div>
        </button>
      </div>
    </>
  );
}

function capitalizar(value: string) {
  const normalizado = value.trim();
  if (!normalizado) return "Free";
  return normalizado.charAt(0).toUpperCase() + normalizado.slice(1).toLowerCase();
}

function formatearFecha(fecha?: string) {
  if (!fecha) return "";

  const valor = new Date(fecha);
  if (Number.isNaN(valor.getTime())) return "";

  return valor.toLocaleDateString("es-PY", { day: "2-digit", month: "short" });
}

/**
 * El selector de espacio, debajo de la marca (05/10/2026).
 *
 * Está arriba a la izquierda porque es la primera pregunta: ¿esto es mío o del
 * negocio? Al elegir otro espacio cambian el menú, los números y lo que EOS
 * ve. Los negocios son los de `eos_empresa_miembros`: el propio y aquellos a
 * los que la persona fue invitada.
 */
function SelectorEspacio({
  opciones,
  claveActiva,
  abierto,
  onAbierto,
  onElegir,
}: {
  opciones: OpcionEspacio[];
  claveActiva: string;
  abierto: boolean;
  onAbierto: (abierto: boolean) => void;
  onElegir: (opcion: OpcionEspacio) => void;
}) {
  const cajaRef = useRef<HTMLDivElement | null>(null);
  const activa = opciones.find((o) => o.clave === claveActiva) ?? opciones[0];

  useEffect(() => {
    if (!abierto) return;

    function alTocarAfuera(evento: PointerEvent) {
      if (cajaRef.current && !cajaRef.current.contains(evento.target as Node)) onAbierto(false);
    }
    function alPresionarTecla(evento: KeyboardEvent) {
      if (evento.key === "Escape") onAbierto(false);
    }

    document.addEventListener("pointerdown", alTocarAfuera);
    document.addEventListener("keydown", alPresionarTecla);
    return () => {
      document.removeEventListener("pointerdown", alTocarAfuera);
      document.removeEventListener("keydown", alPresionarTecla);
    };
  }, [abierto, onAbierto]);

  if (!activa) return null;

  const fila = (o: OpcionEspacio) => {
    const es = o.clave === activa.clave;
    return (
      <button
        key={o.clave}
        type="button"
        role="menuitemradio"
        aria-checked={es}
        className={`espacio-opcion ${es ? "is-activa" : ""}`}
        onClick={() => {
          onAbierto(false);
          if (!es) onElegir(o);
        }}
      >
        <span className="espacio-ic is-chico">{o.espacio === "personal" ? <User size={15} /> : <Store size={15} />}</span>
        <span className="espacio-txt">
          <b>{o.nombre}</b>
          <span>{o.detalle}</span>
        </span>
        {es ? <Check size={16} className="espacio-check" /> : null}
      </button>
    );
  };

  const personales = opciones.filter((o) => o.espacio === "personal");
  const negocios = opciones.filter((o) => o.espacio === "negocio");

  return (
    <div className="espacio-selector" ref={cajaRef}>
      <button
        type="button"
        className="espacio-boton"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label={`Cambiar de espacio. Estás en ${activa.nombre}`}
        onClick={() => onAbierto(!abierto)}
      >
        <span className="espacio-ic">{activa.espacio === "personal" ? <User size={17} /> : <Store size={17} />}</span>
        <span className="espacio-txt">
          <b>{activa.nombre}</b>
          <span>{activa.espacio === "personal" ? "Personal" : "Negocio"}</span>
        </span>
        <ChevronsUpDown size={16} className="espacio-chev" />
      </button>

      {abierto ? (
        <div className="espacio-menu" role="menu" aria-label="Tus espacios">
          <div className="espacio-grupo">Personal</div>
          {personales.map(fila)}
          <div className="espacio-grupo">{negocios.length === 1 ? "Negocio" : "Negocios"}</div>
          {negocios.length > 0 ? (
            negocios.map(fila)
          ) : (
            <div className="espacio-pie">Todavía no hay un negocio a tu nombre.</div>
          )}
          <div className="espacio-pie">
            <Lock size={13} />
            <span>Cada espacio guarda sus propios registros. Nada se suma entre espacios.</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
