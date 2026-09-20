import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { normalizarTelefono } from "../whatsapp-crm/telefono.ts";
import {
  calcularSeguimientos,
  type ActividadEntrada,
  type ContactoEntrada,
  type EstadoGuardado,
  type MensajeEntrada,
  type OportunidadEntrada,
  type Seguimiento,
} from "./seguimientos.ts";

/**
 * Trae de la base lo que el motor de seguimientos necesita, y se lo da.
 *
 * ============================================================
 * TOLERA UNA BASE A MEDIO ACTUALIZAR
 * ============================================================
 *
 * Este código y la migración v185 no se despliegan a la vez. Cada lectura que
 * depende de algo nuevo (una columna, una tabla) cae a lo que hay: un seguimiento con
 * menos información es mejor que ninguno, y una pantalla rota por una columna que
 * falta es peor que las dos cosas.
 *
 * DE QUIÉN SON LOS DATOS: cada consulta lleva `usuario_id`. Sirve con cualquier
 * cliente —el de la sesión (RLS) o el de servicio (el cron)—; con el de servicio ese
 * filtro escrito a mano es la única frontera.
 */

const AUSENTE = new Set(["42P01", "PGRST205", "42703", "PGRST204"]);
const esAusente = (e: unknown) => AUSENTE.has(String((e as { code?: unknown } | null)?.code ?? ""));

const DIAS_MENSAJES = 45;
const DIAS_ACTIVIDADES = 60;
const MS_DIA = 86_400_000;

type Resultado = { data: unknown; error: unknown };

/** Una lectura opcional: si falla porque falta algo nuevo, es "no hay"; si falla por otra cosa, se propaga. */
async function opcional(consulta: PromiseLike<Resultado>, nombre: string): Promise<unknown[]> {
  const { data, error } = await consulta;
  if (error) {
    if (esAusente(error)) return [];
    throw new Error(`No se pudo leer ${nombre}: ${(error as { message?: string }).message ?? "error"}`);
  }
  return (data ?? []) as unknown[];
}

export async function leerSeguimientos(
  db: ClienteSinTipos,
  usuarioId: string,
  hoy: string,
  ahora: Date = new Date(),
): Promise<Seguimiento[]> {
  const desdeMensajes = new Date(ahora.getTime() - DIAS_MENSAJES * MS_DIA).toISOString();
  const desdeActividades = new Date(ahora.getTime() - DIAS_ACTIVIDADES * MS_DIA).toISOString().slice(0, 10);

  // Los contactos: con las columnas de la v185 y, si no están, sin ellas.
  const columnasNuevas = "id,nombre,estado_relacion,proxima_interaccion_en,creado_en,activo";
  const columnasBase = "id,nombre,creado_en,activo";

  const pedirContactos = (cols: string) =>
    db.from("eos_crm_contactos").select(cols).eq("usuario_id", usuarioId).eq("activo", true).limit(1000);

  let contactosCrudos = await pedirContactos(columnasNuevas);
  if (contactosCrudos.error && esAusente(contactosCrudos.error)) contactosCrudos = await pedirContactos(columnasBase);
  if (contactosCrudos.error) throw new Error("No se pudieron leer los clientes.");

  const columnasOp = "id,contacto_id,titulo,monto,moneda,etapa,cierre_estimado,actualizado_en,creado_en";
  const pedirOportunidades = (cols: string) =>
    db.from("eos_crm_oportunidades").select(cols).eq("usuario_id", usuarioId).not("etapa", "in", "(ganada,perdida)").limit(500);

  let opCrudas = await pedirOportunidades(columnasOp + ",proxima_accion_en");
  if (opCrudas.error && esAusente(opCrudas.error)) opCrudas = await pedirOportunidades(columnasOp);
  if (opCrudas.error) throw new Error("No se pudieron leer las oportunidades.");

  const [actividades, mensajes, estados, canales, consentimientos] = await Promise.all([
    opcional(
      db
        .from("eos_crm_actividades")
        .select("contacto_id,oportunidad_id,tipo,fecha,hecha,detalle")
        .eq("usuario_id", usuarioId)
        .or(`fecha.gte.${desdeActividades},hecha.eq.false`)
        .limit(1500),
      "las actividades",
    ),
    opcional(
      db
        .from("eos_wa_mensajes")
        .select("contacto_id,direccion,estado,ocurrio_en")
        .eq("usuario_id", usuarioId)
        .gte("ocurrio_en", desdeMensajes)
        .limit(3000),
      "los mensajes",
    ),
    opcional(db.from("eos_crm_seguimientos_estado").select("clave,estado,hasta").eq("usuario_id", usuarioId).limit(1000), "el estado de los seguimientos"),
    opcional(db.from("eos_wa_canales").select("id,estado,secreto_ref").eq("usuario_id", usuarioId).neq("estado", "desconectado").limit(1), "el canal"),
    opcional(db.from("eos_wa_consentimientos").select("contacto_id,estado").eq("usuario_id", usuarioId).limit(3000), "los consentimientos"),
  ]);

  // A quién se le puede escribir AHORA: canal activo con acceso de envío, cliente con teléfono
  // válido y que no pidió la baja. Es una comprobación de AVISO; el envío la repite entera.
  const canal = (canales[0] ?? null) as { estado: string; secreto_ref: string | null } | null;
  const canalUsable = canal !== null && canal.estado === "activo" && Boolean(canal.secreto_ref);
  const revocados = new Set(
    (consentimientos as { contacto_id: string; estado: string }[]).filter((c) => c.estado === "revocado").map((c) => c.contacto_id),
  );

  const contactosConTelefono = canalUsable
    ? await opcional(
        db.from("eos_crm_contactos").select("id,telefono").eq("usuario_id", usuarioId).eq("activo", true).not("telefono", "is", null).limit(1000),
        "los teléfonos",
      )
    : [];

  const puedenRecibir = new Set(
    (contactosConTelefono as { id: string; telefono: string | null }[])
      .filter((c) => normalizarTelefono(c.telefono) !== null && !revocados.has(c.id))
      .map((c) => c.id),
  );

  return calcularSeguimientos({
    hoy,
    contactos: (contactosCrudos.data ?? []) as unknown as ContactoEntrada[],
    oportunidades: ((opCrudas.data ?? []) as unknown as Record<string, unknown>[]).map((o) => ({ ...o, monto: Number(o.monto ?? 0) })) as OportunidadEntrada[],
    actividades: actividades as ActividadEntrada[],
    mensajes: mensajes as MensajeEntrada[],
    estados: estados as EstadoGuardado[],
    puedenRecibir,
  });
}
