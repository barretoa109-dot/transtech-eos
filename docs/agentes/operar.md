# Operar los agentes de EOS

Guía para el dueño. Esta primera versión cubre la infraestructura (v267); se
completa a medida que entra cada agente (paso 9 del plan).

## Prender y apagar un agente (sin deploy)

- Desde la web: **/admin/agentes** → botón *Apagar* / *Prender*.
- Desde la terminal: `npm run agentes -- apagar cobranza` (o `prender`).
- Ver todo de un vistazo: `npm run agentes -- estado`.

Rige al instante. Un agente apagado no manda nada, aunque estuviera a mitad de
una corrida: la base lo frena en cada mensaje (`agentes.autorizar_envio`).

Todos nacen **apagados y sin versión aprobada**.

## Aprobar un cambio de reglas o de prompts (regla 7)

La versión de cada agente es un hash de `agentes/reglas-comunes.md` y de todo
`agentes/<agente>/` (menos sus evals). Cualquier letra que cambie es otra
versión, y **la base no deja correr una versión que no aprobaste**: la corrida
no arranca y te llega un escalamiento urgente "Versión de reglas o prompt sin
aprobar".

1. El cambio llega por un PR. Leé el diff de `agentes/`. El PR no se puede
   mergear si las evals no pasan.
2. Mergealo. Vercel despliega.
3. Aprobá la versión desplegada: **/admin/agentes** → *Aprobar esta versión*
   (aparece solo si la desplegada no es la aprobada), o
   `npm run agentes -- aprobar <agente>` desde una carpeta en `origin/main`
   (se niega a aprobar desde una rama).

Cambiar `reglas-comunes.md` deja a los seis sin aprobar.

## Revisar escalamientos

- **Urgentes:** te llegan al momento por push a tu iPhone y por correo.
- **Normales:** un correo por día a las 18:00 de Asunción, solo si hay algo.
- Todos están en **/admin/agentes**, arriba de todo. *Marcar resuelto* los
  cierra; lo que escribas queda guardado (en Soporte, eso se va a proponer
  como entrada nueva de la base de conocimiento).
- El mismo caso abierto no se repite: si un agente lo vuelve a escalar, se
  junta con el que ya estaba.

## El tope semanal

4 mensajes por persona en 7 días, sumando todos los agentes **y los avisos
automáticos de siempre** (v268). Las respuestas de Soporte a una pregunta que
hizo la persona no cuentan; todo lo demás, sí. Se cambia en **/admin/agentes**
o con `npm run agentes -- tope 4`.

### Los avisos automáticos ("sistema")

Son el push de las tres franjas, el correo motivacional cada 3 días y los
correos de la primera semana. Desde la v268:

- Comparten el tope de 4, pero pueden usar **como mucho 2** (`npm run agentes
  -- tope-sistema 2`). El resto queda para los agentes, así un push de la
  mañana no le saca el lugar a un aviso de Cobranza.
- Lo motivacional (push y correo) sale **como mucho uno cada 3 días** por
  persona. Las tres franjas siguen existiendo, pero llega la primera que
  encuentra lugar, no las tres.
- **Apagar todo:** **/admin/agentes** → *Avisos automáticos* → *Apagar*, o
  `npm run agentes -- apagar sistema`.
- Ya no hay rachas: ni "7 días seguidos" ni "tu racha está en riesgo"
  (regla 4). El resumen del lunes sigue.

No pasan por el tope, porque frenarlos haría daño: lo transaccional (pagos,
confirmaciones, contraseña), la respuesta a algo que la persona escribió, el
briefing diario (lo pidió ella), sus recordatorios de agenda y los avisos de
riesgo de su plata ("no te alcanza para el 28").

## Darle conexión a un agente (una vez por agente, antes de prenderlo)

Cada agente entra a la base con su propio rol, sin la service role.

```
npm run agentes -- clave cobranza
```

Le da login al rol `agente_cobranza` con una clave nueva y te imprime la
cadena para cargar en Vercel como `AGENTE_COBRANZA_DB_URL`. La clave no queda
en ningún otro lado: si se pierde, se corre de nuevo (la anterior deja de
servir).

## Comprobar los permisos contra producción

```
npx supabase db query --linked -f supabase/pruebas/agentes_permisos_e2e.sql
```

Termina en `rollback`; no deja nada. Todas las filas tienen que dar `ok = true`.

## Lo que la base no puede cerrar

La extensión `pg_net` le da a PUBLIC uso del schema `net` y permisos sobre su
cola de pedidos HTTP (`net.http_request_queue`). Lo otorgó `supabase_admin`, y
`postgres` no lo puede revocar (probado el 27/11/2026). En la práctica, un rol
de agente *podría* encolar un pedido HTTP saliente.

Por qué no es un agujero hoy: el código de los agentes solo ejecuta
`select agentes.<función>(...)` con un nombre validado y parámetros
(`lib/agentes/conexion.ts`); ninguna salida de un modelo se convierte en SQL.
La prueba de permisos lo deja anotado y avisa si aparece cualquier otro acceso.
Para cerrarlo del todo hay que pedirle a Supabase que revoque ese grant.
