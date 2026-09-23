# Brief para revisión legal (punto 4 del plan de fortalecimiento)

**Para entregar directamente a un abogado paraguayo.** No sustituye la
revisión profesional — al contrario, junta en un solo lugar las preguntas
concretas que ya aparecieron trabajando el producto, para que la revisión
sea eficiente y no empiece de cero.

## 1. Privacidad y términos (`/privacidad`, `/terminos`)

Ya escritos y publicados (`app/login/page.tsx` enlaza a ambos desde
2026-08-21), describen el sistema real: proveedores con ubicación (Supabase
US, Vercel, Resend sa-east-1, OpenAI, Railway, Bancard PY), qué se guarda y
qué no (el cuerpo de los avisos bancarios no se guarda, el número de tarjeta
nunca llega a nuestros servidores), y una sección explícita de que "EOS
puede equivocarse" y el disponible real es estimación, no estado de cuenta.

**Preguntas concretas para el abogado:**

- ¿El contenido actual es suficiente bajo la Ley 6534/2020 de Protección de
  Datos Personales de Paraguay, o falta alguna cláusula obligatoria?
- ¿Nombre + correo alcanzan como identificación del titular de los datos, o
  hace falta pedir RUC/cédula para cumplir alguna obligación específica?
- Los datos financieros que EOS interpreta (movimientos, deudas, ingresos)
  ¿caen en alguna categoría de dato sensible bajo la ley paraguaya que exija
  un tratamiento distinto del que ya tienen?

## 2. Cláusula de "uso razonable" para los planes sin tope de mensajes

El plan "EOS Conversacional" (Gs. 60.000/mes) se vende explícitamente **sin
tope visible de mensajes** — es la promesa central del plan. Internamente
hay una alarma a los 400 mensajes/mes (correo interno, no restricción al
usuario), calibrada contra el costo real de IA por mensaje (~USD 0,02-0,07).
Falta la cláusula contractual que permita, en el caso extremo de una cuenta
muy por encima de ese uso normal, tener una base legal para conversar con
esa cuenta sin que sea un incumplimiento de "sin tope" de nuestro lado.

**Pregunta concreta:** redactar una cláusula de "uso razonable" que sea
compatible con la promesa comercial de "nunca te quedás sin poder operar" —
es decir, que no le dé a EOS la posibilidad de cortar el servicio sin aviso,
pero sí la de tener una conversación comercial con una cuenta de uso
extremo antes de que la relación se vuelva estructuralmente deficitaria.

## 3. Retención de datos de facturación al borrar una cuenta

Encontrado y corregido a nivel código el 2026-09-19: `/privacidad` promete
conservar "los registros de facturación que la ley obliga", pero el borrado
de cuenta borraba también los cobros ya acreditados. Ahora esos registros
se copian a una tabla separada antes de borrar el resto de la cuenta.

**Pregunta concreta, sin resolver:** ¿cuál es el plazo legal de conservación
de esos registros de facturación en Paraguay? El código hoy los conserva
indefinidamente por default, a falta de una cifra — hace falta la cifra
real para poder programar un borrado automático después de ese plazo.

## 4. Facturación electrónica (SIFEN) — cuando el usuario de EOS le factura a SUS clientes

Distinto del cobro que TRANSTECH le hace a sus propios clientes (eso pasa
por Bancard con timbrado de TRANSTECH). Esta parte es el módulo de negocio
donde el usuario de EOS emite SU PROPIA factura electrónica, con su propio
RUC y certificado.

**Estado:** numeración con secuencia y CDC de 44 dígitos con dígito
verificador ya construidos y con tests. Falta: firma con el certificado
digital del contribuyente y envío a SIFEN — ambos dependen de que cada
usuario contrate su propio certificado ante un prestador habilitado y
habilite su RUC ante la SET, no de código.

**Preguntas concretas:**
- ¿El estado `borrador` (documento no firmado todavía) que muestra hoy la
  pantalla es lo correcto para no exponer al usuario a un riesgo de emitir
  algo que la SET todavía no reconoce como factura válida?
- ¿Hay alguna responsabilidad de TRANSTECH como proveedor del software si
  un usuario emite un CDC mal calculado antes de contrastarlo contra el
  ambiente de prueba de SIFEN? (Ya hay una regla interna de no pasar a
  producción sin ese contraste — confirmar si alcanza legalmente.)

## 5. Borrado de cuenta y datos que EOS no puede borrar

El borrado de cuenta (`EliminarCuenta` → función que recorre dinámicamente
73+ tablas) está probado y no deja huérfanos en la base propia. **Pero los
datos ya enviados a OpenAI como parte de las conversaciones no tienen, hoy,
ningún mecanismo de borrado del lado nuestro** — dependen de la política de
retención de OpenAI, fuera de nuestro control directo.

**Pregunta concreta:** ¿el texto actual de `/privacidad` deja suficientemente
claro este límite, o hace falta una mención explícita de que el proveedor de
IA subyacente tiene su propia política de retención independiente?

## 6. Contrato con Bancard / responsabilidad sobre pagos

No es una pregunta nueva de este documento, pero vale confirmarla junto con
las demás: si un cobro automático de renovación falla o se duplica (ya hay
protecciones técnicas — idempotencia verificada, `DuplicatePaymentError` de
Bancard), ¿los términos actuales cubren adecuadamente la relación entre
TRANSTECH, Bancard y el usuario final en ese escenario?

---

**Nota de proceso:** ninguna de estas seis preguntas bloquea el piloto
comercial controlado (3-10 cuentas conocidas, con seguimiento directo). Sí
deberían estar resueltas antes de abrir una campaña de adquisición pública,
que es donde el volumen hace que un problema legal pase de "conversación
con un cliente" a "exposición real".
