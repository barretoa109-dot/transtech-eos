begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'eos-documents',
  'eos-documents',
  false,
  12582912,
  array[
    'text/plain',
    'text/csv',
    'application/json',
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.eos_documents_v11 is
  'Fase 8 Document Intelligence: registro canónico de documentos privados almacenados en el bucket eos-documents y aislados por usuario.';

commit;
