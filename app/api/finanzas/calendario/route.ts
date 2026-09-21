import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { hoyEnParaguay, sumarDias } from "@/lib/fecha";
import { leerPanoramaPersonal } from "@/lib/finanzas/leerCalendario";
import { exigirModulo } from "@/lib/modulos/acceso";

export const dynamic = "force-dynamic";

/**
 * Lo que viene, día por día.
 *
 * ============================================================
 * EL MOTOR YA SABÍA TODO ESTO Y NADIE PODÍA VERLO
 * ============================================================
 *
 * `armarPanorama` devuelve, desde hace semanas, cada ingreso y cada egreso
 * previsto con su fecha: los gastos fijos declarados, las series que EOS
 * detectó viéndolas repetirse, las cuotas de cada deuda y los compromisos ya
 * anotados. Es lo que alimenta la curva del saldo y el detector de "el 28 te
 * vas a quedar corto".
 *
 * Pero la curva contesta *cuánto* va a haber, no *qué* va a pasar. Alguien que
 * ve la línea bajar el 25 no sabe si es el alquiler, la tarjeta o la cuota del
 * auto — y esas tres se resuelven de maneras distintas. La lista es lo que
 * convierte un pronóstico en algo sobre lo que se puede actuar.
 *
 * ============================================================
 * TRES HORIZONTES, UNA SOLA LECTURA
 * ============================================================
 *
 * Se calcula a 90 días y se devuelve entero. Los cortes de 7 y 30 los hace la
 * pantalla sobre la misma respuesta: pedirle al servidor tres veces lo mismo
 * para mostrar menos filas sería gastar tres viajes en recortar una lista.
 *
 * ============================================================
 * CADA EVENTO DICE DE DÓNDE SALIÓ
 * ============================================================
 *
 * `fuente` distingue lo anotado —que es un hecho— de lo previsible, que es una
 * deducción de EOS a partir de haberlo visto repetirse. La diferencia importa:
 * un alquiler declarado va a pasar; una serie detectada con poca confianza
 * puede no pasar, y presentar las dos igual convertiría una estimación en un
 * compromiso.
 */

/** 90 días: el horizonte más largo que el usuario pidió ver. */
const DIAS = 90;

export async function GET() {
  // El calendario es parte del panel financiero, que se contrata.
  const puerta = await exigirModulo("dashboard");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const usuarioId = puerta.usuarioId;

  const hoy = hoyEnParaguay();
  const hasta = sumarDias(hoy, DIAS);

  const leido = await leerPanoramaPersonal(supabase, usuarioId, hoy, hasta);

  if (!leido.configurado) {
    return NextResponse.json({ configurado: false }, { headers: noStore() });
  }

  const { panorama, moneda: principal } = leido;

  /*
   * Un solo hilo ordenado por fecha, con lo que entra y lo que sale mezclado.
   *
   * Separarlos en dos listas obligaría a la persona a hacer la cuenta que este
   * producto existe para hacerle: si el sueldo llega el 30 y el alquiler vence
   * el 28, lo que importa es ese orden, no que uno sea ingreso y otro egreso.
   */
  const eventos = [
    ...panorama.ingresos.map((i) => ({
      fecha: i.fecha,
      descripcion: i.descripcion,
      monto: i.monto,
      direccion: "entra" as const,
      fuente: "anotado" as const,
      confianza: i.confianza,
    })),
    ...panorama.egresos.map((e) => ({
      fecha: e.fecha,
      descripcion: e.descripcion,
      monto: e.monto,
      direccion: "sale" as const,
      fuente: e.fuente,
      confianza: e.confianza,
    })),
  ].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

  return NextResponse.json(
    {
      configurado: true,
      moneda: principal,
      desde: hoy,
      hasta,
      saldo_actual: panorama.saldoActual,
      reserva_minima: panorama.reservaMinima,
      eventos,
    },
    { headers: noStore() },
  );
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
