/**
 * Búsqueda web (01/10/2026): la acción BUSCAR_WEB en el prompt, y que n8n
 * (el respaldo, que no sabe buscar) no prometa una búsqueda que no hace.
 *
 * El gateway en TypeScript resuelve BUSCAR_WEB (lib/gateway/con-busqueda.ts):
 * investiga aislado, el mismo modelo responde con la conversación + los
 * hallazgos, y el servidor controla citas y enlaces. n8n atiende solo si el
 * gateway TS delega; ahí la acción se descarta igual (no está en su lista
 * blanca), y este parche cambia la respuesta por una honesta: no pudo buscar.
 *
 * Sin comillas invertidas: en n8n el prompt vive dentro de un literal de
 * plantilla. `aplicar` lo verifica.
 */

const ANCLA_PROMPT = "ARCHIVOS QUE PIDE EL USUARIO\n";

const SECCION = [
  "BÚSQUEDA EN LA WEB",
  "",
  "BUSCAR_WEB",
  "  datos: { consulta, pais?, profundidad?, periodo? }",
  "  Para lo que necesita información ACTUAL de afuera, que no está en la",
  "  conversación ni en su contexto: precios de mercado, tendencias de un",
  "  rubro, competidores, disponibilidad de un producto, cotizaciones,",
  "  noticias, normas o datos publicados recientes. Antes de pedirla pensá qué",
  "  quiere resolver la persona y qué ya te dijo: buscá SOLO el dato que falta.",
  "  NO la uses para: lo que está en su contexto (sus ventas, su stock, sus",
  "  deudas); lo que ya buscaste en esta conversación (las fuentes están más",
  "  arriba: usalas para \"¿y cuál me conviene?\", \"¿cómo se compara?\" o \"¿qué",
  "  significa para mi negocio?\"); cuentas que podés hacer vos; consejos que no",
  "  dependen de un dato actual; ni para registrar nada.",
  "  consulta: corta y GENERAL, como se escribe en un buscador: producto,",
  "  marca, rubro, lugar, período. NUNCA nombres de personas, clientes o",
  "  proveedores, montos de la persona, teléfonos, documentos ni nada privado",
  "  de su conversación. \"precio cemento bolsa 50 kg Paraguay\", no \"a cuánto",
  "  le vendo el cemento a Juan\".",
  "  pais: código de dos letras. El que dijo la persona; si no dijo, PY (EOS",
  "  trabaja en Paraguay) y en la respuesta queda dicho. Si es global o de otro",
  "  país, ese. Si el lugar cambia mucho la respuesta y no lo podés suponer,",
  "  preguntalo en vez de buscar.",
  "  profundidad: \"profunda\" solo si pide investigar a fondo o comparar varios",
  "  competidores; si no, no la mandes.",
  "  periodo: si pide un rango de fechas (\"últimos 3 meses\", \"2026\").",
  "  UNA sola BUSCAR_WEB por mensaje: si hacen falta dos datos (tendencias y",
  "  precios), juntalos en la misma consulta.",
  "  Con BUSCAR_WEB, \"respuesta\" es una sola línea con lo que vas a averiguar.",
  "  Lo que se encuentra en internet NO es un dato de la persona: no lo guardes",
  "  con GUARDAR_MEMORIA. Las otras acciones que pidió en el mismo mensaje van",
  "  igual.",
  "",
].join("\n");

export const CAMBIOS = [
  { donde: "prompt: BUSCAR_WEB", viejo: ANCLA_PROMPT, nuevo: SECCION + "\n" + ANCLA_PROMPT },
];

/** n8n no busca: si el modelo pidió BUSCAR_WEB, la respuesta lo dice en vez de prometer. */
const TEXTO_N8N =
  "No pude buscar información actual por este camino. ¿Querés que te responda con lo que sé, aclarando que no son datos actualizados?";

const ANCLA_05 =
  "        .filter((accion) =>\n" +
  "          accionesPermitidas.has(\n" +
  "            accion.tipo\n" +
  "          )\n" +
  "        )\n" +
  "    : [];\n";

export const CAMBIOS_05 = [
  { donde: "05: la respuesta del modelo se renombra", viejo: "const respuesta =", nuevo: "const respuestaDelModelo =" },
  {
    donde: "05: BUSCAR_WEB no se promete",
    viejo: ANCLA_05,
    nuevo:
      ANCLA_05 +
      "\n" +
      "// Búsqueda web: solo la resuelve el gateway en TypeScript. Acá no se busca,\n" +
      "// así que no se puede contestar \"voy a averiguar\" (01/10/2026).\n" +
      "const pidioBuscarWeb =\n" +
      "  Array.isArray(resultado?.acciones) &&\n" +
      "  resultado.acciones.some((a) => String(a?.tipo || '').trim().toUpperCase() === 'BUSCAR_WEB');\n" +
      "\n" +
      `const respuesta = pidioBuscarWeb\n  ? '${TEXTO_N8N}'\n  : respuestaDelModelo;\n`,
  },
];

function aplicarLista(texto, cambios, etiqueta) {
  let salida = texto;
  for (const c of cambios) {
    if (c.nuevo.includes("`")) throw new Error(`[${etiqueta}] "${c.donde}" trae una comilla invertida.`);
    if (salida.includes(c.nuevo)) continue;
    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(`[${etiqueta}] "${c.donde}": el texto aparece ${partes.length - 1} veces, no 1. No se escribió nada.`);
    }
    salida = partes.join(c.nuevo);
  }
  return salida;
}

export function aplicar(texto, etiqueta) {
  return aplicarLista(texto, CAMBIOS, etiqueta);
}

/** Gateway: el prompt (nodo `HTTP Request`) y el nodo 05. Pura, sin red. */
export function transformarGateway(flujo) {
  const http = flujo.nodes.find((n) => n.name === "HTTP Request");
  if (!http) throw new Error('No existe el nodo "HTTP Request".');
  http.parameters.jsonBody = aplicar(http.parameters.jsonBody, "prompt de n8n");

  const n05 = flujo.nodes.find((n) => n.name === "05 GW Preparar Respuesta");
  if (!n05) throw new Error('No existe el nodo "05 GW Preparar Respuesta".');
  n05.parameters.jsCode = aplicarLista(n05.parameters.jsCode, CAMBIOS_05, "nodo 05");
  return flujo;
}
