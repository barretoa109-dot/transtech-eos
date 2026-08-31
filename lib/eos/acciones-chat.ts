const ACCIONES_NEGOCIO_CON_APROBACION = new Set([
  "REGISTRAR_VENTA",
  "AJUSTAR_STOCK",
  "CREAR_CONTACTO",
]);

type AccionEOS = { tipo?: unknown };

export function agregarAccesoAprobacion(
  respuesta: string,
  acciones: AccionEOS[],
  origen: string,
): string {
  const requiereAprobacion = acciones.some((accion) =>
    ACCIONES_NEGOCIO_CON_APROBACION.has(String(accion?.tipo || "").trim().toUpperCase()),
  );

  if (!requiereAprobacion || respuesta.includes("/eos/autonomy")) return respuesta;

  return `${respuesta}\n\nPara completar el registro, revisá y aprobá la operación pendiente en ${origen}/eos/autonomy`;
}
