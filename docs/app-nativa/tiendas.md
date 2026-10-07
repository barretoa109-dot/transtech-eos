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

**Notificaciones push en Android (06/10, PRs #233-#240):** el cliente registra el
token (`lib/push/nativo.ts`), la tabla `dispositivos_push` lo guarda por persona
(v233) y el envío usa FCM HTTP v1 (`lib/push/fcm.ts`). Los avisos de agenda ya
llegan a la app Android. Esto estaba listado como pendiente en una versión
anterior de este documento; ya no lo está. Falta probarlo en un teléfono real
(ver "Cómo probar") y confirmar que la clave de servicio de Firebase esté
cargada en el entorno de producción, algo que no se ve desde una sesión de Code.

**Notificaciones push en iOS (07/10, rama `docs/ficha-app-store`):** el
cliente (`lib/push/cliente.ts`) ya era genérico para las dos plataformas; lo
que faltaba era el lado nativo y el envío. Ahora:

- `ios/App/App/AppDelegate.swift` reenvía el token (o el error) de
  `didRegisterForRemoteNotificationsWithDeviceToken` a Capacitor, como pide
  el plugin `@capacitor/push-notifications` (ya estaba en `package.json` y
  sincronizado en `ios/App/CapApp-SPM/Package.swift`, pero sin esto el
  `register()` de la app nunca recibía el token).
- `ios/App/App/App.entitlements` declara `aps-environment` y está conectado
  en `project.pbxproj` (`CODE_SIGN_ENTITLEMENTS`) para Debug y Release. Sin
  esto, Xcode no deja activar push aunque el código esté todo.
- `capacitor.config.ts` suma `presentationOptions` para que un aviso se vea
  también si la persona está con la app abierta (sin esto, iOS no muestra
  nada en primer plano; Android sí, por su cuenta).
- El envío: `lib/push/apns.ts` (token de proveedor ES256, HTTP/2 directo con
  `node:http2` porque el API de APNs no acepta HTTP/1.1) y `lib/push/nativo.ts`
  ahora reparte cada aviso entre FCM (Android) y APNs (iOS) según la
  plataforma guardada en `dispositivos_push`, en vez de filtrar solo Android.

Apagado sin configuración, igual que FCM: sin `APNS_TEAM_ID`, `APNS_KEY_ID` y
`APNS_CLAVE_PRIVADA` no se consulta ni se envía nada por este lado.

Pendiente, y esto sí necesita al dueño o un iPhone:

1. La clave APNs (`.p8`, Team ID, Key ID) de Apple Developer — depende de que
   la cuenta de la organización termine de verificarse. Sin ella, `lib/push/apns.ts`
   queda apagado solo, como pasaba con FCM antes del 06/10.
2. Probarlo de punta a punta en un iPhone o el simulador de Xcode: pedir el
   permiso, registrar el token, y que un aviso de agenda llegue de verdad.
   Nunca se probó, ni con el simulador (`CODE_SIGNING_ALLOWED=NO` del CI no
   alcanza para push: necesita firma real).
3. Enlaces universales para los correos (verificación, resumen del lunes). Plantilla en `docs/app-nativa/enlaces-universales.md`: no se publica hasta tener el Team ID de Apple y la huella del certificado de firma de Android.

**“Compartir con EOS” en iOS (07/10, rama `docs/ficha-app-store`):** en Android
ya mandaba texto **e imágenes** (PR `8a56c076`, "también imágenes y
comprobantes"); en iOS no había nada. Una Share Extension corre en un proceso
separado del de la app — Apple no deja que abra ni avise directamente a la
app contenedora (confirmado por un ingeniero de Apple en el foro de
desarrolladores: <https://developer.apple.com/forums/thread/824630>) —, así
que el camino no es igual al de Android:

- **Target nuevo `ShareExtension`** (`ios/App/ShareExtension/`), agregado a
  `project.pbxproj` a mano con la librería `xcode` (la misma que usa
  Capacitor/Cordova para esto), porque esta sesión no tiene Xcode para
  hacerlo con la interfaz. `ShareViewController.swift` acepta texto o una
  imagen (mismo límite de 8 MB que `CompartirRecibidoPlugin.java`), lo
  guarda como JSON en el contenedor de un App Group
  (`group.com.transtech.eos`) y termina. No hay UI más allá de "Enviando a
  EOS…": no hace falta que la persona confirme nada.
- **`ios/App/App/CompartirRecibidoPlugin.swift`**: un plugin de Capacitor
  nuevo (no viene de npm) con el mismo nombre y el mismo evento que el de
  Android (`CompartirRecibido` → `compartido`, con `{ texto }` o
  `{ archivo: { nombre, mime, base64 } }`), así que `ChatView.tsx` no
  necesitó ningún cambio. Como la extensión no puede avisarle a la app
  directamente, el plugin revisa el contenedor del App Group cada vez que
  la app vuelve a primer plano, no solo al arrancar.
- Los plugins que viven en el proyecto (no en un paquete npm) hay que
  registrarlos a mano: `ios/App/App/BridgeViewController.swift` es un
  `CAPBridgeViewController` que lo hace en `capacitorDidLoad()`, y
  `SceneDelegate.swift` ahora lo usa en vez del `CAPBridgeViewController`
  de siempre.
- `App.entitlements` y el nuevo `ShareExtension.entitlements` declaran el
  mismo App Group, para que los dos procesos vean el mismo contenedor.

Pendiente, y depende del dueño o de un Mac:

1. Crear el App Group `group.com.transtech.eos` en Apple Developer y
   asignarlo a los dos identificadores de la app (`com.transtech.eos` y
   `com.transtech.eos.compartir`) — sin esto, los entitlements no significan
   nada.
2. Abrir el proyecto en Xcode al menos una vez: todo lo de arriba se armó
   editando `project.pbxproj` con una librería, nunca se abrió en la
   interfaz. Si algo quedó mal armado (un ajuste que Xcode normalmente pone
   solo al agregar un target desde la interfaz), ahí se nota enseguida.
3. Probarlo de punta a punta en un iPhone o el simulador: compartir texto y
   una foto desde Fotos o Safari, y confirmar que entra al cuadro del chat
   (o como adjunto, si es una imagen) la próxima vez que se abre EOS. Nunca
   se probó.

## Regla para lo que se despliega sin pasar por la tienda

Como la app carga la web, un despliegue cambia la app al instante. **No se
cambian sin volver a enviar la app a revisión**:

- nada que vuelva a mostrar precios, planes o pagos dentro de la app;
- los permisos que se piden y para qué;
- lo declarado en las etiquetas de privacidad (qué datos se recogen y con quién se comparten);
- el inicio de sesión (proveedores disponibles).
