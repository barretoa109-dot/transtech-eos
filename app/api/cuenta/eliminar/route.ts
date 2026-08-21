import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { DELETE as eliminarTarjetaBancard } from "@/app/api/pagos/bancard/tarjetas/[id]/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Borrado de cuenta.
 *
 * Apple y Google lo exigen para cualquier app con registro, pero el motivo
 * de fondo es anterior: la Ley 6534/2020 y el hecho de que alguien que se va
 * tiene derecho a llevarse sus datos.
 *
 * Es irreversible y no hay copia. Por eso se pide una confirmación escrita
 * explícita: un `DELETE` que se dispara con un clic mal dado destruye la vida
 * financiera de alguien.
 *
 * Orden deliberado:
 *   1. Tarjetas en Bancard — es el único dato que vive FUERA de nuestra base.
 *      Si se borrara primero lo local, perderíamos las referencias necesarias
 *      para pedirle a Bancard que elimine el token, y quedaría registrado ahí
 *      para siempre.
 *   2. Datos en nuestra base, vía RPC que recorre el catálogo.
 *   3. El usuario de auth, al final: mientras exista, el resto es recuperable
 *      por soporte; una vez que se va, no hay vuelta.
 */

const CONFIRMACION = "ELIMINAR MI CUENTA";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  }

  let body: { confirmacion?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  if (body.confirmacion !== CONFIRMACION) {
    return NextResponse.json(
      { error: `Para confirmar, escribí exactamente: ${CONFIRMACION}` },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- los tipos generados no cubren todas estas tablas
  const admin: any = createAdminClient();

  // ---- 1. Tarjetas en Bancard (best effort) ----------------------------
  //
  // Si Bancard falla no se aborta el borrado: dejar al usuario atrapado en
  // una cuenta que quiere cerrar porque un proveedor externo no responde
  // sería peor. Se registra para poder limpiarlo a mano.
  const tarjetasNoEliminadas: string[] = [];

  try {
    const { data: tarjetas } = await admin
      .from("eos_bancard_tarjetas_v51")
      .select("id")
      .eq("usuario_id", user.id)
      .eq("estado", "activa");

    for (const tarjeta of (tarjetas ?? []) as { id: string }[]) {
      try {
        const respuesta = await eliminarTarjetaBancard(request, {
          params: Promise.resolve({ id: tarjeta.id }),
        });
        if (!respuesta.ok) tarjetasNoEliminadas.push(tarjeta.id);
      } catch {
        tarjetasNoEliminadas.push(tarjeta.id);
      }
    }
  } catch (error) {
    console.error("Baja de cuenta: no se pudieron listar las tarjetas:", error);
  }

  if (tarjetasNoEliminadas.length > 0) {
    console.error(
      `Baja de cuenta ${user.id}: tarjetas que siguen registradas en Bancard:`,
      tarjetasNoEliminadas.join(", "),
    );
  }

  // ---- 2. Datos en nuestra base ---------------------------------------
  //
  // Se llama con el cliente del usuario, no con el admin: la función usa
  // auth.uid(), así que es imposible que borre la cuenta de otro.
  const { data: borrados, error: borradoError } = await supabase.rpc("eos_borrar_mis_datos_v55");

  if (borradoError) {
    console.error("Baja de cuenta: falló el borrado de datos:", borradoError);
    return NextResponse.json(
      {
        error:
          "No pudimos completar la baja. No se borró nada; escribinos y lo resolvemos a mano.",
      },
      { status: 500 },
    );
  }

  // ---- 3. El usuario de auth ------------------------------------------
  const { error: authDeleteError } = await admin.auth.admin.deleteUser(user.id);

  if (authDeleteError) {
    console.error("Baja de cuenta: datos borrados pero el usuario sigue:", authDeleteError);
    return NextResponse.json(
      {
        error:
          "Tus datos fueron eliminados, pero no pudimos cerrar el acceso. Escribinos para completarlo.",
      },
      { status: 500 },
    );
  }

  await supabase.auth.signOut();

  const filas = (borrados ?? []) as { tabla: string; filas_borradas: number }[];

  return NextResponse.json({
    ok: true,
    tablas_afectadas: filas.length,
    filas_borradas: filas.reduce((total, f) => total + Number(f.filas_borradas ?? 0), 0),
  });
}
