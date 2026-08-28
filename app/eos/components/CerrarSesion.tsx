"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Salir de la cuenta.
 *
 * Faltaba: se podía entrar a EOS pero no salir, y la única forma de cambiar de
 * cuenta —o de dejar la sesión cerrada en una computadora prestada— era borrar
 * las cookies a mano.
 *
 * ============================================================
 * SIN FRICCIÓN, A DIFERENCIA DE ELIMINAR LA CUENTA
 * ============================================================
 *
 * Cerrar sesión es reversible: se vuelve a entrar y está todo. Pedir
 * confirmación para algo que se deshace escribiendo la contraseña otra vez
 * sería tratar al usuario como si no supiera lo que hace.
 *
 * Por eso va con su propio ícono y su propio color, lejos del rojo. Lo
 * importante es que no se confunda con el botón de al lado, que sí destruye
 * todo y no se deshace.
 *
 * ============================================================
 * POR QUÉ replace Y NO push
 * ============================================================
 *
 * Con `push`, el botón "atrás" del navegador devuelve a la pantalla de EOS
 * —vacía, porque ya no hay sesión— y parece que algo se rompió. `replace` saca
 * esa página del historial: atrás lleva a donde estaba antes de entrar, que es
 * lo que espera quien cierra sesión.
 *
 * El `refresh` es el que tira el caché del servidor. Sin él, los componentes
 * de servidor siguen sirviendo lo que habían renderizado con la sesión vieja.
 */
export default function CerrarSesion() {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function salir() {
    if (saliendo) return;

    setSaliendo(true);

    try {
      await createClient().auth.signOut();
    } catch (error) {
      /*
       * Si la llamada falla igual se sale.
       *
       * `signOut` sirve para invalidar el token del lado del servidor, pero lo
       * que mantiene la sesión en este navegador son las cookies, y esas ya se
       * limpian. Quedarse adentro porque la red falló sería lo contrario de lo
       * que la persona pidió, y quien aprieta esto puede estar en una máquina
       * que no es suya.
       */
      console.error("No se pudo cerrar sesión limpiamente:", error);
    }

    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={salir}
      disabled={saliendo}
      className="cerrar-sesion-btn"
    >
      <LogOut size={15} />
      {saliendo ? "Cerrando sesión…" : "Cerrar sesión"}
    </button>
  );
}
