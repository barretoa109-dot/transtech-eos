export const dynamic = "force-dynamic";

/**
 * Diagnóstico TEMPORAL: qué variables de entorno ve realmente el runtime.
 *
 * Existe porque `RESEND_API_KEY` seguía sin llegar a producción después de
 * cargarla y redeployar, y desde afuera no había forma de distinguir un typo
 * en el nombre de un environment equivocado. Adivinar costó varias vueltas.
 *
 * Devuelve NOMBRES, nunca valores, y solo de las variables que nos interesan.
 * Igual va protegido con CRON_SECRET: la lista de nombres le dice a un
 * atacante qué integraciones existen, y eso no es gratis.
 *
 * BORRAR cuando el buzón esté funcionando.
 */
export async function GET(request: Request) {
  const secreto = process.env.CRON_SECRET;
  const enviado = request.headers.get("x-eos-diagnostico");

  if (!secreto || enviado !== secreto) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }

  const interesan = /^(RESEND|EOS_CORREO|VERCEL_ENV)/;

  return Response.json({
    entorno: process.env.VERCEL_ENV ?? null,
    // Nombres nada más. Si hay un typo tipo RESEND_APIKEY, aparece acá.
    nombres_visibles: Object.keys(process.env).filter((k) => interesan.test(k)).sort(),
    presencia: {
      RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY),
      RESEND_WEBHOOK_SECRET: Boolean(process.env.RESEND_WEBHOOK_SECRET),
      EOS_CORREO_DOMINIO: Boolean(process.env.EOS_CORREO_DOMINIO),
    },
    // Largo y extremos, para detectar espacios pegados sin exponer el valor.
    forma_api_key: process.env.RESEND_API_KEY
      ? {
          largo: process.env.RESEND_API_KEY.length,
          empieza_con_re: process.env.RESEND_API_KEY.startsWith("re_"),
          tiene_espacios: /^\s|\s$/.test(process.env.RESEND_API_KEY),
        }
      : null,
  });
}
