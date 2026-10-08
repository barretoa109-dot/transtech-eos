import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.transtech.eos",
  appName: "TransTech EOS",
  webDir: "public",

  /*
   * Marca que la web usa para saber que está dentro de la app nativa (ver
   * `lib/app-nativa/plataforma.ts`, que tiene un test que compara este valor).
   * Con ella el proxy no abre planes ni pagos, y las pantallas esconden lo que
   * invita a comprar: las tiendas no dejan cobrar por fuera de su sistema.
   */
  appendUserAgent: "EOSApp/1",

  server: {
    /*
     * Directo al chat. Antes abría /mobile, que el proxy redirigía a
     * /eos/chat: una vuelta más en cada arranque. Sin sesión, el proxy
     * manda a /login como en la web.
     */
    url: "https://www.transtech.com.py/eos/chat",
    cleartext: false,
    /*
     * Sin internet, el WebView mostraba el error del sistema o una pantalla
     * en blanco. Esta página vive dentro de la app (sale de `public/`) y
     * vuelve sola al chat cuando vuelve la conexión.
     */
    errorPath: "sin-conexion.html",
    allowNavigation: [
      "transtech.com.py",
      "*.transtech.com.py",
      "*.supabase.co",
    ],
  },

  android: {
    allowMixedContent: false,
  },

  plugins: {
    /*
     * Sin esto, @capacitor/push-notifications no muestra nada en iOS cuando
     * la app está en primer plano (Android sí avisa igual, por su cuenta).
     * Ver lib/push/cliente.ts.
     */
    PushNotifications: {
      presentationOptions: ["badge", "sound", "banner", "list"],
    },
  },
};

export default config;
