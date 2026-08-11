create index if not exists eos_memory_conversacion_idx
  on public.eos_memory (conversacion_id)
  where conversacion_id is not null;

create index if not exists eos_memory_mensaje_idx
  on public.eos_memory (mensaje_id)
  where mensaje_id is not null;

create index if not exists eos_memory_evidence_conversacion_idx
  on public.eos_memory_evidence (conversacion_id)
  where conversacion_id is not null;

create index if not exists eos_memory_evidence_mensaje_idx
  on public.eos_memory_evidence (mensaje_id)
  where mensaje_id is not null;
