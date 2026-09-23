import type { Instrumentation } from "next";

/**
 * Las excepciones del servidor que nadie manejó (punto 11 del plan).
 *
 * Next llama a `onRequestError` cuando una ruta, un componente de servidor, una
 * server action o el proxy revientan sin que nadie lo atrape. Hasta acá eso solo
 * quedaba en los logs de Vercel. Ahora además queda en
 * `eos_errores_servidor_v194` y lo muestra `/api/internal/salud`.
 *
 * Solo en Node: el runtime edge no tiene `node:crypto` ni el cliente de
 * servicio, y ahí alcanza con el log. El import es dinámico para que nada de
 * esto se cargue hasta que haya un error de verdad.
 *
 * Si algún día se instala Sentry, su wizard edita este archivo: la llamada de
 * abajo se deja junto a la suya, no se reemplaza.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    console.error("EOS excepción del servidor (edge):", error instanceof Error ? error.name : typeof error);
    return;
  }

  const { registrarErrorDeServidor } = await import("./lib/monitoreo/errores-servidor");
  await registrarErrorDeServidor(error, request, context);
};
