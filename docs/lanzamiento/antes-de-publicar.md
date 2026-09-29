# Antes de publicar una versión

Lo que se corre y lo que se mira antes de mandar a producción un cambio grande
de la web, del chat o de la base, o una versión nueva de la app. Cada paso está
porque alguna vez faltó.

## 1. El PR

- [ ] `evals` en verde. Es obligatorio para mergear a `main` y corre: tests
      (incluido el SQL con PGlite), evals, tipos, lint con tope, migraciones,
      modo oscuro, rutas con dueño, ámbito, grants y el build.
- [ ] Si toca el prompt o las acciones del chat: `npm run bateria` (las 51
      frases del cliente ideal). Tiene que dar 100 % de verbo correcto.
- [ ] Si agrega una acción nueva: está dada de alta en los **cuatro** lugares
      de n8n y en los tres `check` de la base (ver `docs/salida-de-n8n.md`). La
      cuarta, la lista `allowed` del worker, es la que se olvida y no da error.
- [ ] Si agrega una migración: la versión es posterior a la última de `main`,
      de las ramas abiertas y de producción (`npm run migraciones` ataja el
      choque dentro del repo; el resto hay que mirarlo). Si toca una función
      que otra migración ya parchó, se parcha en su lugar desde
      `pg_get_functiondef`, no se regenera desde un archivo.

## 2. Aplicar

- [ ] `C:\Users\galea\eos-db-push` en `origin/main` y **sin archivos sueltos**:
      `git fetch origin; git checkout --detach origin/main` tiene que decir
      `HEAD is now at`, no `Aborting`.
- [ ] `npx supabase db push --dry-run` lista exactamente las migraciones que se
      esperan. Recién ahí, sin `--dry-run`.
- [ ] Parches de n8n: `SECO=1` primero, después en serio, y en el mismo
      movimiento `node n8n/exportar.mjs` y el JSON en un PR.
- [ ] Vercel: el deploy de `main` quedó con el dominio. En Hobby se compila de
      a uno; si hay otro en cola, puede quedar "Ready" sin tomar
      `www.transtech.com.py` y hace falta *Promote to Production*.

## 3. Verificar en producción

- [ ] Actions → **deriva** → *Run workflow*: verde. Si queda rojo, producción no
      corre lo que está en `main`.
- [ ] `https://www.transtech.com.py/api/internal/salud` contesta `"sano": true`.
- [ ] Si tocó el chat: `npx tsx scripts/sonda-chat.mts "<mensaje>"` con un caso
      del cambio (gasta cupo de la cuenta de prueba y ejecuta acciones de
      verdad en ella).
- [ ] Si tocó una función de la base: llamarla contra producción dentro de una
      transacción que termina en `raise exception` y leer el resultado. El
      historial de migraciones puede decir "aplicada" y la función no tener el
      cambio.
- [ ] Si tocó cobros: `npm run certificar` (escribe en la base real, en la cuenta
      de certificación).

## 4. Versión nueva de la app (cuando esté en las tiendas)

- [ ] Todo lo anterior.
- [ ] Recorrido completo en un teléfono de verdad, por alguien que no la hizo:
      registro, vincular WhatsApp, primera venta, micrófono (permitir, negar,
      cancelar) y pago con 3DS.
- [ ] Las etiquetas de privacidad de las tiendas siguen diciendo lo mismo que
      `/privacidad`.

## 5. Después

- [ ] Al día siguiente: `npm run piloto` y el correo de la alerta, si llegó.
- [ ] Si algo se rompió: `docs/rollback-runbook.md`.
