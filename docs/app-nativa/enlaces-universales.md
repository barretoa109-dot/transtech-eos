# Enlaces universales (iOS) y de app (Android)

Plantilla para que un enlace a `https://www.transtech.com.py/...` (por ejemplo,
el de verificación de un correo) abra la app en vez del navegador. **No se
publica todavía**: los dos archivos piden datos que solo tiene el dueño.

## Qué falta antes de publicar

- **iOS**: el Team ID de Apple Developer (lo muestra la cuenta de la
  organización una vez aprobada). Va en `TEAMID`.
- **Android**: la huella SHA-256 del certificado de firma de la app
  (`upload keystore` y, después, la clave de Play App Signing). Va en
  `HUELLA_SHA256`.

## Archivos (cuando se tengan los datos)

Se publican en `public/.well-known/`, sin extensión en el primero:

`public/.well-known/apple-app-site-association`

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appIDs": ["TEAMID.com.transtech.eos"],
        "components": [
          { "/": "/auth/*" },
          { "/": "/verificar/*" }
        ]
      }
    ]
  }
}
```

`public/.well-known/assetlinks.json`

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.transtech.eos",
      "sha256_cert_fingerprints": ["HUELLA_SHA256"]
    }
  }
]
```

## Después de publicar

1. Abrir `https://www.transtech.com.py/.well-known/apple-app-site-association`
   y `.../assetlinks.json` en el navegador: tienen que responder el JSON sin
   redirección.
2. En iOS, la app tiene que declarar el dominio asociado (`applinks:www.transtech.com.py`)
   en Signing & Capabilities. Es un cambio en `ios/App`, en el mismo PR.
3. En Android, `AndroidManifest.xml` necesita un `intent-filter` con
   `android:autoVerify="true"` para `https://www.transtech.com.py`.
4. Probar con un correo real: el enlace tiene que abrir la app.

Las rutas de la plantilla (`/auth/*`, `/verificar/*`) son ejemplos. Hay que
ajustarlas a las que de verdad llegan por correo antes de publicar.
