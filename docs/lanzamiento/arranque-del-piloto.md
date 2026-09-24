# Arranque del piloto: los cuatro pasos

**Fecha:** 24/09/2026. `npm run go` dio GO (9/9) ese día.

Hay dos casos:

- **Piloto:** de 3 a 5 clientes que el dueño conoce y puede atender en persona.
  Se puede arrancar con los pasos 1 y 3.
- **Abrir a cualquiera:** hace falta además el paso 4.

El paso 2 ya está hecho en el código.

A quién invitar, qué medir y cómo cerrar el piloto está en
`docs/estrategia/piloto-comercial-plan.md`. Este documento es lo operativo.

---

## 1. Enterarse en minutos si EOS se cae (10 min, una sola vez)

`/api/internal/salud` devuelve **200 si todo está sano y 503 si algo falla**:

- revisa la base, el chat de las cuentas reales, los cobros y avisos de pago,
  el correo, el briefing y los errores del servidor;
- sin el secreto no muestra ningún detalle, así que se puede dejar abierta.

Hoy solo la mira el cron diario. Un monitor externo gratuito la consulta cada
5 minutos y te avisa al celular.

**UptimeRobot (gratis, 50 monitores, cada 5 minutos):**

1. Entrá a uptimerobot.com, **Sign up**, y creá la cuenta con tu correo.
2. **Add New Monitor**, y cargá:
   - tipo: **HTTP(s)**;
   - nombre: `EOS salud`;
   - URL: `https://www.transtech.com.py/api/internal/salud`;
   - intervalo: **5 minutes**;
   - en *Alert contacts*, marcá tu correo.
3. Repetí el paso 2 para un segundo monitor:
   - nombre: `EOS sitio`;
   - URL: `https://www.transtech.com.py`.

   Si el primero avisa y este no, el sitio está arriba y lo que falla es una
   parte.
4. Instalá la app **UptimeRobot** en el celular, entrá con la misma cuenta y
   activá las notificaciones. Así el aviso te llega al teléfono y no solo al
   correo.

**Cuando llegue un aviso:**

1. Abrí `https://www.transtech.com.py/api/admin/salud` con tu sesión de
   administrador: dice qué chequeo falló.
2. Mandame esa captura.

Un chequeo "(informativo)" nunca dispara el aviso. El aviso sale solo cuando
algo está roto de verdad.

**Salió bien si** los dos monitores aparecen en verde (*Up*) a los 5 minutos.

---

## 2. Pedir ayuda desde cualquier pantalla (hecho)

El formulario de soporte ya existía, pero solo al fondo del Perfil. Ahora hay
un botón **Ayuda** arriba a la derecha en todas las pantallas del app,
incluido el chat.

- El mensaje llega a `soporte@transtech.com.py`.
- Trae quién es la persona, su plan, sus módulos, **en qué pantalla estaba** y
  su WhatsApp si lo cargó.
- Si el envío falla, la pantalla le muestra el correo para escribir directo.

**Durante el piloto:** revisá `soporte@` todos los días y contestá el mismo
día. Con 3 a 5 personas, una respuesta rápida pesa más que cualquier función
nueva.

Por WhatsApp no hay un botón. Si alguien escribe "quiero hablar con una
persona", lo contesta el modelo. Conviene decirle a cada cliente del piloto,
desde el primer día, que te escriba directo a tu número.

---

## 3. El piloto, día por día

### Antes de invitar

- [ ] Paso 1 hecho (el monitor).
- [ ] La prueba en el celular del checklist de GO, incluida la de imágenes por
      WhatsApp: una foto de un pedido y después "sumale el envío a cada uno".
- [ ] El consentimiento para citarlos, por escrito (un WhatsApp alcanza).

### Día 1 de cada cliente

Mandale un mensaje personal, no solo el automático. Por ejemplo:

> Hola [nombre], ya tenés tu cuenta de EOS. Para arrancar, mandale por
> WhatsApp la primera venta que hagas hoy, tal cual se la contarías a alguien:
> "vendí 2 camperas a 230 mil". Si algo no te sale o no te entiende, escribime
> directo a este número y lo vemos juntos.

### Todos los días (5 minutos)

```powershell
npm run piloto
```

Lista las cuentas reales, **las urgentes primero**, con su contacto:

| Estado | Qué significa | Qué hacer |
|---|---|---|
| `INTERVENIR` | Pasaron más de 24 h desde el alta y EOS todavía no le hizo nada útil | Llamalo o escribile hoy |
| `REVISAR` | Esta semana tuvo tantos pedidos con error como bien, o más | Preguntale qué quiso hacer y mandame la captura |
| `SE ENFRIÓ` | Usaba EOS y no escribe hace 3 días o más | Un mensaje corto: "¿cómo venís con EOS?" |
| `nueva` / `ok` | Todo en orden | Nada |

Lee producción sin escribir nada. Usa el mismo `SUPABASE_ACCESS_TOKEN` de
`npm run go`.

### Una vez por semana

- `npm run go`: tiene que seguir en GO.
- **Vercel, Logs:** buscá `"solo_memoria":true`. Cada línea es un pedido que
  terminó como nota en vez de hacerse. Mandame los textos: cada uno es un caso
  que EOS tiene que aprender.
- Juntá una frase de cada cliente sobre qué le resolvió (sirve para el sitio).

### Cierre (a la semana o a las dos)

Cuántos llegaron a una acción el primer día y cuántos siguen escribiendo a
los 14 días. El criterio para comparar está en `piloto-comercial-plan.md`,
sección "Duración y cierre".

---

## 4. Respaldos: la decisión antes de abrir a más gente

**Cómo estamos hoy:** Supabase en el plan gratuito, que no tiene copias
automáticas ni permite volver a un punto anterior en el tiempo (PITR). Si una
tabla se borra o se corrompe, no hay de dónde recuperarla.

**Qué hace falta y cuánto cuesta** (detalle en
`docs/estrategia/costo-upgrade-infraestructura.md`):

| Opción | Costo | Qué te da |
|---|---|---|
| Supabase **Pro** | USD 25/mes | Copia diaria automática (7 días), protección de contraseñas filtradas |
| Pro + **PITR** | USD 125/mes | Volver la base a cualquier minuto de los últimos 7 días |
| Vercel **Pro** | USD 20/mes | Crons más frecuentes (en Hobby, uno por día) y builds sin cola. Hobby es para uso no comercial |

**Recomendación:**

- **Supabase Pro ya, al arrancar el piloto.** Sin eso, un error deja a los
  clientes sin sus datos.
- **PITR** cuando haya suscripciones pagas activas.
- **Vercel Pro** antes de cobrarle a alguien. Es la condición de uso comercial
  y permite conciliar los pagos cada pocos minutos en vez de hasta 24 h
  (después de subir de plan hay que cambiar el horario del cron en
  `vercel.json`; eso lo hago yo).

### Mientras tanto: una copia diaria en tu PC (gratis, 5 min)

`npm run respaldo` baja todos los datos de `public` a
`C:\Users\galea\respaldos-eos\AAAA-MM-DD\`. Solo lee.

Para que corra todos los días a las 3 de la mañana (o apenas prendas la PC, si
estaba apagada), pegá esto **una vez** en PowerShell:

```powershell
New-Item -ItemType Directory -Force C:\Users\galea\respaldos-eos | Out-Null
$accion  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument '/c cd /d C:\Users\galea\transtech-eos && npm run respaldo >> C:\Users\galea\respaldos-eos\registro.txt 2>&1'
$cuando  = New-ScheduledTaskTrigger -Daily -At 3am
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName "EOS respaldo diario" -Action $accion -Trigger $cuando -Settings $ajustes -Description "Copia diaria de los datos de EOS (npm run respaldo)"
```

Para probarlo en el momento, sin esperar a las 3:

```powershell
Start-ScheduledTask -TaskName "EOS respaldo diario"
```

Al minuto tiene que aparecer la carpeta con la fecha de hoy en
`C:\Users\galea\respaldos-eos\`.

Limitaciones de esta copia:

- **No reemplaza al plan pago.** Solo corre si la PC está prendida, no incluye
  las cuentas de acceso (`auth.users`) y la restauración nunca se ensayó (ver
  `docs/rollback-runbook.md`).
- **Tiene datos personales de los clientes sin cifrar.** No la subas a ningún
  lado.
- Cada copia pesa decenas de MB. Borrá las de hace más de un mes, de vez en
  cuando.
- Para sacarla: `Unregister-ScheduledTask -TaskName "EOS respaldo diario"`.
