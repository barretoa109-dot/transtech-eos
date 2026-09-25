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
const cabeceras = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), payment=(self)",
  },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: cabeceras }];
  },
};

export default nextConfig;
