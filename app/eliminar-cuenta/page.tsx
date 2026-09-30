import type { Metadata } from "next";
import PaginaLegal, { Lista, Seccion } from "@/components/legal/PaginaLegal";

/**
 * Cómo eliminar la cuenta, en una página pública.
 *
 * Google Play exige, para cualquier app con registro, una URL donde se pueda
 * pedir el borrado de la cuenta SIN tener la app instalada, y va en la ficha
 * de la tienda. El botón existe desde hace tiempo en el Perfil
 * (`EliminarCuenta.tsx` → `/api/cuenta/eliminar`); esta página explica cómo
 * llegar a él y qué hacer si alguien ya no puede entrar. Lo que dice sobre qué
 * se borra y qué se conserva tiene que coincidir con /privacidad.
 */
export const metadata: Metadata = {
  title: "Eliminar tu cuenta · TransTech EOS",
  description: "Cómo eliminar tu cuenta de TransTech EOS y qué pasa con tus datos.",
};

const li = { marginBottom: 7 };
const enlace = { color: "#2563eb" };

export default function EliminarCuentaPage() {
  return (
    <PaginaLegal titulo="Eliminar tu cuenta" actualizado="30 de septiembre de 2026">
      <p>
        Podés eliminar tu cuenta de TransTech EOS cuando quieras, vos mismo y sin pedirnos permiso.
        Es inmediato e irreversible.
      </p>

      <Seccion titulo="Desde la aplicación o la web">
        <Lista>
          <li style={li}>
            Iniciá sesión y entrá a tu{" "}
            <a href="/eos/chat?vista=perfil" style={enlace}>
              Perfil
            </a>{" "}
            (tu nombre, al pie de la barra lateral).
          </li>
          <li style={li}>
            Si querés quedarte con tu información, primero tocá <strong>Descargar mis datos</strong>.
          </li>
          <li style={li}>
            Tocá <strong>Eliminar mi cuenta</strong>, escribí <strong>ELIMINAR MI CUENTA</strong> para
            confirmar y tocá <strong>Eliminar definitivamente</strong>.
          </li>
        </Lista>
      </Seccion>

      <Seccion titulo="Si ya no podés entrar">
        <p>
          Escribinos a{" "}
          <a href="mailto:soporte@transtech.com.py?subject=Eliminar%20mi%20cuenta" style={enlace}>
            soporte@transtech.com.py
          </a>{" "}
          desde el correo con el que te registraste, con el asunto «Eliminar mi cuenta». La
          eliminamos a mano y te confirmamos por correo.
        </p>
      </Seccion>

      <Seccion titulo="Qué se borra">
        <p>
          Todo: tus conversaciones, tu información de trabajo, de tu negocio y de tus finanzas, las
          fotos y los documentos que subiste, tu número de WhatsApp vinculado y la referencia de tu
          tarjeta en Bancard.
        </p>
      </Seccion>

      <Seccion titulo="Qué se conserva">
        <p>
          Solo los registros de facturación que la ley nos obliga a mantener, incluidos los
          comprobantes de transferencia que subiste para pagar, sin el contenido de tus
          conversaciones ni de tus documentos. Las copias de seguridad de la base están cifradas y
          se borran solas a los 14 días, así que tus datos desaparecen también de ellas a más tardar
          en ese plazo. El detalle está en la{" "}
          <a href="/privacidad" style={enlace}>
            política de privacidad
          </a>
          .
        </p>
      </Seccion>
    </PaginaLegal>
  );
}
