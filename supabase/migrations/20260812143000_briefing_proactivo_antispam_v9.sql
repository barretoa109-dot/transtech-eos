begin;

alter table public.eos_followup_preferences
  add column if not exists max_alertas_dia smallint not null default 3
    check (max_alertas_dia between 1 and 10),
  add column if not exists severidad_minima text not null default 'media'
    check (severidad_minima in ('media', 'alta', 'critica')),
  add column if not exists silencio_desde smallint not null default 21
    check (silencio_desde between 0 and 23),
  add column if not exists silencio_hasta smallint not null default 7
    check (silencio_hasta between 0 and 23);

comment on column public.eos_followup_preferences.max_alertas_dia is
  'Presupuesto diario máximo de interrupciones proactivas visibles.';
comment on column public.eos_followup_preferences.severidad_minima is
  'Umbral mínimo para interrumpir al usuario: media, alta o critica.';
comment on column public.eos_followup_preferences.silencio_desde is
  'Hora local en que comienza el periodo de silencio.';
comment on column public.eos_followup_preferences.silencio_hasta is
  'Hora local en que termina el periodo de silencio.';

commit;
