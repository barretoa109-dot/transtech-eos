import type { NextConfig } from "next";

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
};

export default nextConfig;
