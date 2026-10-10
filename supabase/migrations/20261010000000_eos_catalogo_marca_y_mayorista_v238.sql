-- Marca y precio mayorista en el catálogo (v238).
--
-- ============================================================
-- POR QUÉ ESTAS DOS, Y NO MÁS
-- ============================================================
--
-- El encargo del 10/10/2026 pedía "un catálogo completo, pero muy fácil de
-- usar": marca, variantes y listas de precios. De las tres, una ya existía
-- sin saberlo y las otras dos son aditivas y chicas a propósito.
--
-- "Variantes" NO se resuelve con una columna nueva: el catálogo ya las
-- maneja, desde la v156/v157, con el talle en el propio nombre del producto
-- ("Conjunto verde oliva S", "Conjunto verde oliva M") y un resolver que
-- busca sin el talle pero lo usa para DESCARTAR el que no corresponde. Eso
-- ya es "variantes, completo" del lado de vender. Lo que faltaba era del
-- lado de CREARLAS: escribir tres formularios completos para S/M/L en vez
-- de uno. Esa parte se resuelve en la pantalla (NegocioView.tsx), no en la
-- base: un campo "Talles o variantes" que crea N filas de una, cada una ya
-- nombrada según la misma convención que el resolver ya entiende. No hace
-- falta ninguna columna ni ningún cambio al resolver, y por eso no hay
-- ningún riesgo nuevo sobre el camino que vende.
--
-- "Marca" y "precio mayorista" sí son datos nuevos de verdad, y los dos son
-- opcionales con el mismo patrón que `categoria` (v232): una columna, un
-- `check` de largo o de signo, nada que una fila existente deje de cumplir.
--
-- Deliberadamente NO se construye un sistema de listas de precios con N
-- niveles (mayorista, VIP, por canal...): es la clase de complejidad que
-- hace que un catálogo "completo" deje de ser "fácil de usar". Un segundo
-- precio opcional alcanza para separar menudeo de mayorista, que es el caso
-- real de un comercio chico; si hiciera falta más, se agrega cuando alguien
-- lo use y no antes.

alter table public.eos_erp_productos
  add column if not exists marca text,
  add column if not exists precio_mayorista numeric(16,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'eos_erp_productos_marca_largo'
  ) then
    alter table public.eos_erp_productos
      add constraint eos_erp_productos_marca_largo
      check (marca is null or length(btrim(marca)) between 1 and 60);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'eos_erp_productos_precio_mayorista_signo'
  ) then
    alter table public.eos_erp_productos
      add constraint eos_erp_productos_precio_mayorista_signo
      check (precio_mayorista is null or precio_mayorista >= 0);
  end if;
end $$;

comment on column public.eos_erp_productos.marca is
  'v238: opcional, como categoria. Para filtrar y mostrar en el catálogo; no la usa ningún cálculo.';
comment on column public.eos_erp_productos.precio_mayorista is
  'v238: segundo precio opcional, con IVA incluido igual que precio_venta. Informativo en el catálogo; una venta sigue mandando el monto que corresponda, como siempre.';
