/**
 * Render del briefing diario como correo.
 *
 * Este es el único momento del día en que EOS aparece sin que lo llamen, así
 * que el tono importa más que el contenido. La doctrina es explícita: la
 * interfaz tiene que reducir ansiedad, no inducir culpa. Nada de listas de
 * pendientes en rojo ni "te quedan 14 tareas sin hacer".
 *
 * El correo responde primero "¿estás bien?" y recién después ofrece detalle.
 * Si no hay nada que decidir, lo dice con todas las letras — "no necesitás
 * hacer nada" es el producto que estamos vendiendo, no un relleno.
 *
 * Puro: recibe la fila del briefing y devuelve texto. Sin I/O, para poder
 * mirar el resultado sin mandar un correo de verdad.
 */

export type BriefingFila = {
  briefing_date: string | null;
  saludo: string | null;
  titulo_dia: string | null;
  resumen: string | null;
  enfoque_dia: string | null;
  prioridad_1: string | null;
  prioridad_2: string | null;
  prioridad_3: string | null;
  recomendacion_principal: string | null;
  proximos_pasos: unknown;
  riesgos: unknown;
  score: number | null;
};

export type CorreoBriefing = { asunto: string; html: string; texto: string };

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Igual que en el panel: sin `new Date`, que en zona PY corre un día. */
function fechaLegible(iso: string | null): string {
  if (!iso) return "";
  const [anio, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  if (!anio || !mes || !dia || mes < 1 || mes > 12) return "";
  return `${dia} de ${MESES[mes - 1]}`;
}

function limpiar(valor: string | null | undefined): string {
  return (valor ?? "").trim();
}

/** Los campos jsonb pueden venir como strings sueltos u objetos. */
function comoLista(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        for (const campo of ["texto", "titulo", "descripcion", "paso", "detalle"]) {
          if (typeof o[campo] === "string" && o[campo]) return (o[campo] as string).trim();
        }
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 5);
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderBriefing(
  briefing: BriefingFila,
  opciones: { nombre?: string | null; urlApp: string },
): CorreoBriefing {
  const fecha = fechaLegible(briefing.briefing_date);
  const nombre = limpiar(opciones.nombre) || "";

  const titulo = limpiar(briefing.titulo_dia) || "Tu día, ya organizado";
  const saludo = limpiar(briefing.saludo) || (nombre ? `Hola ${nombre}` : "Hola");
  const resumen = limpiar(briefing.resumen);
  const recomendacion = limpiar(briefing.recomendacion_principal);

  // `enfoque_dia` a veces trae un valor que no es una frase: se vieron
  // "media" (una severidad que se filtró al campo equivocado) y marcadores de
  // QA. "Enfoque de hoy: media" no significa nada para el usuario, así que
  // se exige que parezca una frase real antes de mostrarlo. Omitir una
  // sección es mejor que mostrar una que no se entiende.
  const enfoqueCrudo = limpiar(briefing.enfoque_dia);
  const enfoque =
    enfoqueCrudo.length >= 15 && enfoqueCrudo.includes(" ") && !/^[A-Z0-9_]+$/.test(enfoqueCrudo)
      ? enfoqueCrudo
      : "";

  const prioridades = [briefing.prioridad_1, briefing.prioridad_2, briefing.prioridad_3]
    .map(limpiar)
    .filter(Boolean);

  const riesgos = comoLista(briefing.riesgos);

  // La línea que define el tono. Si EOS no necesita nada del usuario, se lo
  // dice; es la diferencia entre un asistente y una lista de pendientes.
  const necesitaAlgo = prioridades.length > 0 || riesgos.length > 0;
  const cierre = necesitaAlgo
    ? "Si preferís verlo en detalle, está todo en EOS."
    : "No necesitás hacer nada. EOS sigue vigilando.";

  // El asunto NO sale del contenido generado.
  //
  // `titulo_dia` lo escribe el modelo, y en la base ya hay casos con basura
  // de QA ("EOS_RC1_QA_CREAR_TAREA_1786974099398", "hola"). Eso saldría tal
  // cual como asunto a un cliente que paga.
  //
  // Además, un asunto estable es mejor correo: la gente reconoce el briefing
  // de un vistazo y lo busca cuando lo necesita. El título generado sigue
  // apareciendo adentro, donde un valor raro es incómodo pero no vergonzoso.
  const asunto = fecha ? `Tu briefing de hoy · ${fecha}` : "Tu briefing de hoy";

  /* ---------- texto plano ---------- */
  const lineas: string[] = [saludo, ""];
  if (resumen) lineas.push(resumen, "");
  if (enfoque) lineas.push(`Enfoque de hoy: ${enfoque}`, "");
  if (prioridades.length) {
    lineas.push("Prioridades:");
    prioridades.forEach((p, i) => lineas.push(`  ${i + 1}. ${p}`));
    lineas.push("");
  }
  if (riesgos.length) {
    lineas.push("EOS está vigilando:");
    riesgos.forEach((r) => lineas.push(`  · ${r}`));
    lineas.push("");
  }
  if (recomendacion) lineas.push(`Recomendación: ${recomendacion}`, "");
  lineas.push(cierre, "", opciones.urlApp);
  const texto = lineas.join("\n");

  /* ---------- html ---------- */
  // Estilos en línea y estructura simple a propósito: los clientes de correo
  // ignoran hojas de estilo, y un correo roto en Gmail es un correo que no
  // se lee. Sin imágenes remotas, que además disparan el filtro de spam.
  const bloque = (contenido: string) => `<tr><td style="padding:0 0 18px 0">${contenido}</td></tr>`;

  const listaHtml = (items: string[], titulo: string, numerada: boolean) => {
    if (items.length === 0) return "";
    const li = items
      .map(
        (t) =>
          `<li style="margin:0 0 6px 0;color:#334155;font-size:15px;line-height:1.55">${escapar(t)}</li>`,
      )
      .join("");
    const tag = numerada ? "ol" : "ul";
    return bloque(
      `<div style="font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin:0 0 8px 0">${escapar(titulo)}</div>` +
        `<${tag} style="margin:0;padding-left:20px">${li}</${tag}>`,
    );
  };

  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:30px">
${bloque(
  `<div style="font-size:12px;font-weight:700;letter-spacing:.12em;color:#2563eb">EOS${fecha ? ` · ${escapar(fecha).toUpperCase()}` : ""}</div>` +
    `<h1 style="margin:10px 0 0 0;font-size:22px;line-height:1.3;color:#0f172a;font-weight:700">${escapar(titulo)}</h1>`,
)}
${bloque(`<div style="font-size:15px;color:#0f172a">${escapar(saludo)}</div>`)}
${resumen ? bloque(`<div style="font-size:15px;line-height:1.6;color:#334155">${escapar(resumen)}</div>`) : ""}
${
  enfoque
    ? bloque(
        `<div style="background:#f1f5f9;border-radius:10px;padding:14px 16px"><div style="font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:4px">Enfoque de hoy</div><div style="font-size:15px;line-height:1.55;color:#0f172a">${escapar(enfoque)}</div></div>`,
      )
    : ""
}
${listaHtml(prioridades, "Prioridades", true)}
${listaHtml(riesgos, "EOS está vigilando", false)}
${
  recomendacion
    ? bloque(
        `<div style="border-left:3px solid #2563eb;padding-left:14px"><div style="font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin-bottom:4px">Recomendación</div><div style="font-size:15px;line-height:1.55;color:#0f172a">${escapar(recomendacion)}</div></div>`,
      )
    : ""
}
${bloque(`<div style="font-size:15px;line-height:1.55;color:#334155">${escapar(cierre)}</div>`)}
${bloque(
  `<a href="${escapar(opciones.urlApp)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:11px 20px;border-radius:9px">Abrir EOS</a>`,
)}
<tr><td style="border-top:1px solid #e2e8f0;padding-top:16px">
<div style="font-size:12px;line-height:1.5;color:#94a3b8">Recibís esto porque activaste el briefing por correo en EOS. Podés desactivarlo cuando quieras desde tu perfil.</div>
</td></tr>
</table>
</td></tr>
</table>`;

  return { asunto, html, texto };
}
