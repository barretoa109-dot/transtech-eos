import { NextResponse } from "next/server";

import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { hoyEnParaguay } from "@/lib/fecha";
import { nombreDelMes } from "@/lib/finanzas/formato";
import { fuenteSupabase } from "@/lib/impacto/enviar";
import { calcularImpacto, lineasDelInforme, tiempoEnPalabras, type Periodo } from "@/lib/impacto/informe";

export const dynamic = "force-dynamic";

/**
 * "Tu impacto", dentro de la app — el mismo cálculo que el correo mensual
 * (`lib/impacto/informe.ts`, `redactarInforme`), pero del mes en curso y a
 * pedido, en vez de una vez al mes en la bandeja de entrada.
 *
 * Reusa `fuenteSupabase(admin).hechos(...)`: la misma lectura que arma el
 * correo, con el mismo cliente admin que ya usa el resto de rutas que leen
 * cartera (`app/api/erp/cartera/route.ts`) — `exigirModulo` ya confirmó de
 * quién es el pedido antes de pasarle el id a una lectura sin RLS.
 *
 * Sin el piso de `MINIMO_DE_COSAS` del correo: ese piso existe para no
 * mandar un correo que decepcione a quien no lo pidió. Acá nadie lo recibe
 * sin entrar a mirarlo, así que mostrar "lo que hay hasta ahora" —aunque sea
 * poco, el día 2 del mes— tiene sentido.
 *
 * Los números no separan Personal de Negocio: la bitácora de acciones
 * (`eos_action_commands`) no lleva ámbito, y el correo de impacto —ya en
 * producción— nunca lo separó. Es "lo que hicimos juntos" a nivel cuenta,
 * no a nivel espacio; por eso el texto dice eso mismo, nunca "tu Personal".
 */
export async function GET() {
  const puerta = await exigirModulo("dashboard");
  if (puerta.respuesta) return puerta.respuesta;

  const hoy = hoyEnParaguay();
  const mesActual = hoy.slice(0, 7);
  const periodo: Periodo = {
    clave: mesActual,
    desde: `${mesActual}-01`,
    hasta: hoy,
    nombreMes: nombreDelMes(mesActual, true),
  };

  try {
    const hechos = await fuenteSupabase(adminSinTipos()).hechos(puerta.usuarioId, periodo);
    const impacto = calcularImpacto(periodo.clave, hechos);

    return NextResponse.json(
      {
        configurado: true,
        nombreMes: periodo.nombreMes,
        lineas: lineasDelInforme(impacto),
        minutosAhorrados: impacto.minutosAhorrados,
        tiempoEnPalabras: tiempoEnPalabras(impacto.minutosAhorrados),
        anotadas: impacto.anotadas,
        avisos: impacto.avisos.total,
        documentos: impacto.documentos,
      },
      { headers: noStore() },
    );
  } catch (error) {
    console.error("Tu impacto: no se pudo calcular:", error);
    return NextResponse.json({ error: "No pudimos calcular tu impacto en este momento." }, { status: 503, headers: noStore() });
  }
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0" };
}
