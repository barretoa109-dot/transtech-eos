# Developer Platform — diseño antes de tocar código (07/11/2026)

Punto 25 del documento EOS 2030 ("API pública, SDKs, webhooks"), elegido por
el dueño para dedicarle una sesión a diseñarlo en serio, mismo criterio que ya
se usó para multiagente (`docs/arquitectura-multiagente-2026-11-06.md`).

## 1. De dónde parte EOS hoy, medido

No es una opinión, son hechos de este repo:

- **No existe ninguna noción de "clave de API" por cuenta.** Lo único
  parecido es `EOS_WORKER_GATE_SECRET` (`lib/seguridad/worker-bearer.ts`): UN
  secreto compartido, igual para todas las cuentas, que autoriza a quien lo
  tiene a decir "actuá en nombre del `usuario_id` que te paso en el cuerpo".
  Ese diseño asume que quien llama es infraestructura propia y confiable
  (n8n, el runtime del agente) — nunca un tercero. Expuesto tal cual a un
  desarrollador externo, cualquiera con la clave podría leer o escribir en
  nombre de CUALQUIER cuenta, no solo la suya. No es una base sobre la que
  extender nada; hay que construir un mecanismo nuevo, de cero.
- **El repo es público** (`eos-produccion-escalable-2026-09-28`, verificado
  por API de GitHub) y ya hubo un incidente real de webhooks de n8n abiertos
  a cualquiera (`eos-decision-capture`, `eos-worker` legado), cerrado en el PR
  #161. Agregar una superficie pública nueva —a propósito, esta vez— no es
  gratis: cada endpoint es un candidato más a quedar mal cerrado, y ya se
  demostró que eso pasa en este proyecto si no se revisa con cuidado.
- **El modelo de acceso por módulos ya existe y es maduro**
  (`eos_modulos_anexos.md`, migración v63): `eos_tiene_modulo()` como única
  fuente de verdad, `exigirModulo()` en cada ruta, un catálogo con precio. Un
  nuevo módulo "developer" encajaría en esta misma arquitectura sin inventar
  una segunda forma de cobrar o de autorizar.
- **Todo lo que hoy ESCRIBE pasa por un solo camino, probado con incidentes
  reales**: `verificarAcciones` → `respuestaTrasVerificar` → la transacción
  atómica de `eos_execute_internal_effect_v64` → el trigger de
  `eos_auditoria_v60` (el mismo camino que el diseño de multiagente se negó a
  duplicar). Una API pública que escriba por su cuenta sería un SEGUNDO
  camino de escritura, exactamente el error que ese diseño evitó a propósito.
- **~7 cuentas pagas reales** (evaluación de accionista del 25/09, sin motivo
  para haber cambiado de orden de magnitud). El propio documento EOS 2030 es
  explícito: "si una tecnología no mejora la precisión, reduce trabajo,
  aumenta la seguridad o genera valor económico para el cliente, no merece
  prioridad solamente porque sea novedosa" — y el plan maestro ya aprobado
  dice que el cuello de la empresa es activación/distribución, no plataforma.

## 2. Quién usaría esto, en realidad — la pregunta que decide todo lo demás

"Developer Platform" en el documento imagina un ecosistema de terceros
construyendo sobre EOS. Con 7 cuentas, ese ecosistema no existe todavía. Lo
que sí podría existir, y es la pregunta que el dueño tiene que contestar antes
de seguir:

- **(a) El propio dueño de una PyME**, integrando su contador, su otro
  sistema de facturación, o una planilla, con los datos que YA tiene en EOS.
  Caso de uso real, chico, de bajo riesgo: lectura, no escritura.
- **(b) Un tercero construyendo un producto sobre EOS** (el ecosistema del
  documento). Caso de uso ambicioso, necesita soporte, documentación,
  versionado de la API, y clientes que lo PIDAN — hoy no hay evidencia de que
  nadie lo esté pidiendo.

Sin esta decisión, construir cualquier cosa es adivinar para quién.

## 3. Lo que sería irresponsable construir ahora

- **Cualquier endpoint de ESCRITURA expuesto directamente.** Ver punto 1: ya
  existe UN camino de escritura auditado; uno nuevo lo fragmenta. Si algún
  día hace falta que un desarrollador externo registre una venta, esa venta
  tiene que seguir entrando por el mismo camino de siempre (el mismo
  `eos_execute_internal_effect_v64`), nunca por una ruta nueva que lo evite.
- **Una clave de API que reciba el `usuario_id` en el cuerpo o en un
  parámetro.** Es exactamente el patrón que ya existe para n8n, y es seguro
  SOLO porque ningún tercero tiene el secreto. Para un tercero, el
  `usuario_id` tiene que salir de la clave misma (una fila en una tabla que
  mapea clave → cuenta), nunca de lo que el llamante diga que es.
- **Documentación y SDKs antes de tener un solo endpoint real y probado.**
  El documento pide "API pública, SDKs, webhooks" como si fueran del mismo
  tamaño; no lo son. Un SDK sin API estable detrás es trabajo que se
  reescribe en la primera versión.

## 4. Propuesta: un único endpoint de LECTURA, antes que cualquier otra cosa

Si la respuesta a la pregunta del punto 2 es "(a)", la pieza más chica y más
segura para probar el concepto:

```
Desarrollador (el dueño de la PyME, integrando su propio sistema)
        │
        ▼
  Clave de API nueva, propia, revocable (tabla eos_api_keys)
        │  (el usuario_id sale de ACÁ, nunca de lo que mande el llamante)
        ▼
  GET /api/v1/publico/<recurso>          ← solo lectura, Nivel 1 (observar)
        │
        ▼
  Los mismos datos que ya se le muestran en el panel — nunca un cálculo
  nuevo, nunca una acción, nunca una escritura.
```

- **Autenticación:** una tabla nueva `eos_api_keys` (`usuario_id`, hash de la
  clave —nunca la clave en texto plano, mismo criterio que una contraseña—,
  nombre que el usuario le puso, creada_en, revocada_en, último uso). La
  clave se muestra UNA sola vez al crearla, igual que cualquier proveedor
  serio (Stripe, OpenAI). Revocar es poner `revocada_en`, nunca borrar la fila
  (auditoría).
- **Autorización:** la clave resuelve a un `usuario_id` por una consulta a esa
  tabla; ese `usuario_id` es el único que la ruta usa, sin excepción. El
  módulo "developer" (nuevo, en el catálogo de `eos_modulos`) gatea el acceso
  con `exigirModulo`, igual que ERP y CRM.
- **Qué expone, para la primera versión:** 2 o 3 recursos de solo lectura que
  ya tienen un valor obvio para integrar con otro sistema —candidatos:
  ventas del día, saldo y próximos vencimientos, catálogo de productos—, cada
  uno la MISMA función que ya usa el panel, nunca un cálculo aparte (mismo
  criterio que ya aplica `lib/erp/cartera-leer.ts`: "dos números distintos
  para lo mismo hacen que la persona no le crea a ninguno").
- **Límites, desde el día uno:** rate limit por clave (un número bajo:
  nadie integra una planilla llamando cada segundo) y un tope de uso igual
  de silencioso que el resto de EOS (aviso interno al dueño de TransTech, no
  un freno visible — misma regla de CLAUDE.md).
- **Nivel de autonomía:** 1 (observar), el más bajo de todos. Ni siquiera
  "preparar y recomendar" — es mostrar lo que ya existe, a otro sistema en
  vez de a una pantalla.

## 5. Lo que esto explícitamente NO hace

- No crea un segundo camino de escritura, ni ahora ni en una fase futura sin
  rediscutirlo: una API de escritura es un proyecto de riesgo completamente
  distinto (requeriría decidir cómo se auditan acciones que no vienen de un
  chat ni de n8n, y cómo evitar que una clave filtrada registre compras
  falsas).
- No construye un SDK, ni documentación pública, ni un portal de
  desarrollador: sin un endpoint real y probado, son activos para mantener,
  no para usar.
- No asume que hay demanda de terceros (opción (b) del punto 2): esta
  propuesta sirve igual si la respuesta es "mi propio contador", que es el
  caso con evidencia real.

## Próximo paso

Esto no arranca escribiendo `eos_api_keys`. Antes hace falta que el dueño
conteste:

1. **¿(a) o (b) del punto 2?** Decide si esto vale la pena ahora o si es
   trabajo para cuando haya más cuentas (el documento mismo lo permite:
   "habrá que demostrarlo con clientes que paguen", no es una promesa de
   fecha).
2. **Si es (a): ¿qué 2-3 recursos de lectura tienen demanda real hoy?** No
   especular con una lista larga — un contador pidiendo "el saldo y las
   ventas del mes" es información real; una lista de "todo lo que el panel
   muestra" es la misma trampa que ya identificó el documento de multiagente
   (construir superficie porque se puede, no porque haga falta).
3. **¿Es un módulo pago (como ERP/CRM) o viene incluido?** Afecta si entra al
   catálogo de `eos_modulos` con precio o si se activa gratis para probar el
   concepto con el primer desarrollador real que lo pida.
