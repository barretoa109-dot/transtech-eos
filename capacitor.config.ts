import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.transtech.eos",
  appName: "TransTech EOS",
  webDir: "public",

  server: {
    url: "https://transtech.com.py/mobile",
    cleartext: false,
    allowNavigation: [
      "transtech.com.py",
      "*.transtech.com.py",
      "*.supabase.co",
    ],
  },

  android: {
    allowMixedContent: false,
  },
};

export default config;