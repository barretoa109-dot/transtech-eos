# Ficha de App Store Connect (borrador)

Equivalente de `ficha-play-store.md` para **App Store Connect → Información
de la app** y **Presencia en App Store**. Todo lo que sigue es lo que la app
hace hoy. Si cambia una función, cambiar esta ficha. Mismas reglas de fondo
que la de Play: la app **no muestra precios ni cobra**, no vende nada dentro
de la app, y el servicio se contrata en la web (ver `tiendas.md`).

No se puede cargar nada de esto todavía: hace falta que la cuenta de Apple
Developer (organización) esté aprobada para crear el registro de la app en
App Store Connect. Este archivo es para tener el texto listo antes de esa
fecha, no para pegarlo hoy.

## Información de la app

- **Nombre:** EOS by TransTech (máximo 30 caracteres, igual que en Play).
- **Subtítulo** (máximo 30 caracteres, solo existe en Apple):
  > Tu encargado por WhatsApp
- **Bundle ID:** `com.transtech.eos` (ya fijado en `ios/App`, no se puede
  cambiar después de crear el registro).
- **SKU:** un identificador interno que no se ve al público, por ejemplo
  `eos-ios-1`. Cualquier valor sirve, pero no se puede reutilizar.
- **Idioma principal:** Apple no tiene "Español (Latinoamérica)" como
  localización, a diferencia de Play. La opción más cercana es **Español
  (México)**: es la que usan la mayoría de las apps dirigidas a Latinoamérica,
  incluido Paraguay, porque Apple no ofrece una localización regional propia.
  Si más adelante se agrega una localización en inglés, usar **English
  (U.K.)** como secundaria (convención común en la región, no obligatoria).
- **Categoría principal:** Productividad (igual que Play). **Secundaria**
  (opcional): Negocios — Apple sí separa ambas categorías; Play las junta en
  "Utilidades y productividad".
- **Derechos de contenido:** la app no contiene contenido de terceros con
  licencia (no hay música, video ni texto de otra empresa). Responder que no.

## Precio y disponibilidad

- **Precio:** Gratis (igual que Play: se descarga gratis, el servicio se
  contrata en la web).
- **Países/regiones:** sin decidir todavía. Faltan por confirmar con el
  dueño: ¿solo Paraguay, o toda Latinoamérica? Play tampoco lo tiene resuelto
  en su ficha — conviene decidirlo una vez para las dos tiendas, no por
  separado.

## Texto promocional (máximo 170 caracteres, se puede cambiar sin reenviar la app)

> Registrá ventas, gastos y clientes hablándole a EOS. Sin planillas, sin vueltas.

## Descripción (máximo 4000 caracteres)

Mismo texto que `ficha-play-store.md` — se mantiene igual en las dos tiendas
para no tener que auditar dos redacciones distintas:

> EOS es tu asistente para llevar el negocio y las finanzas personales sin planillas.
> Le escribís o le hablás como a una persona, y EOS registra, ordena y te responde.
>
> Qué podés hacer:
>
> • Registrar ventas, compras, gastos e ingresos con una frase.
> • Llevar clientes, proveedores, productos y stock.
> • Ver cómo viene el mes: qué entró, qué salió y qué queda por cobrar.
> • Anotar recordatorios y tareas, y recibir avisos de la agenda.
> • Guardar documentos y comprobantes que subas al chat.
> • Pedirle a EOS que te explique un número o que te arme un resumen.
>
> Tus datos son tuyos. Podés borrar tu cuenta cuando quieras desde el perfil o en
> transtech.com.py/eliminar-cuenta. Los datos se guardan en servidores de Supabase
> y se procesan para darte el servicio; no se venden ni se usan para publicidad.
>
> EOS es una herramienta de apoyo. No reemplaza la asesoría contable ni legal.

## Palabras clave (máximo 100 caracteres en total, separadas por comas sin espacio)

> negocio,finanzas,gastos,ventas,clientes,whatsapp,asistente,facturas,stock,recordatorios

No repetir palabras que ya están en el nombre o el subtítulo ("EOS",
"TransTech", "encargado", "WhatsApp"): Apple ya las indexa solas y repetirlas
desperdicia los 100 caracteres.

## URLs

- **Soporte:** `https://www.transtech.com.py` o, si Apple pide un correo
  además de una URL, `soporte@transtech.com.py` (la dirección que de verdad
  lee el buzón — ver `lib/email/primeros-dias.ts` y `app/api/soporte/route.ts`
  — no `augusto@transtech.com.py`, que es la que quedó anotada en la ficha de
  Play; conviene alinear las dos).
- **Marketing (opcional):** `https://www.transtech.com.py`.
- **Política de privacidad (obligatoria):** `https://www.transtech.com.py/privacidad`.
- **Copyright:** `© 2026 TransTech`.

## Qué NO decir

Igual que Play (decisión del dueño, no se negocia):

- No decir "gratis" si hay un plan pago: en la ficha, solo "descarga gratis".
- No decir "ilimitado" ni "sin límite" en ningún texto.
- No mencionar precios, planes ni cómo pagar.
- No prometer resultados financieros ni contables.

## Ícono y capturas

- **Ícono de 1024 × 1024 px, sin transparencia:** ya existe en
  `ios/App/App/Assets.xcassets/AppIcon.appiconset/` (generado el 01/10 con
  `npx @capacitor/assets generate`, fuente de 512 px en `assets/`). No hace
  falta nada nuevo para esto.
- **Capturas de iPhone** (al menos un tamaño, recomendado 6,9" — iPhone
  16 Pro Max): del chat, Negocio, Finanzas y Calendario. Requiere un
  teléfono o el simulador de Xcode con la app corriendo.
- **Capturas de iPad — posible punto pendiente:** el proyecto de Xcode tiene
  `TARGETED_DEVICE_FAMILY = "1,2"` (iPhone **y** iPad), heredado de la
  plantilla de Capacitor. Si eso no cambia, Apple va a pedir también capturas
  de iPad de 13" al enviar la app. Dos salidas, a decidir con el dueño:
  1. Restringir el proyecto a iPhone solamente (`TARGETED_DEVICE_FAMILY = "1"`
     en `ios/App/App.xcodeproj/project.pbxproj`) si nadie probó la app en
     iPad y no es un objetivo del lanzamiento — la opción más simple.
  2. Dejarlo como está y sumar capturas de iPad antes de enviar.
  No tocar esto en este archivo: es un cambio de código, no de la ficha.

## Clasificación por edad

Apple cambió el sistema en 2025: ya no se elige una clasificación a mano.
App Store Connect hace un cuestionario sobre el contenido (violencia,
lenguaje, contenido sexual, juego por dinero, contenido generado por
usuarios, acceso web sin filtro, etc.) y calcula una de cinco notas: **4+,
9+, 13+, 16+ o 18+**.

Importante no confundir dos cosas distintas:

- La **nota de contenido** que va a salir de ese cuestionario. EOS no tiene
  ninguno de los contenidos que Apple pregunta (no hay violencia, apuestas,
  contenido sexual ni acceso web sin filtro); el chat con IA entra como
  "contenido generado por el usuario" con el botón "Reportar" ya hecho (ver
  `tiendas.md`). Con esas respuestas, lo esperable es una nota baja (4+ o 9+),
  igual que la mayoría de las apps de productividad.
- La **edad para contratar el servicio** (18 años, porque EOS maneja plata y
  datos del negocio de la persona). Esa regla no es parte del cuestionario de
  Apple — es una condición de las Políticas de uso / Términos y se exige al
  crear la cuenta, igual que en la ficha de Play ("Público objetivo"). No
  intentar forzar la nota de contenido a "18+" para reflejar esto: son cosas
  distintas y Apple la calcula sola a partir de las respuestas sobre
  contenido, no sobre la edad legal para usar el servicio.

## Privacidad de la app (App Privacy)

Ya está resuelto en `etiquetas-privacidad.md` (revisado el 07/10/2026, antes
de este archivo): ese documento trae la tabla completa para "App Store
Connect → App Privacy", categoría por categoría. No se repite aquí para no
tener dos lugares que puedan desalinearse.

## Información para la revisión de Apple (App Review Information)

- **Contacto:** nombre, teléfono y correo de quien responde si Apple tiene
  preguntas durante la revisión (el dueño decide quién).
- **Cuenta de prueba:** a diferencia de lo que podría parecer por los botones
  de Google y Apple en el login, **no hace falta que el revisor use Sign in
  with Apple**. `LoginForm` también acepta correo y contraseña comunes
  (`components/auth/LoginForm.tsx`), así que alcanza con crear una cuenta de
  prueba con ese método, dejarle algo de contenido cargado (una venta, un
  cliente, un recordatorio, igual que en la ficha de Play) y poner ese correo
  y esa contraseña en App Store Connect. Es más simple para el revisor y
  evita depender de que Sign in with Apple esté bien configurado el día de
  la revisión.
- **Notas para el revisor:** aclarar que la app es un cliente que carga
  `transtech.com.py/eos/chat`; que no vende ni cobra nada dentro de la app
  (el botón de WhatsApp y el chat son el producto); y que "Eliminar cuenta"
  está en Perfil si el revisor quiere probarlo.

## Cumplimiento de exportación (cifrado)

`ios/App/App/Info.plist` ya declara `ITSAppUsesNonExemptEncryption = NO`
(solo usa el cifrado estándar de HTTPS/TLS, no cifrado propio). App Store
Connect va a volver a preguntarlo al subir cada build; la respuesta es la
misma: no usa cifrado no exento.

## Qué revisar antes de enviar

1. Que `/privacidad` y `etiquetas-privacidad.md` sigan diciendo lo mismo.
2. Que el texto de descripción y las reglas de "Qué NO decir" sigan
   coincidiendo con la ficha de Play (se escribieron para ser el mismo texto
   en las dos tiendas).
3. La decisión de `TARGETED_DEVICE_FAMILY` (iPhone solo vs. iPhone + iPad) y,
   si queda en los dos, las capturas de iPad.
4. Los países/regiones de disponibilidad, una sola vez para las dos tiendas.
5. Si se agrega cobro dentro de la app, revisar "Qué NO decir", el supuesto
   de `etiquetas-privacidad.md` y esta ficha por "Información de pago".
