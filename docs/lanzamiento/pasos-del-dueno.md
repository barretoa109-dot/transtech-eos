# Lo que tiene que hacer Augusto para declarar GO

Todo lo que se podía hacer con código está hecho y subido en la rama
`claude/eos-production-go-audit-pgqhq4`. Lo que queda necesita tu mano:
credenciales, producción o un teléfono. En orden, y cada paso dice cómo saber
que salió bien.

## A. Obligatorio (sin esto no hay GO)

### 1. Unir la rama a `main` (5 min)
Abrir el PR de `claude/eos-production-go-audit-pgqhq4` contra `main` y unirlo
cuando el CI (evals, tsc, lint, migraciones) esté en verde. Vercel despliega
solo.

**Salió bien si:** Vercel muestra el deploy de producción en *Ready*.

### 2. Aplicar las migraciones pendientes (5 min)
Desde una carpeta limpia, **después** de unir:

```bash
git checkout main && git pull
npx supabase migration list --linked   # mirar qué falta: al menos v192–v197
npx supabase db push
```

La v197 es la que impide que alguien se asigne un plan pago desde el
navegador y enciende la protección por cuenta en las 40 tablas heredadas. Es
idempotente: correrla dos veces no rompe nada.

**Salió bien si:** `migration list` muestra `local` y `remote` iguales.

### 3. Railway / n8n: que hable con producción (2 min)
En el servicio de n8n en Railway, variable
`EOS_APP_BASE_URL=https://www.transtech.com.py` y reiniciar el servicio.
(La lista maestra registra que apuntaba a un preview de hace 185 commits).

### 4. Correr el verificador de GO (2 min)
En `.env.local` de tu PC (nunca en el repo), las tres variables:

```
SUPABASE_ACCESS_TOKEN=...   # el mismo que usás para `npm run columnas`
CRON_SECRET=...             # el de Vercel
EOS_WORKER_GATE_SECRET=...  # el de Vercel (el mismo que usa n8n)
```

```bash
npm run go
```

**Salió bien si** termina con `RESULTADO AUTOMÁTICO: GO`. Si algo sale en
`FALLA`, pegame la salida completa (no tiene secretos) y lo arreglo.

### 5. Certificación de cobros con Bancard staging (15 min)
```bash
npm run certificar -- 3 6 11
```
Cobro, vencimiento y reversión. Si un caso sale amarillo (`··`), esperar 5
minutos y repetir ese caso: Bancard bloquea el mismo importe en la misma
tarjeta durante 5 minutos.

### 6. Prueba en teléfono (20 min)
En un iPhone (Safari) y un Android (Chrome), con una cuenta nueva:

1. Registrarse, entrar al chat, mandar "Vendí 3 tornillos a 1.500 cada uno".
   Ver que aparezca en Negocios.
2. Micrófono: tocarlo, **negar** el permiso → el botón vuelve a normal y se
   puede escribir. Darle permiso, dictar, tocar de nuevo para cortar,
   escribir a mano después.
3. Salir de la sesión, entrar desde la computadora: la conversación sigue.
4. Instalar como app (PWA) y abrirla.
5. Con una **segunda** cuenta: no tiene que ver nada de la primera.

Anotar fecha y resultado al final de `production-go-2026-09-24.md`.

**Con A.1 a A.6 en verde se declara GO oficial.**

## B. Externo, en paralelo (no bloquea un piloto; sí la venta abierta)

| Qué | Por qué | Documento |
|---|---|---|
| Bancard en producción | Sin esto se cobra solo en staging o por transferencia | `estrategia/bancard-produccion-seguimiento.md` |
| Supabase Pro + PITR (≈ USD 125/mes) | Hoy una pérdida de datos se recupera con el respaldo diario, no al minuto | `estrategia/costo-upgrade-infraestructura.md` |
| Meta / WhatsApp Business | Hoy el WhatsApp de empresa recibe pero no envía | `estrategia/whatsapp-business-checklist.md` |
| Abogado (términos y privacidad) | Se cobra y se guardan datos financieros | `estrategia/revision-legal-brief.md` |

## C. Opcional: que yo pueda verificar producción sin vos

Hoy este entorno de trabajo no tiene salida de red a `www.transtech.com.py`
ni a `api.supabase.com`. Si querés que corra `npm run go` yo mismo en la
próxima sesión:

1. En la configuración del entorno (menú del entorno en la barra de título de
   la sesión → *Edit*): **Network access**, agregar `www.transtech.com.py`,
   `api.supabase.com` y `vpos.infonet.com.py`.
2. En la misma pantalla, como variables de entorno: `SUPABASE_ACCESS_TOKEN`,
   `CRON_SECRET` y `EOS_WORKER_GATE_SECRET`. **No las pegues en el chat.**

Una sesión nueva las toma.
