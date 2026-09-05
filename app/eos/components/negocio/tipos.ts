/**
 * Los tipos que comparten las pantallas del módulo de negocio.
 *
 * Viven acá y no en cada archivo porque un contacto es el mismo objeto en la
 * venta, en la compra y en el embudo: si cada pantalla lo declara por su
 * cuenta, la que se olvide de agregar un campo nuevo lo va a leer como
 * `undefined` sin que TypeScript diga nada.
 */

export type Contacto = {
  id: string;
  nombre: string;
  ruc: string | null;
  ruc_dv: number | null;
  telefono: string | null;
  es_cliente: boolean;
  es_proveedor: boolean;
};

export type Producto = {
  id: string;
  codigo: string | null;
  nombre: string;
  precio_venta: number;
  costo?: number | null;
  moneda: string;
  iva: 0 | 5 | 10;
  controla_stock: boolean;
  stock_actual: number;
  stock_minimo: number;
  bajo_minimo: boolean;
};

export type Oportunidad = {
  id: string;
  titulo: string;
  detalle: string | null;
  monto: number;
  moneda: string;
  etapa: string;
  cierre_estimado: string | null;
  contacto: { id: string; nombre: string } | null;
};

export type Actividad = {
  id: string;
  tipo: string;
  detalle: string;
  fecha: string;
  hecha: boolean;
  contacto: { id: string; nombre: string } | null;
};

export type CompraItem = {
  id: string;
  producto_id: string | null;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva: number;
  total: number;
  orden: number;
};

export type Compra = {
  id: string;
  fecha: string;
  moneda: string;
  total: number;
  iva_total: number;
  condicion: string;
  estado: string;
  numero_comprobante: string | null;
  movimiento_id: string | null;
  contacto: { id: string; nombre: string } | null;
  items: CompraItem[];
};
