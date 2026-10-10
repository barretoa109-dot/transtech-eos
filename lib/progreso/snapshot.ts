import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { armarPatrimonio } from "../finanzas/patrimonio.ts";
import { codigoMoneda } from "../finanzas/monedas.ts";

/**
 * La foto mensual de patrimonio para "Tu progreso" (v237).
 *
 * Hasta ahora EOS solo sabía el ÚLTIMO patrimonio declarado: sin una foto
 * guardada cada mes, no había con qué armar una curva de cómo evolucionó.
 * Esto corre una vez por mes (desde el cron de `briefing-diario`, el plan
 * Hobby no deja crear otro) y le saca esa foto a cada cuenta que ya definió
 * su Constitución Financiera.
 *
 * Reusa `armarPatrimonio` —la misma función pura que arma la pantalla de
 * Patrimonio— así que el número de la foto es exactamente el mismo que
 * vería la persona si entrara ese día. `neto` puede guardarse en null: sin
 * las dos mitades (activos y pasivos) declaradas, no hay nada honesto que
 * guardar todavía, y eso también es información.
 */

export type Periodo = { clave: string; hasta: string };

export type SnapshotPatrimonio = {
  moneda: string;
  patrimonio_neto: number | null;
  activos: number;
  pasivos: number;
  falta: string | null;
};

const PAGINA = 1000;

/** Las cuentas personales con una política ya definida: tienen qué fotografiar. */
async function cuentasConPolitica(admin: ClienteSinTipos): Promise<{ uid: string; moneda: string | null }[]> {
  const filas: { usuario_id: string; moneda: string | null }[] = [];

  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await admin
      .from("eos_finanzas_politica")
      .select("usuario_id,moneda")
      .range(inicio, inicio + PAGINA - 1);

    if (error) throw new Error(`Progreso: no se pudieron leer las políticas: ${error.message}`);
    const pagina = (data ?? []) as { usuario_id: string; moneda: string | null }[];
    filas.push(...pagina);
    if (pagina.length < PAGINA) break;
  }

  return filas.map((f) => ({ uid: f.usuario_id, moneda: f.moneda }));
}

/** Los pasos del onboarding en orden — copiado de app/api/finanzas/patrimonio/route.ts. */
const PASOS_ONBOARDING = [
  "bienvenida",
  "cuentas",
  "ingresos",
  "gastos_fijos",
  "deudas",
  "preocupaciones",
  "correo",
  "cierre",
  "completado",
];

/** El patrimonio de una cuenta, con la misma lectura que `/api/finanzas/patrimonio`. */
async function snapshotDeUsuario(
  admin: ClienteSinTipos,
  uid: string,
  monedaDeclarada: string | null,
  hoy: string,
): Promise<SnapshotPatrimonio | null> {
  const principal = codigoMoneda(monedaDeclarada, "PYG");

  const [cuentasRes, bienesRes, deudasRes, onboardingRes] = await Promise.all([
    admin
      .from("eos_finanzas_cuentas")
      .select("nombre,tipo,moneda,saldo_declarado,saldo_declarado_el")
      .eq("ambito", "personal")
      .eq("usuario_id", uid)
      .eq("activa", true),
    admin
      .from("eos_finanzas_activos")
      .select("nombre,tipo,moneda,valor_declarado,valor_declarado_el")
      .eq("ambito", "personal")
      .eq("usuario_id", uid)
      .eq("activo", true),
    admin
      .from("eos_finanzas_deudas")
      .select("acreedor,tipo,moneda,saldo_declarado,saldo_declarado_el")
      .eq("ambito", "personal")
      .eq("usuario_id", uid)
      .neq("estado", "saldada"),
    admin.from("eos_onboarding").select("paso").eq("usuario_id", uid).maybeSingle(),
  ]);

  if (cuentasRes.error || bienesRes.error || deudasRes.error) {
    throw new Error(
      `Progreso: no se pudo leer el patrimonio de ${uid}: ${
        cuentasRes.error?.message ?? bienesRes.error?.message ?? deudasRes.error?.message
      }`,
    );
  }

  type Fila = Record<string, unknown>;
  const soloPrincipal = (f: Fila) => codigoMoneda((f.moneda as string | null) ?? null, principal) === principal;

  const cuentas = ((cuentasRes.data ?? []) as Fila[]).filter(soloPrincipal).map((c) => ({
    nombre: (c.nombre as string) ?? "",
    tipo: (c.tipo as string) ?? "banco",
    saldo: c.saldo_declarado === null ? null : Number(c.saldo_declarado),
    declarado_el: (c.saldo_declarado_el as string | null) ?? null,
  }));

  const bienes = ((bienesRes.data ?? []) as Fila[]).filter(soloPrincipal).map((b) => ({
    nombre: (b.nombre as string) ?? "",
    tipo: (b.tipo as string) ?? "otro",
    valor: Number(b.valor_declarado ?? 0),
    declarado_el: (b.valor_declarado_el as string | null) ?? null,
  }));

  const deudas = ((deudasRes.data ?? []) as Fila[]).filter(soloPrincipal).map((d) => ({
    acreedor: (d.acreedor as string) ?? "",
    tipo: (d.tipo as string) ?? "otro",
    saldo: Number(d.saldo_declarado ?? 0),
    declarado_el: (d.saldo_declarado_el as string | null) ?? null,
  }));

  // Sin ninguna de las tres fuentes y sin cuentas declaradas, no hay nada
  // real que fotografiar todavía — ni siquiera "cero".
  if (cuentas.length === 0 && bienes.length === 0 && deudas.length === 0) return null;

  const paso = (onboardingRes.data?.paso as string | null) ?? null;
  const indice = paso === null ? -1 : PASOS_ONBOARDING.indexOf(paso);
  const pasivosConfirmados = indice > PASOS_ONBOARDING.indexOf("deudas");

  const patrimonio = armarPatrimonio({ moneda: principal, hoy, cuentas, bienes, deudas, pasivosConfirmados });

  return {
    moneda: principal,
    patrimonio_neto: patrimonio.neto,
    activos: patrimonio.activos,
    pasivos: patrimonio.pasivos,
    falta: patrimonio.falta,
  };
}

/**
 * Le saca la foto del mes a cada cuenta personal con política definida, y la
 * guarda si todavía no existe una para ese período (`unique(usuario_id,
 * periodo)` en la tabla la protege igual, esto solo evita el trabajo de más).
 */
export async function tomarSnapshotsMensuales(
  admin: ClienteSinTipos,
  periodo: Periodo,
): Promise<{ guardados: number; sinDatos: number; fallidos: number }> {
  const cuentas = await cuentasConPolitica(admin);
  const resumen = { guardados: 0, sinDatos: 0, fallidos: 0 };

  const { data: yaTomados, error: errorYaTomados } = await admin
    .from("eos_finanzas_progreso_mensual_v237")
    .select("usuario_id")
    .eq("periodo", periodo.clave);
  if (errorYaTomados) throw new Error(`Progreso: no se pudo leer qué ya se fotografió: ${errorYaTomados.message}`);
  const yaTienen = new Set(((yaTomados ?? []) as { usuario_id: string }[]).map((f) => f.usuario_id));

  for (const { uid, moneda } of cuentas) {
    if (yaTienen.has(uid)) continue;

    try {
      const snapshot = await snapshotDeUsuario(admin, uid, moneda, periodo.hasta);
      if (!snapshot) {
        resumen.sinDatos += 1;
        continue;
      }

      const { error } = await admin
        .from("eos_finanzas_progreso_mensual_v237")
        .insert({ usuario_id: uid, periodo: periodo.clave, datos: snapshot });

      // 23505: otra ejecución ya la guardó justo antes — no es una falla.
      if (error && (error as { code?: string }).code !== "23505") {
        throw new Error(error.message);
      }

      resumen.guardados += 1;
    } catch (e) {
      resumen.fallidos += 1;
      console.error(`Progreso: no se pudo fotografiar a ${uid}:`, e instanceof Error ? e.message : e);
    }
  }

  return resumen;
}
