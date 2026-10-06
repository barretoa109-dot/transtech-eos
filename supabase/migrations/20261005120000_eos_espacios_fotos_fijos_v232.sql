-- Espacios Personal / Negocio, etapa 1 (v232).
--
-- Tres cosas que la reorganización por espacios necesita guardar, y nada más.
-- Todo es aditivo: columnas nuevas con valor por defecto, un bucket y un
-- índice. Ninguna función existente cambia, así que el código que ya corre en
-- producción sigue funcionando igual antes y después de aplicarla.
--
-- ============================================================
-- 1. FOTO Y CATEGORÍA DEL PRODUCTO
-- ============================================================
--
-- Una tienda busca su catálogo por categoría y reconoce un producto por la
-- foto. Las dos son opcionales: un producto sin foto se ve igual que hoy.
--
-- La foto NO va en una columna pública con la URL: el bucket es privado y la
-- ruta se firma al leer, igual que las fotos del chat (v205). La columna
-- guarda solo la ruta dentro del bucket.

alter table public.eos_erp_productos
  add column if not exists categoria text,
  add column if not exists foto_ruta text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'eos_erp_productos_categoria_largo'
  ) then
    alter table public.eos_erp_productos
      add constraint eos_erp_productos_categoria_largo
      check (categoria is null or length(btrim(categoria)) between 1 and 60);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'eos_erp_productos_foto_ruta_largo'
  ) then
    alter table public.eos_erp_productos
      add constraint eos_erp_productos_foto_ruta_largo
      check (foto_ruta is null or length(foto_ruta) between 1 and 300);
  end if;
end $$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'eos-productos-fotos',
  'eos-productos-fotos',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Sin políticas sobre storage.objects para este bucket: solo el servidor (con
-- la clave de servicio) sube, borra y firma. Ni `anon` ni `authenticated`
-- pueden listar ni leer directo.

-- ============================================================
-- 2. EL PAGO DE UN FIJO
-- ============================================================
--
-- Hasta hoy un fijo era solo lo que se espera ("internet, día 10"). No había
-- forma de decir "el de octubre ya lo pagué", y por eso la pantalla no podía
-- distinguir entre el concepto, el vencimiento y el pago hecho.
--
-- El pago es un movimiento como cualquier otro (cuenta en el panel, en el
-- resultado y en la proyección), con dos columnas que lo atan a su fijo y al
-- mes que cubre. El índice único impide registrar dos veces el mismo mes.
--
-- `on delete set null`: si alguien borra el fijo, el pago que hizo sigue
-- existiendo. Lo que pasó no se borra porque cambió lo que se espera.

alter table public.eos_movimientos_financieros
  add column if not exists fijo_id uuid,
  add column if not exists fijo_periodo date;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'eos_movimientos_financieros_fijo_fk'
  ) then
    alter table public.eos_movimientos_financieros
      add constraint eos_movimientos_financieros_fijo_fk
      foreign key (fijo_id) references public.eos_finanzas_fijos(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'eos_movimientos_financieros_fijo_periodo_mes'
  ) then
    alter table public.eos_movimientos_financieros
      add constraint eos_movimientos_financieros_fijo_periodo_mes
      check (fijo_periodo is null or extract(day from fijo_periodo) = 1);
  end if;
end $$;

create unique index if not exists eos_movimientos_financieros_fijo_mes
  on public.eos_movimientos_financieros (fijo_id, fijo_periodo)
  where fijo_id is not null;

-- El último mes pagado, en el fijo mismo. Lo leen las proyecciones: un fijo
-- pagado antes de su vencimiento no tiene que volver a restarse este mes.
alter table public.eos_finanzas_fijos
  add column if not exists pagado_hasta date;

-- ============================================================
-- 3. FUNCIONES QUE CADA NEGOCIO USA
-- ============================================================
--
-- No todos los negocios venden productos de un catálogo ni llevan un CRM. Lo
-- que el negocio apaga sale de su menú; no se borra nada ni cambia lo que se
-- cobra. La lista es cerrada para que un valor mal escrito no esconda algo
-- que nadie sabe volver a prender.

alter table public.eos_empresas
  add column if not exists funciones_ocultas text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'eos_empresas_funciones_ocultas_validas'
  ) then
    alter table public.eos_empresas
      add constraint eos_empresas_funciones_ocultas_validas
      check (funciones_ocultas <@ array['catalogo', 'clientes']::text[]);
  end if;
end $$;
