# Etiquetas de privacidad de las tiendas

Las respuestas para **App Store Connect → App Privacy** y **Play Console →
Seguridad de los datos**. Salen de `/privacidad` tal como quedó el 30/09/2026
(PR #212), que se revisó contra el código. **Si cambia uno, cambia el otro**:
una etiqueta que dice menos que la política es motivo de rechazo, y una que
dice más asusta sin motivo.

Supuesto del que dependen dos respuestas: la app nativa **no muestra precios ni
cobra** (tablero app-03, decisión app-02). Si eso cambia y el pago con tarjeta
de Bancard se hace dentro de la app, revisar "Información de pago".

## Criterios comunes

- **Todo lo que se recoge está vinculado a la persona** (hay cuenta con correo).
- **Nada se usa para seguimiento** (tracking): no hay publicidad, ni SDK de
  terceros de analítica o anuncios, ni se cruza con datos de otras empresas.
- **Nada se vende.**
- Los proveedores (Supabase, Vercel, OpenAI, Meta, Resend, Railway, Bancard,
  GitHub, Cloudflare, Google, servicios de push) procesan **por cuenta de
  TransTech**: para Google eso no es "compartir".
- Cifrado en tránsito: **sí**. Borrado a pedido: **sí**, desde el Perfil y en
  <https://www.transtech.com.py/eliminar-cuenta>.

## App Store — App Privacy

Para cada tipo marcado: *Linked to the user* = Sí · *Used for tracking* = No.

| Categoría de Apple | Tipo | ¿Se recoge? | Propósitos | De dónde sale |
|---|---|---|---|---|
| Contact Info | Name | Sí | App Functionality | registro |
| Contact Info | Email Address | Sí | App Functionality | registro, correos del servicio |
| Contact Info | Phone Number | Sí | App Functionality | WhatsApp vinculado (opcional) |
| Contact Info | Physical Address / Other | No | | |
| Financial Info | Payment Info | **No** | | la tarjeta la procesa Bancard, fuera de la app (ver supuesto) |
| Financial Info | Credit Info | No | | |
| Financial Info | Other Financial Info | Sí | App Functionality | ingresos, gastos, deudas, cuentas que carga la persona |
| Location | Precise / Coarse | No | | |
| Sensitive Info | — | No | | |
| Contacts | — | No | | no se lee la agenda del teléfono; los clientes que carga la persona van en "Other User Content" |
| User Content | Emails or Text Messages | Sí | App Functionality | conversaciones con EOS |
| User Content | Photos or Videos | Sí | App Functionality | fotos y videos enviados al chat |
| User Content | Audio Data | Sí | App Functionality | audios enviados al chat (se transcriben) |
| User Content | Customer Support | Sí | App Functionality | formulario de soporte |
| User Content | Other User Content | Sí | App Functionality | ventas, compras, productos, clientes y proveedores, documentos subidos |
| Browsing / Search History | — | No | | |
| Identifiers | User ID | Sí | App Functionality | id de la cuenta |
| Identifiers | Device ID | Sí (conservador) | App Functionality | identificador de notificaciones push, si las activa |
| Purchases | Purchase History | Sí | App Functionality | historial de suscripciones |
| Usage Data | Product Interaction | Sí | App Functionality, Analytics | cantidad de mensajes y acciones |
| Usage Data | Advertising Data / Other | No | | |
| Diagnostics | Crash Data | No | | no hay SDK de errores en la app |
| Diagnostics | Performance Data | Sí | App Functionality, Analytics | tiempo de respuesta por mensaje |
| Diagnostics | Other Diagnostic Data | Sí | App Functionality | errores del servidor ligados a un pedido |
| Other Data | — | No | | |

## Google Play — Seguridad de los datos

Preguntas generales:

- ¿La app recoge o comparte datos de los tipos requeridos? **Sí.**
- ¿Los datos se cifran en tránsito? **Sí.**
- ¿Ofrecés una forma de pedir que se borren? **Sí.** URL:
  `https://www.transtech.com.py/eliminar-cuenta`.
- ¿Compartís datos con terceros? **No** (solo proveedores que procesan por
  cuenta de TransTech).

Tipos recogidos (todos: **recogido, no compartido, procesamiento no efímero,
propósito: funcionalidad de la app**; los marcados con † también
**estadísticas**):

| Categoría de Google | Tipo | Obligatorio u opcional |
|---|---|---|
| Información personal | Nombre | Obligatorio |
| Información personal | Dirección de correo | Obligatorio |
| Información personal | ID de usuario | Obligatorio |
| Información personal | Número de teléfono | Opcional (WhatsApp) |
| Información financiera | Historial de compras | Obligatorio (si se suscribe) |
| Información financiera | Otra información financiera | Opcional |
| Mensajes | Otros mensajes en la app | Obligatorio |
| Fotos y videos | Fotos · Videos | Opcional |
| Archivos de audio | Grabaciones de voz o sonido | Opcional |
| Archivos y documentos | Archivos y documentos | Opcional |
| Actividad en la app | Interacciones con la app † | Obligatorio |
| Actividad en la app | Otro contenido generado por el usuario | Opcional |
| Información y rendimiento de la app | Diagnóstico † | Obligatorio |
| ID del dispositivo u otros | ID del dispositivo u otros | Opcional (notificaciones) |

No se recogen: ubicación, contactos de la agenda, calendario, salud, navegación
web, búsquedas, apps instaladas, registros de fallas del dispositivo.

## Qué revisar antes de enviar

1. Que `/privacidad` siga diciendo lo mismo (fecha del encabezado).
2. La decisión de cobro dentro de la app (app-02): si se cobra adentro, Apple
   pide revisar "Payment Info" y Google "Información de pago".
3. Si se agrega un SDK a la app nativa (errores, analítica), sumar lo que
   recoge: Crash Data / Registros de fallas.
