# La app nativa y las tiendas

Estado: **28 de septiembre de 2026**. Lanzamiento en iOS y Android el mismo día,
con el D-U-N-S esperado para el 1 de octubre. Este documento dice qué hace la
app hoy, qué exigen las tiendas y qué falta, en orden.

## Cómo es la app

La app es el proyecto de Capacitor del repo (`capacitor.config.ts`, `android/`).
No empaqueta la web: carga `https://transtech.com.py/eos/chat` en un WebView.
Eso tiene dos consecuencias que hay que tener presentes siempre:

1. **Cada despliegue de la web cambia la app sin pasar por la revisión de la
   tienda.** Ver la regla del final.
2. **La web tiene que saber cuándo está dentro de la app.** Lo sabe por la marca
   `EOSApp/1` que Capacitor agrega al user agent (`appendUserAgent`) y por el
   puente de Capacitor. La decisión vive en un solo lugar:
   `lib/app-nativa/plataforma.ts`.

## Lo que exigen las tiendas y cómo se cumple

| Regla | Qué dice | Cómo se cumple |
| --- | --- | --- |
| Apple 3.1.1 y 3.1.3 | Fuera de EE. UU., una app no puede vender funciones por fuera de la compra dentro de la app, ni tener botones o enlaces que lleven a pagar afuera. | La app **no muestra precios, planes ni pagos**. El proxy redirige `/planes` y `/pago` al chat cuando el user agent es el de la app, y `SoloEnWeb` esconde cada botón que llevaba a planes. Los mensajes de cupo no invitan a comprar (`lib/eos/mensaje-cupo.ts`). EOS se contrata en la web. |
| Google Play, pagos | Los servicios de software dentro de la app se cobran con Google Play Billing. | Igual que arriba: la app no vende nada. |
| Apple 4.2 | La app tiene que ser más que un sitio empaquetado. | **Pendiente**: notificaciones push nativas, “Compartir con EOS”, permisos nativos de micrófono y cámara. Ver “Qué falta”. |
| Apple 4.8 | Si hay Google, también tiene que estar Sign in with Apple. | Los dos botones existen (`lib/auth/proveedores.ts`) y salen cuando el proveedor está configurado en Supabase. |
| Google, OAuth | Google bloquea su inicio de sesión dentro de un WebView embebido (`disallowed_useragent`). | En la app, el inicio con Google o Apple se abre en el navegador del sistema y vuelve por `com.transtech.eos://auth/callback`. Ver “Inicio de sesión”. |
| Apple 5.1.1(v) y Google | Se tiene que poder borrar la cuenta desde la app, y Google además pide una URL pública para pedirlo. | **Hecho**: "Eliminar cuenta" en Perfil (no está dentro de `SoloEnWeb`, se ve en la app) y la URL pública `https://www.transtech.com.py/eliminar-cuenta`. |
| Google, IA generativa | Una app con IA generativa tiene que dejar reportar una respuesta ofensiva sin salir de la app. | **Hecho (01/10)**: botón "Reportar" en cada respuesta (`ReportarRespuesta.tsx` → `/api/eos/reportar` → `eos_reportes_respuesta_v230` + correo al dueño). |

La opción de vender con la compra dentro de la app de cada tienda sigue abierta.
Si se elige, `SoloEnWeb` y la regla del proxy son los únicos lugares que hay que
tocar.

## Inicio de sesión con Google y Apple

1. En la app, `LoginForm` pide a Supabase la URL del proveedor con
   `skipBrowserRedirect` y `redirectTo = com.transtech.eos://auth/callback?next=…`.
2. La abre en el navegador del sistema (plugin `Browser`: SFSafariViewController
   en iPhone, Custom Tabs en Android).
3. Google o Apple devuelven a Supabase, y Supabase a
   `com.transtech.eos://auth/callback?code=…`. El sistema reabre la app.
4. `PuenteAppNativa` (montado en `app/layout.tsx`) recibe el enlace (plugin
   `App`, evento `appUrlOpen`) y navega el WebView a
   `/auth/callback?code=…&next=…`. Ahí está la cookie con el verificador PKCE,
   así que el intercambio lo hace `app/auth/callback/route.ts` como siempre.

Mientras los plugins no estén instalados en la app, `puedeAbrirNavegadorDelSistema()`
da `false` y el inicio sigue el camino web de siempre.

## Estado al 1 de octubre de 2026

Hecho desde el repo:

- Íconos y pantalla de inicio de TransTech (emblema sobre azul noche
  `#020817`) para Android e iOS, generados desde `assets/` con
  `npx @capacitor/assets generate`. El ícono adaptativo de Android va sin
  inset (el primer plano ya respeta la zona segura). El ícono de 1024 de iOS
  no tiene transparencia, como pide App Store. **La fuente es de 512 px**: si
  hay un logo en mayor resolución o vectorial, reemplazar `assets/*.png` y
  volver a generar.
- Plugins `@capacitor/app` y `@capacitor/browser` instalados y sincronizados.
- Proyecto de iOS creado (`ios/`, Swift Package Manager, sin CocoaPods) con
  `Info.plist`: esquema `com.transtech.eos`, textos de micrófono, cámara y
  fotos, y `ITSAppUsesNonExemptEncryption = NO`.
- Workflow `app-nativa` (GitHub Actions): compila Android (deja un APK de
  prueba para instalar en un teléfono) e iOS para el simulador, sin firma.
- Botón para reportar respuestas (política de IA de Google Play).

## Lo que tenés que hacer vos (no se puede desde una sesión de Code)

1. **Permitir la vuelta a la app en Supabase.** Authentication → URL
   Configuration → Redirect URLs: agregar `com.transtech.eos://auth/callback`.
   Sin esto, Supabase rechaza el `redirectTo` de la app (inicio con Google y Apple).
2. **Cuentas de las tiendas**: Apple Developer (organización, con el D-U-N-S)
   y Google Play Console (organización).
3. **Firma**: en Apple, el equipo y el perfil de distribución en Xcode (o en un
   servicio de compilación en la nube); en Google, la clave de subida
   (`upload keystore`) y Play App Signing.
4. **Probar en teléfonos reales** (ver “Cómo probar”). El APK de prueba de
   Android sale del workflow `app-nativa` (artefacto `eos-android-debug`).

## Cómo probar en un teléfono

- Abrir la app sin sesión: tiene que ir a `/login`, no a una pantalla en blanco.
- Iniciar sesión con Google y con Apple: se abre el navegador del sistema y vuelve a la app con la sesión iniciada.
- Recorrer Perfil, Negocio, CRM, Finanzas y Mis funciones: **no tiene que aparecer ningún botón a planes ni ningún precio**.
- Escribir `transtech.com.py/planes` en un enlace dentro de la app: tiene que volver al chat.
- Llegar al límite de mensajes del plan gratis: el mensaje no nombra “Planes”.
- Poner el modo avión y abrir la app: aparece “No hay conexión”; al volver la señal, entra sola al chat.
- En el navegador del teléfono (no en la app), todo lo anterior tiene que seguir como antes.

## Qué falta, en orden

Hecho en esta vuelta (rama `feat/app-tiendas-cierre`):

- **Barra de estado en los dos temas**: `lib/app-nativa/barra-de-estado.ts` decide el estilo (texto claro sobre fondo oscuro, y al revés) y `BarraDeEstadoNativa` lo aplica y lo sigue si cambia el tema del teléfono. Plugin `@capacitor/status-bar`.
- **“Compartir con EOS” en Android, solo texto**: el intent filter `SEND` con `text/plain` (en `AndroidManifest.xml`) entrega el texto a `CompartirRecibidoPlugin.java`. Si el chat todavía no está listo (por ejemplo, hay que iniciar sesión), el texto queda retenido hasta que el chat lo toma. `ChatView` lo agrega a la caja del chat **sin enviarlo**.

Pendiente:

1. Notificaciones push nativas (APNs y FCM), pedidas después del primer momento de valor. Falta el cliente (registro del token, pantalla de permiso) y la tabla de dispositivos. El envío necesita las claves APNs y FCM del dueño.
2. “Compartir con EOS” con **imágenes y comprobantes** (Android) y **en iOS**: iOS necesita una extensión de Share en el proyecto de Xcode, y hay que probarla en un Mac o con CI.
3. Enlaces universales para los correos (verificación, resumen del lunes). Plantilla en `docs/app-nativa/enlaces-universales.md`: no se publica hasta tener el Team ID de Apple y la huella del certificado de firma de Android.

## Regla para lo que se despliega sin pasar por la tienda

Como la app carga la web, un despliegue cambia la app al instante. **No se
cambian sin volver a enviar la app a revisión**:

- nada que vuelva a mostrar precios, planes o pagos dentro de la app;
- los permisos que se piden y para qué;
- lo declarado en las etiquetas de privacidad (qué datos se recogen y con quién se comparten);
- el inicio de sesión (proveedores disponibles).
