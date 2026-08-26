import { NextResponse } from "next/server";

import { createAdminClient } from "../supabase-admin";
import { createClient } from "../supabase/server";
import { esCodigoModulo, nombreModulo, type CodigoModulo, type ModuloActivo } from "./catalogo.ts";

/**
 * La puerta de los anexos.
 *
 * TODA ruta que sirva algo de un módulo tiene que pasar por acá. No es una
 * recomendación de estilo: si el chequeo se copia y pega en cada endpoint,
 * el día que cambie la regla —una prueba gratis, un período de gracia al
 * vencer— va a quedar corregida en cuatro lugares y olvidada en el quinto, y
 * el quinto va a ser el que sirva datos a quien ya no pagó.
 *
 * La decisión misma vive en la base (`eos_tiene_modulo`), no acá: un cron y
 * la app tienen que responder igual, y dos implementaciones de la misma regla
 * en dos lenguajes distintos se desincronizan siempre.
 */

export type Acceso =
  | { permitido: true; usuarioId: string }
  | { permitido: false; motivo: "sin-sesion" | "sin-modulo" };

/**
 * ¿Puede este usuario usar este módulo, ahora?
 *
 * Contesta con la sesión incluida para que quien llama no tenga que volver a
 * pedir el usuario: dos llamadas a `getUser()` en la misma request son dos
 * viajes, y la segunda invita a usar un id que vino de otro lado.
 */
export async function verificarModulo(codigo: CodigoModulo): Promise<Acceso> {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return { permitido: false, motivo: "sin-sesion" };

  // `eos_tengo_modulo` y no `eos_tiene_modulo`: la variante con uuid es
  // `security definer` y solo la puede llamar el servidor, justamente para que
  // nadie pregunte por la cuenta de otro. Esta toma el usuario de la sesión.
  const { data, error: rpcError } = await supabase.rpc("eos_tengo_modulo", {
    p_modulo: codigo,
  });

  // Ante un error de lectura se NIEGA el acceso.
  //
  // Es la decisión incómoda pero correcta: si la base no contesta, no se sabe
  // si el usuario tiene el módulo, y "no sé" tiene que resolverse del lado de
  // no entregar. Abrir la puerta ante un fallo transitorio convierte cada
  // hipo de la base en acceso gratis a lo que se vende.
  if (rpcError) {
    console.error(`Módulos: no se pudo verificar "${codigo}":`, rpcError);
    return { permitido: false, motivo: "sin-modulo" };
  }

  if (data === true) return { permitido: true, usuarioId: user.id };

  /*
   * Lo que todavía no se vende, no se cobra.
   *
   * Si el módulo no está en el catálogo —porque la migración que lo siembra no
   * corrió todavía, o porque se lo retiró— negar el acceso apagaría una función
   * que nadie tuvo oportunidad de contratar. Sería el peor momento posible para
   * hacerlo: justo después de un deploy, y a todos a la vez.
   *
   * La consulta extra solo ocurre en el camino de NEGAR, que una vez sembrado
   * el catálogo es el caso raro. En el camino feliz sigue siendo una sola.
   */
  // Con el cliente de servicio y no con el del usuario: la política de RLS solo
  // muestra los módulos públicos, así que un módulo interno —que existe y está
  // gateado a propósito— parecería inexistente y se abriría para todos.
  const { data: enCatalogo, error: catalogoError } = await createAdminClient()
    .from("eos_modulos")
    .select("codigo")
    .eq("codigo", codigo)
    .maybeSingle();

  // Otra vez: ante un error de lectura se niega. No saber se resuelve del lado
  // de no entregar.
  if (!catalogoError && !enCatalogo) {
    return { permitido: true, usuarioId: user.id };
  }

  return { permitido: false, motivo: "sin-modulo" };
}

/**
 * Igual que `verificarModulo`, pero devuelve la respuesta HTTP ya armada
 * cuando no se puede pasar. Pensado para el arranque de un route handler:
 *
 *     const puerta = await exigirModulo("erp");
 *     if (puerta.respuesta) return puerta.respuesta;
 *     // acá `puerta.usuarioId` existe y el módulo está vigente
 */
export async function exigirModulo(
  codigo: CodigoModulo,
): Promise<{ respuesta: NextResponse; usuarioId?: undefined } | { respuesta?: undefined; usuarioId: string }> {
  const acceso = await verificarModulo(codigo);

  if (acceso.permitido) return { usuarioId: acceso.usuarioId };

  const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

  if (acceso.motivo === "sin-sesion") {
    return {
      respuesta: NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers }),
    };
  }

  // 403 y no 402 ("Payment Required"): 402 nunca se estandarizó y varios
  // proxies y clientes lo tratan de formas raras. El motivo va en el cuerpo,
  // que es donde la interfaz lo puede leer y decir en castellano.
  return {
    respuesta: NextResponse.json(
      {
        error: `El módulo ${nombreModulo(codigo)} no está activo en tu cuenta.`,
        modulo: codigo,
        motivo: "sin-modulo",
      },
      { status: 403, headers },
    ),
  };
}

/**
 * Los módulos vigentes del usuario, para pintar la interfaz.
 *
 * Una sola consulta en vez de una por módulo: con dos anexos la diferencia no
 * se nota, con seis sí, y la pantalla de cuenta los va a listar todos.
 */
export async function modulosDelUsuario(): Promise<ModuloActivo[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data, error } = await supabase.rpc("eos_mis_modulos");

  if (error) {
    console.error("Módulos: no se pudo leer la lista del usuario:", error);
    return [];
  }

  return ((data ?? []) as Record<string, unknown>[]).map((m) => ({
    codigo: String(m.codigo),
    nombre: String(m.nombre ?? nombreModulo(String(m.codigo))),
    estado: String(m.estado),
    vencimiento: (m.vencimiento as string | null) ?? null,
    origen: String(m.origen),
  }));
}

/**
 * Convierte lo que llegó por la URL en un código de módulo válido.
 *
 * Devuelve `null` en vez de tirar: un código inventado en un query param es
 * entrada del usuario, no un error del programa.
 */
export function leerCodigo(valor: string | null): CodigoModulo | null {
  const limpio = (valor ?? "").trim().toLowerCase();
  return esCodigoModulo(limpio) ? limpio : null;
}
