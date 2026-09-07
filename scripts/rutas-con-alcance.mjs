/**
 * Que ninguna ruta lea con `service_role` sin decir de quién son los datos.
 *
 *     npm run rutas
 *
 * ============================================================
 * POR QUÉ ESTE CANDADO Y NO OTRO
 * ============================================================
 *
 * `adminSinTipos()` y `createAdminClient()` devuelven un cliente con
 * `service_role`, que **no pasa por RLS**. Es deliberado y está documentado: la
 * lógica de negocio vive en funciones de Postgres y varias rutas necesitan
 * llamarlas. Pero tiene una consecuencia que no se ve mirando una ruta sola:
 *
 *   **el filtro que escribe cada ruta ES la seguridad.**
 *
 * Una policy olvidada la cubre otra policy. Un `.eq("usuario_id", …)` olvidado
 * no lo cubre nada: la consulta devuelve las filas de todos los usuarios, con
 * un 200 y sin un error en ningún log. Es la falla más probable de todo el
 * proyecto al agregar superficie nueva, y la única que no se nota probando.
 *
 * De los cinco candados que ya bloquean el CI —tests, evals, tipos, lint,
 * migraciones— ninguno mira esto. Este sí.
 *
 * ============================================================
 * QUÉ MIRA EXACTAMENTE
 * ============================================================
 *
 * Solo las consultas hechas CON el cliente de servicio, no todas las de un
 * archivo que además lo importa. La diferencia importa: media docena de rutas
 * usan el cliente de sesión para leer —donde la RLS sí protege— y el de
 * servicio únicamente para escribir en la bitácora de auditoría. Marcarlas
 * sería enseñar a ignorar el candado, que es peor que no tenerlo.
 *
 * Para cada `<cliente de servicio>.from("tabla")` se aísla ESA consulta —no la
 * sentencia entera, ver `consultaEn`— y se exige una forma de acotar:
 *
 *   · `filtroDeEmpresa(…)`, que es la forma canónica del proyecto
 *   · `.eq("usuario_id" | "empresa_id" | "user_id", …)` o su `.in(…)`
 *   · un filtro por cualquier columna cuyo VALOR salga de la sesión
 *   · `usuario_id` / `empresa_id` en la fila de un insert o update
 *
 * A las lecturas se les exige eso. A las escrituras, al menos algún filtro:
 * ver `esLectura` para por qué la vara es distinta y qué NO garantiza este
 * script.
 *
 * Se probó en rojo, que es la única prueba que vale para un guardián. Con el
 * filtro de empresa sacado de `app/api/erp/inventario`, falla señalando el
 * archivo, la línea y la tabla; con una ruta nueva sin filtro, también; y con
 * una excepción que ya no corresponde a ninguna consulta, avisa para sacarla.
 * Encontró de paso un agujero propio: la lista de columnas de un `.select(…)`
 * que incluye `usuario_id` no es un filtro, y hasta que se corrigió daba por
 * buenas tres consultas que no lo tenían.
 *
 * ============================================================
 * LAS EXCEPCIONES SE ESCRIBEN, NO SE INFIEREN
 * ============================================================
 *
 * Hay rutas que legítimamente miran las filas de todos: un cron que recorre
 * usuarios, un webhook que recibe una confirmación de pago con su propia
 * autenticación, un catálogo público sin datos de nadie.
 *
 * Cada una va abajo con el motivo escrito y a qué tabla aplica. Una lista de
 * excepciones sin motivos se vuelve, en seis meses, una lista de agujeros que
 * nadie se anima a tocar; con el motivo escrito, cualquiera puede leerla y
 * decidir si sigue siendo cierta.
 *
 * Y el script avisa cuando una excepción ya no coincide con nada: eso quiere
 * decir que la ruta cambió y que la excepción está tapando algo que ya no
 * existe, o algo que se movió.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = path.join(RAIZ, "app", "api");

/**
 * `"ruta::tabla"` → por qué esa consulta puede no acotar por usuario.
 *
 * La clave lleva la tabla y no solo el archivo: una ruta puede tener una
 * consulta global legítima y otra que sí tiene que filtrar, y eximir el
 * archivo entero taparía la segunda.
 */
const PERMITIDAS = new Map([
  [
    "app/api/admin/pagos/listar/route.ts::solicitudes_pago",
    "El panel de administración: existe para ver las solicitudes de TODOS, que es su función. La puerta es `ADMIN_EMAILS`, verificada en la misma ruta y antes de consultar.",
  ],
  [
    "app/api/cron/briefing-diario/route.ts::usuarios",
    "El cron recorre a todos los usuarios por definición: es lo que hace un cron. Su puerta es `CRON_SECRET`, no una sesión.",
  ],
  [
    "app/api/finanzas/correo/route.ts::eos_finanzas_buzon",
    "El correo entrante llega sin sesión. Esta consulta es justamente la que averigua DE QUIÉN es la casilla que recibió el mensaje, a partir del token secreto de esa casilla; filtrarla por un usuario que todavía no se conoce es imposible por definición.",
  ],
  [
    "app/api/modulos/catalogo/route.ts::eos_modulos",
    "El catálogo de módulos es la vitrina: nombres, precios y descripciones. Ningún dato de ninguna persona.",
  ],
  [
    "app/api/pagos/bancard/confirmacion/route.ts::solicitudes_pago",
    "Webhook de Bancard: lo llama Bancard, no un usuario logueado. Busca la solicitud por `referencia_externa`, que es el identificador que el propio proveedor devuelve, y así resuelve de quién es el pago.",
  ],
  [
    "app/api/pagos/pagopar/webhook/route.ts::solicitudes_pago",
    "Webhook de Pagopar, mismo criterio: la firma del proveedor se verifica antes (401 si no coincide) y el `hash_pedido` es lo que identifica la solicitud.",
  ],
  [
    "app/api/cron/bancard-renovaciones/route.ts::eos_usuario_modulos",
    "El cron busca los módulos que vencen hoy, de quien sean: recorrer a todos es lo que hace. Su puerta es `CRON_SECRET`, no una sesión.",
  ],
  [
    "app/api/cron/bancard-renovaciones/route.ts::eos_planes_armados",
    "Mismo cron y mismo motivo: los armados vigentes de todos, para saber a quién le corresponde renovar.",
  ],
  [
    "app/api/cron/briefing-diario/route.ts::eos_followup_preferences",
    "El cron del briefing pregunta quiénes lo quieren por correo. La respuesta es una lista de usuarios; filtrarla por uno no tendría sentido.",
  ],
  [
    "app/api/pagos/pagopar/webhook/route.ts::eventos_pago",
    "`eventos_pago` es la bitácora de eventos del proveedor, indexada por `evento_externo_id`, no una tabla por usuario. Y el que llama es Pagopar, no una sesión: la autenticación es la firma del proveedor.",
  ],
]);

function rutasDeApi(dir) {
  const salida = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...rutasDeApi(completo));
    else if (entrada.name === "route.ts") salida.push(completo);
  }
  return salida;
}

/** Los nombres a los que este archivo le asignó un cliente de servicio. */
function nombresDeServicio(texto) {
  const nombres = new Set();
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*(?:await\s+)?(?:adminSinTipos|createAdminClient)\s*\(/g;
  let m;
  while ((m = re.exec(texto))) nombres.add(m[1]);
  return nombres;
}

/**
 * El texto de UNA consulta, desde su `.from(` hasta donde termina.
 *
 * Hacia adelante y no la sentencia entera, que fue el primer intento y estaba
 * mal: media docena de rutas arman dos o tres consultas dentro del mismo
 * `Promise.all([...])`, y tomar la sentencia completa hacía que el filtro de
 * la primera tapara la falta de filtro de la segunda. Justo el caso que este
 * candado tiene que encontrar.
 *
 * Se corta en el `;` que cierra al mismo nivel o en el `.from(` siguiente, lo
 * que llegue antes.
 */
function consultaEn(texto, posicionDelMatch) {
  // El match puede empezar en el identificador (`admin` de `admin.from(`), así
  // que la ventana arranca en el `.from(` de verdad y no antes.
  const inicio = texto.indexOf(".from(", posicionDelMatch);
  if (inicio < 0) return "";

  let profundidad = 0;
  let fin = texto.length;

  for (let i = inicio; i < texto.length; i += 1) {
    const c = texto[i];
    if (c === "(" || c === "[" || c === "{") profundidad += 1;
    else if (c === ")" || c === "]" || c === "}") profundidad -= 1;
    else if (c === ";" && profundidad <= 0) {
      fin = i + 1;
      break;
    }
  }

  const siguiente = texto.indexOf(".from(", inicio + 6);
  return texto.slice(inicio, siguiente >= 0 && siguiente < fin ? siguiente : fin);
}

/**
 * Lo que hace que una consulta esté acotada.
 *
 * No alcanza con que haya un `.eq(...)`: lo que importa es que el valor venga
 * de la SESIÓN. Filtrar por `.eq("estado", "activo")` acota la consulta y no
 * acota al usuario, que es lo único que este candado cuida.
 */
const DE_LA_SESION = "(user\\.|usuarioId|usuario\\.id|uid\\b|empresaId|empresaActiva|puerta\\.usuarioId|session)";

const FORMAS_DE_ACOTAR = [
  // La forma canónica del proyecto.
  /filtroDeEmpresa\(/,
  // Un filtro por columna de pertenencia, con cualquier valor.
  /\.(eq|in)\(\s*["'`](usuario_id|empresa_id|user_id)["'`]/,
  // Un filtro por cualquier columna, pero con un valor que salió de la sesión.
  new RegExp("\\.(eq|in|match)\\([^)]*" + DE_LA_SESION),
  // Un insert o update que graba a nombre de alguien, incluso cuando la fila
  // la arma un helper: lo que importa es que el id del dueño esté ahí.
  /(usuario_id|empresa_id)\s*[:,]/,
  new RegExp("\\.(insert|upsert)\\([^;]*" + DE_LA_SESION),
];

/**
 * Qué operación es esta consulta.
 *
 * Importa porque el riesgo no es el mismo. Un `select` sin acotar DEVUELVE las
 * filas de todos: es una fuga, con 200 y sin error. Un `update` o un `delete`
 * sin acotar por usuario suele ser el patrón legítimo de "ya resolví la fila
 * con el filtro del dueño y ahora la toco por su id" — que este script no
 * puede distinguir de uno peligroso sin seguir el dato por el archivo.
 *
 * Entonces: a las lecturas se les exige el filtro del dueño; a las escrituras,
 * al menos ALGÚN filtro. Una escritura sin ninguna condición —un `.update({…})`
 * suelto, un `.delete()` pelado— toca la tabla entera y no tiene ningún uso
 * legítimo en una ruta de la aplicación.
 *
 * Queda dicho para que nadie le pida a este candado más de lo que hace: no
 * demuestra que un `update` por id sea del usuario correcto. Eso lo prueba
 * `certificacion/casos/12-aislamiento.mjs`, que corre contra la base real con
 * dos sesiones distintas.
 */
function esLectura(consulta) {
  return /\.select\(/.test(consulta) && !/\.(insert|upsert|update|delete)\(/.test(consulta);
}

function tieneAlgunFiltro(consulta) {
  return /\.(eq|in|match|neq|gt|gte|lt|lte|like|ilike|is|contains|filter)\(/.test(consulta);
}

/**
 * La consulta sin la lista de columnas del `.select(...)`.
 *
 * Sin esto el candado tenía un agujero, y lo tuvo hasta que se lo probó en
 * rojo: `app/api/admin/pagos/listar` lee `solicitudes_pago` SIN filtrar por
 * nadie —a propósito, es el panel de administración— y el script la daba por
 * buena. El motivo era que la lista de columnas incluye `usuario_id,`, y el
 * patrón que busca `usuario_id:` o `usuario_id,` para reconocer un insert lo
 * encontraba ahí.
 *
 * Pedir una columna llamada `usuario_id` no acota nada. Se saca del texto
 * antes de mirar.
 */
function sinListaDeColumnas(consulta) {
  return consulta.replace(/\.select\(\s*(["'`])(?:\\.|(?!\1)[\s\S])*\1/g, ".select(");
}

const problemas = [];
const permitidasVistas = new Set();

for (const archivo of rutasDeApi(BASE).sort()) {
  const relativo = path.relative(RAIZ, archivo).split(path.sep).join("/");
  const texto = fs.readFileSync(archivo, "utf8");

  const nombres = nombresDeServicio(texto);

  const patrones = [...nombres].map(
    (n) => new RegExp("\\b" + n + "\\s*\\n?\\s*\\.from\\(", "g"),
  );
  patrones.push(/(?:adminSinTipos|createAdminClient)\s*\(\s*\)\s*(?:as\s+never\s*)?\n?\s*\.from\(/g);

  for (const patron of patrones) {
    let m;
    while ((m = patron.exec(texto))) {
      const frag = consultaEn(texto, m.index);
      const tabla = (frag.match(/\.from\(\s*["'`]([^"'`]+)/) ?? [])[1] ?? "?";
      const clave = `${relativo}::${tabla}`;

      const limpio = sinListaDeColumnas(frag);

      if (FORMAS_DE_ACOTAR.some((re) => re.test(limpio))) continue;

      // Una escritura con algún filtro es el patrón de "la fila ya la resolví
      // con el filtro del dueño y ahora la toco por su id". Ver `esLectura`.
      if (!esLectura(limpio) && tieneAlgunFiltro(limpio)) continue;

      /*
       * La excepción se consulta DESPUÉS de decidir, no antes.
       *
       * Así "excepción sin uso" significa lo que dice: esa consulta ya no
       * necesita el permiso. Si se preguntara primero, una consulta que
       * alguien arregló seguiría manteniendo viva su excepción, y la lista
       * envejecería sin que nadie se entere.
       */
      if (PERMITIDAS.has(clave)) {
        permitidasVistas.add(clave);
        continue;
      }

      problemas.push({
        clave,
        linea: texto.slice(0, m.index).split("\n").length,
        que: esLectura(limpio) ? "lectura sin filtro del dueño" : "escritura sin ninguna condición",
      });
    }
  }
}

const huerfanas = [...PERMITIDAS.keys()].filter((k) => !permitidasVistas.has(k));

if (problemas.length === 0 && huerfanas.length === 0) {
  console.log("Rutas con alcance: ninguna consulta de service_role sin decir de quién son los datos.");
  process.exit(0);
}

for (const p of problemas) {
  console.error(`  ${p.clave.split("::")[0]}:${p.linea}  tabla ${p.clave.split("::")[1]} — ${p.que}`);
}

if (problemas.length > 0) {
  console.error(
    `\n${problemas.length} consulta(s) con el cliente de servicio y sin acotar por usuario o empresa.\n` +
      "`service_role` NO pasa por RLS: sin ese filtro, la consulta devuelve las filas\n" +
      "de todos los usuarios, con un 200 y sin un solo error en el log.\n\n" +
      "Agregá `.eq(\"usuario_id\", …)`, `filtroDeEmpresa(…)` o el filtro que\n" +
      "corresponda — o, si la ruta MIRA A TODOS a propósito (un cron, un webhook),\n" +
      "agregala a PERMITIDAS en este archivo con el motivo escrito.",
  );
}

for (const h of huerfanas) {
  console.error(
    `\n  excepción sin uso: "${h}"\n` +
      "  Esa consulta ya no está donde decía. Revisá si la ruta cambió y sacá o\n" +
      "  corregí la excepción: una que no coincide con nada puede estar tapando\n" +
      "  otra que sí necesita mirarse.",
  );
}

process.exit(1);
