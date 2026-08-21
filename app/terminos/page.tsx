import type { Metadata } from "next";
import PaginaLegal, { Lista, Seccion } from "@/components/legal/PaginaLegal";

export const metadata: Metadata = {
  title: "Términos del servicio · TransTech EOS",
  description:
    "Condiciones de uso de TransTech EOS: cuenta, planes y pagos, límites de responsabilidad y cancelación.",
};

const li = { marginBottom: 7 };

export default function TerminosPage() {
  return (
    <PaginaLegal titulo="Términos del servicio" actualizado="21 de agosto de 2026">
      <p>
        Estos términos regulan el uso de TransTech EOS. Al crear una cuenta, los aceptás. Están
        escritos para que se entiendan; si algo no queda claro, escribinos antes de aceptar.
      </p>

      <Seccion titulo="Qué es EOS">
        <p>
          EOS es un asistente que organiza tu información de trabajo y tus finanzas: registra
          objetivos y decisiones, lee los documentos que le das, calcula tu disponible real y te
          envía un resumen diario. Es una herramienta de organización, no un banco ni una entidad
          financiera.
        </p>
      </Seccion>

      <Seccion titulo="Tu cuenta">
        <Lista>
          <li style={li}>Necesitás ser mayor de 18 años y dar datos verdaderos.</li>
          <li style={li}>Sos responsable de lo que pase con tu cuenta y de mantener tu contraseña a salvo.</li>
          <li style={li}>Una cuenta es de una persona. No la compartas.</li>
          <li style={li}>Si detectás un acceso que no reconocés, avisanos cuanto antes.</li>
        </Lista>
      </Seccion>

      <Seccion titulo="Planes y pagos">
        <Lista>
          <li style={li}>
            Hay un plan gratuito con límites de uso y planes pagos con límites mayores. Los precios
            vigentes están en la página de planes.
          </li>
          <li style={li}>
            Los pagos con tarjeta se procesan a través de Bancard. Nosotros no vemos ni guardamos el
            número de tu tarjeta.
          </li>
          <li style={li}>
            <strong>Las suscripciones se renuevan automáticamente</strong> al vencer, con la tarjeta
            que hayas dejado registrada, hasta que las canceles.
          </li>
          <li style={li}>
            Podés cancelar cuando quieras. La cancelación evita el siguiente cobro; seguís usando el
            plan hasta que termine el período que ya pagaste.
          </li>
          <li style={li}>
            Si un cobro falla, podemos suspender el acceso a las funciones pagas hasta regularizarlo.
          </li>
          <li style={li}>
            Si cambiamos los precios, te avisamos antes de que se aplique a tu próxima renovación.
          </li>
        </Lista>
      </Seccion>

      <Seccion titulo="Uso aceptable">
        <p>No podés usar EOS para:</p>
        <Lista>
          <li style={li}>Actividades ilegales, ni para cargar datos obtenidos de forma ilícita.</li>
          <li style={li}>Subir información de terceros sin derecho a hacerlo.</li>
          <li style={li}>Intentar vulnerar el servicio, acceder a datos de otros usuarios o eludir los límites de tu plan.</li>
          <li style={li}>Revender el servicio o automatizar su uso masivo sin nuestro acuerdo.</li>
        </Lista>
      </Seccion>

      <Seccion titulo="EOS puede equivocarse">
        <p>
          Esto es lo más importante de este documento. EOS usa inteligencia artificial y{" "}
          <strong>puede cometer errores</strong>: leer mal un importe, interpretar mal un documento o
          sacar una conclusión equivocada.
        </p>
        <Lista>
          <li style={li}>
            Los números que muestra —incluido tu disponible real— son una <strong>estimación
            basada en la información disponible</strong>, no un estado de cuenta. Ante cualquier
            diferencia, lo que vale es lo que dice tu banco.
          </li>
          <li style={li}>
            EOS <strong>no brinda asesoramiento financiero, contable, legal ni impositivo</strong>.
            Sus sugerencias no reemplazan a un profesional matriculado.
          </li>
          <li style={li}>
            Las decisiones que tomes son tuyas. Verificá la información importante antes de actuar.
          </li>
        </Lista>
      </Seccion>

      <Seccion titulo="Tu contenido es tuyo">
        <p>
          Todo lo que subís o escribís sigue siendo tuyo. Nos das permiso para procesarlo con el
          único fin de prestarte el servicio. No lo usamos para entrenar modelos ni lo compartimos
          con terceros más allá de los proveedores necesarios, que están detallados en la{" "}
          <a href="/privacidad" style={{ color: "#2563eb" }}>política de privacidad</a>.
        </p>
        <p>
          El software, la marca y el diseño de EOS son de TransTech y no se transfieren con tu
          suscripción.
        </p>
      </Seccion>

      <Seccion titulo="Disponibilidad">
        <p>
          Hacemos lo posible por mantener EOS funcionando, pero no garantizamos disponibilidad
          ininterrumpida. Puede haber cortes por mantenimiento, fallas propias o de nuestros
          proveedores. Podemos cambiar o discontinuar funciones; si el cambio es significativo,
          avisamos con antelación razonable.
        </p>
      </Seccion>

      <Seccion titulo="Límite de responsabilidad">
        <p>
          En la medida en que la ley lo permita, nuestra responsabilidad total frente a vos se
          limita a lo que hayas pagado por el servicio en los últimos doce meses. No respondemos por
          lucro cesante ni por daños indirectos derivados de decisiones tomadas a partir de la
          información que muestra EOS.
        </p>
      </Seccion>

      <Seccion titulo="Terminación">
        <p>
          Podés eliminar tu cuenta cuando quieras desde tu perfil; el borrado es inmediato e
          irreversible. Podemos suspender o cerrar una cuenta que incumpla estos términos,
          avisándote salvo que la gravedad lo impida.
        </p>
      </Seccion>

      <Seccion titulo="Ley aplicable">
        <p>
          Estos términos se rigen por las leyes de la República del Paraguay, y cualquier disputa se
          somete a los tribunales de la ciudad de Asunción.
        </p>
      </Seccion>

      <Seccion titulo="Cambios">
        <p>
          Si actualizamos estos términos, cambiamos la fecha del encabezado. Si el cambio es
          relevante, te avisamos por correo. Seguir usando EOS después implica aceptarlos.
        </p>
      </Seccion>
    </PaginaLegal>
  );
}
