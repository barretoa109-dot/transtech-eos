import type { Metadata } from "next";
import PaginaLegal, { Lista, Seccion } from "@/components/legal/PaginaLegal";

export const metadata: Metadata = {
  title: "Política de privacidad · TransTech EOS",
  description:
    "Qué datos recoge TransTech EOS, para qué los usa, con quién los comparte y cómo ejercer tus derechos.",
};

const li = { marginBottom: 7 };

export default function PrivacidadPage() {
  return (
    <PaginaLegal titulo="Política de privacidad" actualizado="30 de septiembre de 2026">
      <p>
        TransTech EOS es un sistema operativo ejecutivo que organiza tu información de trabajo y
        tus finanzas. Para hacerlo necesita datos tuyos. Este documento explica exactamente cuáles,
        para qué, con quién se comparten y cómo pedir que se borren.
      </p>

      <Seccion titulo="Quién es responsable de tus datos">
        <p>
          TransTech, con domicilio en Paraguay, es el responsable del tratamiento. Podés contactarnos
          en <a href="mailto:soporte@transtech.com.py" style={{ color: "#2563eb" }}>soporte@transtech.com.py</a>.
        </p>
      </Seccion>

      <Seccion titulo="Qué datos recogemos">
        <Lista>
          <li style={li}>
            <strong>De tu cuenta:</strong> nombre, correo electrónico y contraseña, y tu número de
            WhatsApp si lo vinculás. La contraseña se guarda cifrada; nadie de TransTech puede verla.
          </li>
          <li style={li}>
            <strong>Lo que le mandás a EOS:</strong> tus conversaciones, por la aplicación o por
            WhatsApp, y las fotos, audios, videos y documentos que le enviás, junto con lo que se
            extrae de ellos (la transcripción de un audio, lo que dice una foto o un documento).
            Las fotos y los documentos se guardan para que los veas en tu historial.
          </li>
          <li style={li}>
            <strong>Tu información de trabajo:</strong> objetivos, tareas, decisiones, memorias y
            aprendizajes que EOS registra a partir de lo que le contás.
          </li>
          <li style={li}>
            <strong>Tu negocio:</strong> ventas, compras, productos y stock, cobros y pagos, y los
            datos de tus clientes y proveedores que cargás (nombre, teléfono, RUC). Si conectás el
            WhatsApp de tu empresa, también los mensajes que tus clientes le escriben a ese número.
            Esos datos son de otras personas: los tratamos por cuenta tuya y solo para prestarte el
            servicio, y es tu responsabilidad poder cargarlos.
          </li>
          <li style={li}>
            <strong>Tu información financiera:</strong> las reglas que definís (saldo inicial,
            reserva mínima, porcentaje de ahorro) y los movimientos —ingresos, gastos y
            compromisos— que cargás o que EOS detecta.
          </li>
          <li style={li}>
            <strong>Avisos bancarios que nos reenviás:</strong> si activás la ingesta por correo, EOS
            lee esos avisos para extraer el importe, la fecha y el concepto. <strong>No guardamos el
            cuerpo del correo</strong>: solo el movimiento extraído y datos mínimos (remitente,
            asunto y fecha) para no procesar dos veces el mismo aviso.
          </li>
          <li style={li}>
            <strong>Pagos:</strong> el historial de tus suscripciones. <strong>Nunca vemos ni
            almacenamos el número de tu tarjeta</strong>: lo procesa Bancard y a nosotros solo nos
            llega una referencia que no sirve fuera de esa plataforma. Si pagás por transferencia,
            el comprobante que subís.
          </li>
          <li style={li}>
            <strong>Uso del servicio:</strong> cantidad de mensajes y lo que cuesta procesarlos,
            para aplicar tu plan. Para frenar abusos contamos pedidos por dirección IP, pero{" "}
            <strong>no guardamos tu IP</strong>: solo una huella que no permite saber cuál era.
          </li>
          <li style={li}>
            <strong>Notificaciones:</strong> si las activás, el identificador que tu navegador o tu
            teléfono le da a EOS para poder enviarte avisos.
          </li>
        </Lista>
      </Seccion>

      <Seccion titulo="Para qué los usamos">
        <Lista>
          <li style={li}>Prestarte el servicio que contrataste y que EOS pueda responderte con contexto.</li>
          <li style={li}>Calcular tu disponible real y anticipar compromisos que se repiten.</li>
          <li style={li}>Enviarte tu briefing diario, solo si lo activaste.</li>
          <li style={li}>
            Enviarte correos de ayuda en tus primeros días y un consejo cada tres días. Cada uno trae
            un enlace para darte de baja.
          </li>
          <li style={li}>Cobrar tu suscripción y gestionar renovaciones.</li>
          <li style={li}>Mantener el servicio seguro y detectar abusos.</li>
        </Lista>
        <p>
          No vendemos tus datos, no los cedemos a anunciantes y no los usamos para entrenar modelos
          de inteligencia artificial propios ni de terceros.
        </p>
      </Seccion>

      <Seccion titulo="Con quién los compartimos">
        <p>
          Solo con proveedores que necesitamos para que el servicio funcione. Cada uno accede
          únicamente a lo imprescindible:
        </p>
        <Lista>
          <li style={li}><strong>Supabase</strong> — base de datos y autenticación (Estados Unidos).</li>
          <li style={li}><strong>Vercel</strong> — alojamiento de la aplicación.</li>
          <li style={li}><strong>Resend</strong> — envío y recepción de correos, incluidos los avisos bancarios que reenviás (São Paulo, Brasil).</li>
          <li style={li}><strong>OpenAI</strong> — procesa tus mensajes, fotos, audios y videos para responderte, transcribirlos y leerlos (Estados Unidos). Según sus condiciones para empresas, no usa esos datos para entrenar sus modelos y los retiene hasta 30 días para controlar abusos.</li>
          <li style={li}><strong>Meta (WhatsApp)</strong> — los mensajes que intercambiás con EOS por WhatsApp, y los del WhatsApp de tu empresa si lo conectás.</li>
          <li style={li}><strong>Railway</strong> — orquestación de los procesos internos de EOS.</li>
          <li style={li}><strong>GitHub</strong> — guarda las copias de seguridad de la base, cifradas, que se borran solas a los 14 días.</li>
          <li style={li}><strong>Cloudflare y Google</strong> — reciben los correos que nos escribís a nuestras direcciones @transtech.com.py.</li>
          <li style={li}><strong>Servicios de notificaciones</strong> de tu navegador o tu teléfono (Google, Apple, Mozilla) — solo el aviso, si activás las notificaciones.</li>
          <li style={li}><strong>Bancard</strong> — procesamiento de pagos con tarjeta (Paraguay).</li>
        </Lista>
        <p>
          Algunos de estos proveedores están fuera de Paraguay, así que tus datos se transfieren y
          procesan en el exterior. Al usar EOS aceptás esa transferencia.
        </p>
      </Seccion>

      <Seccion titulo="Cuánto tiempo los guardamos">
        <p>
          Mientras tu cuenta esté activa. Si la eliminás, tus datos y tus archivos (fotos y
          documentos) se borran de forma inmediata e irreversible. Conservamos únicamente los
          registros de facturación que la ley nos obliga a mantener —incluidos los comprobantes de
          transferencia que subiste para pagar—, sin el contenido de tus conversaciones ni de tus
          documentos.
        </p>
        <p>
          Las copias de seguridad de la base están cifradas y se borran solas a los 14 días: si
          eliminás tu cuenta, tus datos desaparecen también de ellas, a más tardar en ese plazo.
        </p>
        <p>
          Los correos que recibimos en tu buzón de ingesta se guardan hasta 30 días en Resend, que
          es su plazo de retención, y después se eliminan solos.
        </p>
      </Seccion>

      <Seccion titulo="Tus derechos">
        <p>Podés ejercerlos vos mismo, sin pedirnos permiso ni esperar respuesta:</p>
        <Lista>
          <li style={li}>
            <strong>Acceder y llevarte tus datos:</strong> desde tu perfil podés descargar un archivo
            con todo lo que tenemos sobre vos.
          </li>
          <li style={li}>
            <strong>Eliminar tu cuenta:</strong> también desde tu perfil. Se borra todo, incluida la
            referencia de tu tarjeta en Bancard.
          </li>
          <li style={li}>
            <strong>Corregir tus datos:</strong> podés editarlos desde la aplicación o escribirnos.
          </li>
          <li style={li}>
            <strong>Dejar de recibir correos:</strong> el briefing diario, que solo recibís si lo
            activás, y los avisos importantes —cuando algo puede afectar tu plata o tu negocio, como
            un pago que no te alcanza o un producto que se acaba, que te llegan sin que los
            actives— se desactivan cada uno con un clic desde la pantalla de Briefing de la propia
            aplicación. Los correos de ayuda y los consejos, con el enlace de baja que trae cada uno.
          </li>
        </Lista>
      </Seccion>

      <Seccion titulo="Seguridad">
        <p>
          Cada usuario solo puede acceder a sus propios datos, y eso se aplica en la base de datos
          misma, no solo en la aplicación. Las conexiones van cifradas. Al registrarte verificamos
          que tu contraseña no figure en filtraciones públicas conocidas, sin que tu contraseña
          salga nunca de tu navegador.
        </p>
        <p>
          Ningún sistema es infalible. Si ocurriera una brecha que afecte tus datos, te lo
          comunicaremos.
        </p>
      </Seccion>

      <Seccion titulo="Menores de edad">
        <p>EOS no está dirigido a menores de 18 años y no recogemos datos de ellos a sabiendas.</p>
      </Seccion>

      <Seccion titulo="Cambios">
        <p>
          Si modificamos esta política, actualizamos la fecha del encabezado. Si el cambio afecta de
          forma significativa cómo tratamos tus datos, te avisamos por correo antes de aplicarlo.
        </p>
      </Seccion>
    </PaginaLegal>
  );
}
