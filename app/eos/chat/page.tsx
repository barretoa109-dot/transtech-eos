import { createClient } from "@/lib/supabase/server";

import ChatPage, { type DatosIniciales } from "./ChatPage";

/*
 * Esta pantalla se arma en el servidor para una sola cosa: saber quién es
 * antes de mandar el HTML.
 *
 * Antes la pantalla era de cliente de punta a punta y arrancaba sin nombre,
 * así que al abrir la app se veía un instante de carga (y antes de eso, un
 * "Usuario" de relleno) hasta que el navegador terminaba dos viajes a
 * Supabase: validar la sesión y leer la fila de `usuarios`.
 *
 * El primero de esos dos viajes ya se hacía igual, del lado del servidor: el
 * middleware (`proxy.ts`) valida la sesión en CADA visita a /eos/chat y manda
 * al login si no hay. Ese dato se tiraba. Acá se aprovecha, se le suma la
 * consulta del perfil, y el saludo sale escrito en el HTML: sin espera y sin
 * parpadeo, también en la primera apertura.
 *
 * Usar cookies() hace que la ruta se genere por pedido en vez de quedar
 * prerenderizada. Es el costo a cambio de eso, y en los hechos ya se
 * comportaba así por el middleware.
 */
export default async function Page() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  /*
   * Sin sesión no se redirige desde acá: de eso se encarga el middleware, y
   * el cliente tiene su propia red de contención. Se entrega en null y la
   * pantalla se resuelve sola, como antes de este cambio.
   */
  if (!user) return <ChatPage inicial={null} />;

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("nombre, plan, email")
    .eq("id", user.id)
    .maybeSingle();

  // El mismo orden de preferencia que usa `iniciarEOS` en el cliente.
  const inicial: DatosIniciales = {
    usuarioId: user.id,
    nombre: usuario?.nombre ?? user.user_metadata?.nombre ?? user.email?.split("@")[0] ?? "Usuario",
    plan: usuario?.plan ?? "free",
    email: usuario?.email ?? user.email ?? "",
    rubro: typeof user.user_metadata?.rubro === "string" ? user.user_metadata.rubro : null,
  };

  return <ChatPage inicial={inicial} />;
}
