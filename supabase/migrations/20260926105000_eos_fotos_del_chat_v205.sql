-- Las fotos que la persona manda en el chat se guardan, para poder mostrarlas.
--
-- Hasta acá, de un mensaje con fotos quedaba solo el texto: la burbuja decía
-- "[Imagen adjunta: IMG_4957.jpg]" y la foto no estaba en ningún lado. Se
-- mandaba al modelo y se perdía.
--
-- Ahora el navegador sube cada foto —la versión ya achicada, 200 a 400 KB—
-- por `POST /api/chat/imagenes`, y el mensaje anota las rutas en
-- `mensajes.metadata.imagenes`. Al abrir la conversación, `/api/chat/imagenes/ver`
-- las firma por una hora y la burbuja muestra las miniaturas.
--
-- El bucket es PRIVADO y no tiene políticas para `authenticated`: nadie sube
-- ni lee directo desde el navegador. Las dos rutas usan el cliente de servicio
-- y arman o exigen el prefijo `<usuario_id>/` a partir de la sesión, así que
-- una ruta adivinada de otra cuenta no se firma.
--
-- Si esta migración no corrió, la subida falla, el mensaje se guarda sin
-- `imagenes` y la burbuja sigue mostrando la línea de texto de siempre.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'eos-chat-imagenes',
  'eos-chat-imagenes',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
