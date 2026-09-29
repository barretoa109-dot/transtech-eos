import type { NextConfig } from "next";

/**
 * Cabeceras de seguridad para todas las rutas.
 *
 * La CSP es DELIBERADAMENTE parcial: solo las directivas que no pueden romper
 * nada (`frame-ancestors`, `base-uri`, `object-src`). Una CSP con `script-src`
 * exige nonces por petición, o sea render dinámico en todo el sitio, y además
 * hay que enumerar Bancard (vpos.infonet.com.py, con puerto en staging),
 * Supabase, Google y el styled-jsx de las páginas. Equivocarse ahí rompe el
 * cobro con tarjeta sin que ningún test lo note. Si se endurece, que sea con
 * `Content-Security-Policy-Report-Only` primero y probando el pago completo.
 *
 * `microphone=(self)` es necesario: el dictado del chat usa el micrófono.
 */
export const CABECERAS_GENERALES = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), payment=(self)",
  },
];

/**
 * Nadie puede embeber EOS en un iframe (clickjacking)... salvo una pantalla.
 *
 * `/pago/resultado` es la `return_url` del 3DS: Bancard muestra el desafío del
 * banco DENTRO de un iframe del checkout y lo cierra cargando esa pantalla
 * adentro (ver `app/pago/resultado/ResultadoPago.tsx`). Los ancestros en ese
 * momento son el checkout, el iframe de Bancard y, según el banco, el de su
 * servidor de desafío: con `frame-ancestors 'none'` o `X-Frame-Options: DENY`
 * el navegador se niega a dibujarla y el cliente se queda mirando un recuadro
 * vacío con el pago ya cobrado. Por eso esa ruta queda afuera de la regla, y
 * el test lo fija.
 */
export const CABECERAS_ANTI_IFRAME = [
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  },
];

export const RUTAS_ANTI_IFRAME = "/((?!pago/resultado).*)";

const nextConfig: NextConfig = {
  /*
   * ffmpeg para los videos que llegan por WhatsApp (`lib/whatsapp/video.ts`).
   *
   * `ffmpeg-static` resuelve la ruta del binario con `__dirname`: empaquetado
   * dejaría de encontrarlo, por eso va externo. Y como el binario no se importa,
   * el rastreo de archivos no lo ve solo: se lo incluye a mano, y únicamente en
   * la función del webhook, que es la única que lo usa (pesa 80 MB).
   */
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/whatsapp/webhook": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: CABECERAS_GENERALES },
      { source: RUTAS_ANTI_IFRAME, headers: CABECERAS_ANTI_IFRAME },
    ];
  },
};

export default nextConfig;
