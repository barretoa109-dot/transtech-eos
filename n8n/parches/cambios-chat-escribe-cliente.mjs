/**
 * El chat le escribe a un cliente por WhatsApp: "sí, escribile".
 *
 * ============================================================
 * EL HUECO
 * ============================================================
 *
 * El CRM avisa a quién hay que retomar y propone qué decirle. La respuesta natural
 * a eso es "sí, escribile" en el chat, y el chat no tenía el verbo. Ver la
 * migración v186.
 *
 * ============================================================
 * LO QUE EL PROMPT TIENE QUE IMPEDIR
 * ============================================================
 *
 * Que EOS le escriba a un cliente sin que la persona haya visto el texto. Un mensaje
 * enviado no se deshace, y es el único verbo que habla con un tercero. Por eso el
 * prompt lo condiciona a una confirmación explícita, y sin texto NO se envía: se
 * propone.
 *
 * ============================================================
 * LOS CINCO LUGARES DE N8N
 * ============================================================
 *
 * 1. El prompt del gateway (nodo HTTP Request): sin esto el modelo no conoce el verbo.
 * 2. `05 GW`: la lista blanca de acciones. Sin esto la acción se descarta en silencio.
 * 3. `06 GW`: la ruta al worker. Sin esto sale sin destino.
 * 4. `01 INT` del worker: su lista blanca.
 * 5. `05 INT` del worker: la frase. Dice si el mensaje SALIÓ, y si no, por qué.
 *
 * El prompt no puede tener comillas invertidas: vive dentro de un literal de
 * plantilla de JavaScript (ver `verificar.mjs`).
 */

export const CAMBIOS_PROMPT = [
  {
    donde: "la lista de acciones permitidas",
    viejo: "ANULAR_COMPRA\nCORREGIR_COMPRA\n\nAcciones del negocio (ERP y CRM):",
    nuevo: "ANULAR_COMPRA\nCORREGIR_COMPRA\nENVIAR_WHATSAPP_CLIENTE\n\nAcciones del negocio (ERP y CRM):",
  },
  {
    donde: "la forma de datos de ENVIAR_WHATSAPP_CLIENTE",
    viejo: "  desde Negocio > Compras.\n\nGUARDAR_MEMORIA\n  datos:",
    nuevo: [
      "  desde Negocio > Compras.",
      "",
      "ENVIAR_WHATSAPP_CLIENTE",
      "  datos: { cliente, mensaje }",
      "  Le escribe a un CLIENTE por el WhatsApp de la empresa. \"Sí, escribile\",",
      "  \"mandáselo\", \"dale, envialo\". UN MENSAJE ENVIADO NO SE DESHACE.",
      "  Mandalo SOLO si la persona confirmó que quiere que se lo escribas Y el",
      "  texto es uno que ella ya vio (lo propusiste vos o lo dictó ella).",
      "  Si dice \"escribile a Marcos\" sin decir qué, NO mandes la acción: proponé",
      "  el mensaje en tu respuesta y preguntá si va. Recién cuando diga que sí,",
      "  mandala con ESE texto.",
      "  mensaje es lo que el cliente va a LEER: en nombre de la empresa, breve",
      "  (una a tres líneas), cordial y con un solo pedido claro.",
      "  NO inventes precios, fechas, descuentos ni promesas que la persona no",
      "  dijo. Si el texto los necesita y no los tenés, preguntá.",
      "  cliente es el nombre tal como está en los contactos.",
      "  Puede no salir: WhatsApp sólo deja escribir libre dentro de las 24 horas",
      "  de que el cliente escribió, y quien pidió la baja no recibe nada. El",
      "  sistema te dice qué pasó; contáselo tal cual, y NUNCA digas que se",
      "  envió si no lo confirmó.",
      "  No es para hablar con la persona: eso es tu respuesta.",
      "",
      "GUARDAR_MEMORIA",
      "  datos:",
    ].join("\n"),
  },
];

/** El código de `05 INT Respuesta`: la frase y el despacho. Igual, palabra por palabra, a `fraseDelEnvio` (TypeScript). */
export const CAMBIOS_WORKER = [
  {
    donde: "la frase del envío y el despacho",
    viejo: "function fraseDeAccion(accion, result) {\n  if (accion === 'CORREGIR_COMPRA') return fraseDeCorreccionCompra(result);",
    nuevo: [
      "/*",
      "  Lo que Meta contestó de verdad. NUNCA dice 'le escribí' si el mensaje no salió:",
      "  es el único verbo que habla con un tercero y no se deshace (v186).",
      "*/",
      "function conPuntoFinal(texto) {",
      "  const t = String(texto || '').trim();",
      "  return /[.!?\\u2026]$/.test(t) ? t : t + '.';",
      "}",
      "",
      "function fraseDeEnvioWhatsapp(result) {",
      "  const r = (result && result.resultado) || {};",
      "  const envio = r.envio || {};",
      "  const a = String(r.contacto_nombre || '').trim() || 'el cliente';",
      "  const motivo = envio.motivo ? conPuntoFinal(envio.motivo) : '';",
      "",
      "  if (envio.estado === 'enviado') return 'Listo, le escribí a ' + a + ' por WhatsApp.';",
      "  if (envio.estado === 'ya_enviado') return 'Ese mensaje a ' + a + ' ya estaba enviado; no lo repetí.';",
      "  if (envio.estado === 'bloqueado') {",
      "    return 'No le escribí a ' + a + '. ' + (motivo || 'La política de WhatsApp no lo permite ahora.');",
      "  }",
      "  if (envio.estado === 'pendiente_aprobacion') {",
      "    return ('Dejé el mensaje para ' + a + ' esperando tu aprobación en CRM > WhatsApp. ' + motivo).trim();",
      "  }",
      "  if (envio.estado === 'fallido') {",
      "    return ('No pude mandarle el mensaje a ' + a + '. ' + (motivo || 'Falló el envío.') +",
      "      (envio.reintentable ? ' Probá de nuevo en un rato.' : '')).trim();",
      "  }",
      "  if (envio.estado === 'invalido') {",
      "    return ('No pude mandarle el mensaje a ' + a + '. ' + (motivo || 'Faltaban datos.')).trim();",
      "  }",
      "",
      "  // Sin estado, o pendiente: NO se afirma nada.",
      "  return 'No pude confirmar que el mensaje a ' + a + ' saliera. Mirá en CRM > WhatsApp antes de reenviarlo, para no duplicarlo.';",
      "}",
      "",
      "function fraseDeAccion(accion, result) {",
      "  if (accion === 'ENVIAR_WHATSAPP_CLIENTE') return fraseDeEnvioWhatsapp(result);",
      "  if (accion === 'CORREGIR_COMPRA') return fraseDeCorreccionCompra(result);",
    ].join("\n"),
  },
];

export const CAMBIOS_05_GW = [
  {
    donde: "05 GW: la lista blanca",
    viejo: "    'ANULAR_COMPRA',\n    'CORREGIR_COMPRA'\n  ]);",
    nuevo: [
      "    'ANULAR_COMPRA',",
      "    'CORREGIR_COMPRA',",
      "",
      "    /*",
      "      Escribirle a un cliente por el WhatsApp de la empresa. El prompt lo condiciona",
      "      a una confirmación explícita; el ejecutor valida y el servidor envía. Ver v186.",
      "    */",
      "    'ENVIAR_WHATSAPP_CLIENTE'",
      "  ]);",
    ].join("\n"),
  },
];

export const CAMBIOS_06_GW = [
  {
    donde: "06 GW: la ruta",
    viejo: "  CORREGIR_COMPRA: 'eos-worker-rc1-internal'\n};",
    nuevo: "  CORREGIR_COMPRA: 'eos-worker-rc1-internal',\n  ENVIAR_WHATSAPP_CLIENTE: 'eos-worker-rc1-internal'\n};",
  },
];

export const CAMBIOS_01_INT = [
  {
    donde: "01 INT: la lista blanca",
    viejo: "  'ANULAR_COMPRA',\n  'CORREGIR_COMPRA'\n]);",
    nuevo: "  'ANULAR_COMPRA',\n  'CORREGIR_COMPRA',\n  'ENVIAR_WHATSAPP_CLIENTE'\n]);",
  },
];

function aplicar(texto, cambios, etiqueta, sinComillas = false) {
  let salida = texto;

  for (const c of cambios) {
    if (sinComillas && c.nuevo.includes("`")) {
      throw new Error(`[${etiqueta}] comilla invertida en "${c.donde}"`);
    }

    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(`[${etiqueta}] "${c.donde}": aparece ${partes.length - 1} veces, no 1. No se escribió nada.`);
    }
    salida = partes.join(c.nuevo);
  }

  return salida;
}

const YA = "ENVIAR_WHATSAPP_CLIENTE";

function noRepetir(texto, etiqueta) {
  if (texto.includes(YA)) throw new Error(`[${etiqueta}] ya conoce ${YA}. No se escribió nada.`);
}

export function aplicarPrompt(texto, etiqueta = "prompt") {
  noRepetir(texto, etiqueta);
  return aplicar(texto, CAMBIOS_PROMPT, etiqueta, true);
}

export function aplicarWorker(codigo, etiqueta = "05 INT") {
  noRepetir(codigo, etiqueta);
  return aplicar(codigo, CAMBIOS_WORKER, etiqueta);
}

export function aplicar05Gw(codigo, etiqueta = "05 GW") {
  noRepetir(codigo, etiqueta);
  return aplicar(codigo, CAMBIOS_05_GW, etiqueta);
}

export function aplicar06Gw(codigo, etiqueta = "06 GW") {
  noRepetir(codigo, etiqueta);
  return aplicar(codigo, CAMBIOS_06_GW, etiqueta);
}

export function aplicar01Int(codigo, etiqueta = "01 INT") {
  noRepetir(codigo, etiqueta);
  return aplicar(codigo, CAMBIOS_01_INT, etiqueta);
}
