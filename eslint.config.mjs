import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    /*
     * Lo que Capacitor genera para Android.
     *
     * `android/app/build/` son artefactos de compilación: el puente nativo que
     * Capacitor copia adentro no lo escribimos nosotros y se regenera en cada
     * build. Estaba sumando avisos —dos copias del mismo archivo, debug y
     * release— sobre código que nadie de acá puede arreglar.
     *
     * Un aviso que no se puede accionar enseña a ignorar los avisos.
     */
    "android/app/build/**",
    "android/app/src/main/assets/**",

    // Los scripts que arman la presentación y el video. Están fuera del
    // repositorio (`.gitignore`) y no son código de EOS.
    ".video-build/**",
  ]),
]);

export default eslintConfig;
