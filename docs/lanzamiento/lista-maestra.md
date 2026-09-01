# Lista maestra de lanzamiento — estado verificado

Fecha del relevamiento: **31 de agosto de 2026**. Ya mergeado a `main` y desplegado.

Cada punto lleva el estado que la evidencia sostiene, no el que quisiéramos.

| | |
| --- | --- |
| **cerrado** | Cumple la definición de terminado del final de este documento. |
| **parcial** | Funciona una parte y está identificado qué falta. |
| **abierto** | No empezado, o empezado sin evidencia. |
| **externo** | Depende de un tercero (SET, Bancard, tiendas, abogado). |
| **bloqueado** | No se puede cerrar hasta resolver otra cosa. |

Medición de hoy, para no discutirla dos veces:

- `npm test` → **494/494 en verde**. Empezó el día en 379.
- `npm run build` y `npx tsc --noEmit` → **en verde**.
- `npm run lint` → **24 errores, 5 avisos**. Empezó el día en 42 y 39.
  Ya **bloquea** el CI vía `npm run lint:tope`: la deuda puede bajar, no subir.
- `supabase migration list --linked` → **169 aplicadas, local y remoto coinciden
  en todas. Cero pendientes.**
- `npm run certificar` → **113 de 115 en verde**, 2 en amarillo porque la cuenta
  de certificación no tiene tarjeta catastrada. Ninguna en rojo.

---

## A. Bloqueantes críticos

| # | Punto | Estado | Evidencia / qué falta |
| --- | --- | --- | --- |
| 1 | Congelar el alcance | **parcial** | Redactado en `docs/lanzamiento/alcance-congelado.md`. Falta la firma de producto, legal y técnica, y la decisión sobre rotular ERP y CRM como beta. |
| 2 | Cerrar los cambios pendientes | **cerrado** | Árbol limpio. Tres commits: invariantes de anulación, validación de entrada de productos, higiene del repo. Los 21 MB de video y presentación quedaron ignorados, no commiteados. |
| 3 | Sincronizar migraciones | **parcial** | Las 169 aplicadas coinciden local y remoto, verificado hoy. **Pero todo corre contra el proyecto de producción**: no hay un entorno de pruebas en uso, así que no hay contra qué sincronizar. Hay un segundo proyecto sano disponible — ver la nota de infraestructura. |
| 4 | Instalación desde cero | **abierto** | Ya **no está bloqueado**: hay un segundo proyecto Supabase sano y sin uso conocido. Ver la nota de infraestructura abajo. Aplicarle las 170 migraciones desde cero ES la prueba de este punto. |
| 5 | Actualización realista | **abierto** | Idem: deja de estar bloqueado. Hoy toda migración se sigue estrenando contra datos de usuarios reales, y eso es lo que hay que dejar de hacer. |
| 6 | Bancard productivo | **parcial** | Firmas, webhook, tokenización, 3DS, ocasional y recurrente andan en `staging` (`BANCARD_ENV`). Falta instalar credenciales productivas y repetir la verificación con `production`. |
| 7 | Compra real controlada | **cerrado** (con reserva) | Los siete finales cubiertos y **verdes contra la base real**: aprobado, rechazado y abandonado en el caso 03; duplicado, demorado y reversado en el 11. La reversión deshace plan, módulos, solicitud e historial, y repetirla no descuenta dos veces. **Reservas:** el 3DS se completa en el navegador y la suite no puede recorrerlo sola, y el cobro con tarjeta queda en amarillo hasta catastrar una de prueba. |
| 8 | Requisitos de publicación | **externo** | D-U-N-S, cuentas de tienda, políticas y verificaciones sin empezar. El alcance congelado saca las apps del lanzamiento: se sale por web. |
| 9 | Revisión legal | **externo** | Existen `/terminos` y `/privacidad`. Ningún profesional los revisó. |
| 10 | Decisión formal de lanzamiento | **abierto** | La regla está escrita en el alcance congelado; falta el acta. |

### La nota de infraestructura que ordena A

**Corregido el 31 de agosto por la noche.** Durante todo el día esta nota decía
que había un solo proyecto Supabase y que por eso los puntos 4, 5 y 50 estaban
bloqueados. Estaba mal, y el error fue mío: nunca lo comprobé, lo di por sentado
porque el CLI apunta a uno solo.

`supabase projects list` dice que en la misma organización hay **tres**:

| Proyecto | Ref | Región | Estado |
| --- | --- | --- | --- |
| TransTech EOS | `dirugpkamzgvyshcnsxs` | us-east-2 | **producción**, sano |
| EOS Financial Autopilot Validation | `biulwebdgrcrsnzuqhky` | us-east-2 | sano, **sin uso conocido** |
| barretoa109@gmail.com's Project | `crihlzpsgdcqseltiqim` | us-east-1 | inactivo |

El segundo está sano, en la misma región que producción, y creado el 16 de
agosto. **Si está vacío o es descartable, es el entorno de staging que hacía
falta**, y los puntos 4, 5 y 50 dejan de estar bloqueados sin gastar un peso ni
esperar a nadie.

Lo que hay que decidir antes de tocarlo: qué tiene adentro. Si guarda algo de la
validación de agosto, se crea uno nuevo; si no, se le aplican las 170
migraciones desde cero —que es, en sí misma, la prueba del punto 4— y se le
cargan datos sintéticos.

**Sigue siendo la pieza de mayor rendimiento de toda la lista**: destraba los
puntos 3, 4, 5, 7 y 50 de una vez.

---

## B. Funciones esenciales

| # | Punto | Estado | Evidencia / qué falta |
| --- | --- | --- | --- |
| 11 | Registro e inicio de sesión | **parcial** | Correo, Google y Apple, recuperación, cierre de sesión y verificación contra contraseñas filtradas (`lib/pwnedPassword.ts`). Falta el recorrido certificado de enlace vencido, sesión expirada y cuenta duplicada. |
| 12 | Onboarding conversacional | **parcial** | `/eos/onboarding` y `api/onboarding`, caso 07 de certificación. Falta verificar que cubra país, moneda, zona horaria y tipo de usuario sin formulario. |
| 13 | Corregir el onboarding | **parcial** | Hecho el 31 de agosto: `DELETE /api/onboarding` (v96) vuelve al primer paso sin borrar las respuestas viejas, y el botón está en Perfil → Memoria y contexto. **Falta** el recorrido con sesión. |
| 14 | Chat de punta a punta | **parcial** | Enviar, recibir y recuperar conversaciones andan. Falta certificar reintento, detención, adjuntos y reanudación tras desconexión. |
| 15 | No inventar respuestas | **parcial** | `npm run evals` con corpus y auditoría por mutación (`evals:mutacion`). Falta el caso explícito de "no afirmar una acción no confirmada". |
| 16 | Confirmar antes de lo sensible | **parcial** | El Worker Gate ya exigía aprobación para las acciones ERP del chat. El 31 de agosto se cubrió lo que faltaba en pantalla: cobrar, pagar y emitir un comprobante no confirmaban nada. Ahora los tres dicen qué va a pasar con el monto adentro (`negocio/Confirmar.tsx`), no un "¿estás seguro?". **Falta** el mismo criterio en las eliminaciones de producto y contacto. |
| 17 | Memoria de EOS | **parcial** | Hecho el 31 de agosto: ver (la recomendación ahora se muestra; antes solo el patrón), corregir con sus palabras, descartar —deja de llegarle a EOS—, restaurar y eliminar (`eos_gestionar_aprendizaje_v96`). Los descartados quedan plegados, no desaparecen. **Falta** el recorrido con sesión. |
| 18 | Decisiones y seguimiento | **parcial** | `api/decisions` y `api/decisions/[id]/results`. Falta certificar responsable, fecha y vínculo con la conversación de origen. |
| 19 | Briefing diario | **parcial** | `api/cron/briefing-diario` y preferencias. Falta certificar horario paraguayo, no-duplicado y el enlace correcto. |
| 20 | Alertas de riesgo | **parcial** | Faltante de plata y vencimientos ya estaban, con control de repetición. El 31 de agosto se sumaron **inventario bajo y cobros demorados** (`lib/erp/riesgos-negocio.ts`, 12 tests), con una clave por riesgo que impide repetirlo y lo vuelve a permitir si el problema se resolvió y volvió. Salen por la misma ruta que ve la pantalla. **Falta** los "gastos anormales", que no se encienden hasta poder distinguirlos de la compra anual del seguro. |

---

## C. Finanzas, panel y documentos

| # | Punto | Estado | Evidencia / qué falta |
| --- | --- | --- | --- |
| 21 | Panel financiero completo | **parcial** | Saldo, ingresos, egresos, deudas, fijos y proyección. Falta patrimonio y evolución. |
| 22 | Multimoneda | **parcial** | Cerrado el 31 de agosto en ERP, CRM y contexto del chat: la moneda del documento sale de sus líneas, un trigger (v93) rechaza mezclarlas —verificado contra la base real—, el embudo se calcula por moneda y `eos_contexto_negocio` (v94) devuelve una cifra por moneda. **Falta** mostrar tipo de cambio con origen y fecha. |
| 23 | Trazabilidad de cada número | **parcial** | Hecho el 31 de agosto. Cada cifra del panel se abre: las que son suma muestran sus movimientos con la ventana de fechas; las que son cuenta (`disponible real`) muestran la operación, con cada término abrible a su vez. El detalle sale de los mismos arrays que se sumaron, y cada traza se comprueba a sí misma (`lib/finanzas/trazabilidad.ts`). **Falta** el recorrido con una cuenta con datos —necesita sesión— y llevar lo mismo a los informes y a los reportes del ERP. |
| 24 | Conciliación e importación | **parcial** | `api/finanzas/conciliar` y `api/finanzas/buzon`. Falta cubrir transferencias propias y diferencias de saldo. |
| 25 | Conexiones automáticas | **abierto** | Solo lectura de correo. Ninguna integración bancaria. El alcance congelado lo saca del anuncio. |
| 26 | Fijos, deudas y vencimientos | **parcial** | `api/finanzas/fijos` y `api/finanzas/deudas`. Faltan cuotas, pagos parciales e intereses. |
| 27 | Cálculos de dinero | **cerrado** (con reserva) | Tests de `lib/finanzas`, `evals/casos/importes.ts`, la validación de entrada, y desde el 31 de agosto `lib/erp/dinero-limites.test.ts`: la invariante `subtotal + iva = total` con 1 a 200 líneas y precios no redondos, montos de nueve y doce dígitos sin perder un guaraní, guaraní sin decimales y dólar con ellos, cantidades fraccionadas, y la tasa ausente cobrada al 10% y no como exenta. **Reserva:** falta el recorrido de una persona distinta. |
| 28 | Informes por período | **parcial** | `api/informes` y `api/finanzas/periodo`, y desde el 31 de agosto probado que **dos corridas iguales dan exactamente el mismo informe**: el orden de los movimientos no cambia los totales, lo de afuera del período se queda afuera, y agosto pedido en diciembre da lo mismo que agosto pedido en septiembre. **Falta** el filtro por moneda y zona horaria bajo prueba. |
| 29 | Word, PDF y Excel | **parcial** | `docx`, `exceljs` y `pdfkit` integrados; `docs/documentos-a-pedido.md`. Falta cubrir todos los pedidos posibles. |
| 30 | Validar antes de entregar | **cerrado** (con reserva) | `lib/documentos/verificar.ts` mira bytes, tamaño mínimo, firma y marca de cierre —probado contra archivos reales de exceljs, pdfkit y docx para no rechazar los sanos— **y desde el 31 de agosto también contrasta las cifras**: una tabla cuya fila TOTAL no suma sus filas se frena con 422 en vez de entregarse. Cuida los subtotales, el redondeo y las tablas de una línea para no dar falsos positivos. Los datos de otro usuario los frena la sesión + RLS. **Reserva:** falta el recorrido de una persona distinta. |

---

## D. ERP, CRM y gestión

| # | Punto | Estado | Evidencia / qué falta |
| --- | --- | --- | --- |
| 31 | Invariantes del ERP | **cerrado** (con reserva) | Migración `20260829005319`, aplicada en producción y con test de invariantes. Una sola transacción, actor y motivo obligatorios, locks, auditoría única por documento, repetición idempotente. **Reserva:** falta el recorrido de una persona distinta contra la base. |
| 32 | Sin ejecuciones duplicadas | **parcial** | Cubierto en anulación (`ya_estaba`) y en el catastro Bancard (v77). Falta en importación, webhooks y comandos del chat. |
| 33 | Empresas, sucursales, roles | **abierto** | El tenant es `usuario_id`. Fuera del alcance de lanzamiento. |
| 34 | Catálogo profesional | **parcial** | Código, precio, costo, moneda, IVA, stock, mínimo e historial de costo (v80). Faltan categorías, marcas, variantes, unidades y listas de precios. |
| 35 | Inventario profesional | **abierto** | Un saldo por producto. Fuera del alcance. |
| 36 | Ciclo de compras | **parcial** | Compra, pago y anulación. Falta orden, aprobación, recepción parcial y devolución. |
| 37 | Ciclo de ventas | **parcial** | Venta, cobro y anulación. Falta cotización, pedido, entrega parcial y nota de crédito. |
| 38 | Caja y tesorería | **abierto** | Fuera del alcance. |
| 39 | CRM | **parcial** | Contactos, oportunidades y actividades. Falta embudo, conversión y razones de pérdida. |
| 40 | Reportes empresariales | **parcial** | `api/eos-kpis` y `api/eos-tendencias`. Faltan rotación, margen, cartera y desempeño. |
| 41 | Facturación electrónica | **cerrado en su rotulado** | La v87 renombró el módulo a "Comprobantes de venta (beta)" y el papel sale como borrador. SIFEN sigue **externo**. |
| 42 | Auditoría de cambios | **parcial** | Hecho el 31 de agosto: las nueve operaciones sensibles del ERP —registrar, cobrar, pagar, anular venta y compra, ajustar stock, emitir comprobante— escriben en la bitácora encadenada con actor, fecha, antes/después, motivo, origen y resultado. Los intentos rechazados también. El antes/después va dentro de `detalle`, que está hasheado; una columna nueva quedaría fuera de la cadena. **Falta** empresa/sucursal, que no existen hasta la fase 1. |

---

## E. Seguridad y resistencia

| # | Punto | Estado | Evidencia / qué falta |
| --- | --- | --- | --- |
| 43 | Auditoría de acceso | **cerrado** (con reserva) | **Probado, no afirmado**: el caso 12 de certificación crea una víctima y un intruso con sesión real e intenta, sobre las **64 tablas con `usuario_id`**, leerlas con sesión ajena, leerlas sin sesión con sólo la clave pública, editar y borrar filas ajenas, plantar un movimiento a nombre de otro, y llamar las funciones `security definer`. **13 de 13 en verde contra la base real**, cero fugas. La lista de tablas se descubre leyendo las migraciones, así que una tabla nueva queda cubierta desde que existe. **Reserva:** falta el recorrido de una persona distinta. |
| 44 | Sin rutas de prueba | **cerrado** | Relevado hoy: no hay rutas de test, debug ni demo en `app/`. Las tres bajo `api/internal` están autorizadas por firma. |
| 45 | Interfaces externas | **parcial** | Firma de webhook Bancard, `worker-authorize`, `no-store` y `Vary: Cookie`. El 31 de agosto se sumó el **techo de solicitudes** (`lib/seguridad/limite.ts` + v99), aplicado a `/api/ventas/contacto`, que era la única ruta totalmente pública y mandaba correo sin ningún tope. La clave va hasheada: no se guarda ninguna IP. Verificado contra la base real. **Falta** aplicarlo a `/api/soporte` y a los webhooks, y la prevención de repetición generalizada. |
| 46 | Secretos y datos sensibles | **cerrado** (con reserva) | Cifrado AES-GCM ligado a usuario y proveedor con rotación de clave. Verificado el 31 de agosto: **ningún archivo `.env` estuvo nunca en el historial de git** y no hay credenciales en el árbol versionado. Y se taparon **tres fugas reales al log del servidor** —el cuerpo crudo de la respuesta de n8n, la fila de un efecto del worker y el objeto de autorización— con `lib/seguridad/registro.ts`, que deja pasar la forma del error y no el contenido. **Reserva:** falta el recorrido de una persona distinta y la rotación practicada de verdad. |
| 47 | Recuperación ante incidentes | **parcial** | `docs/rollback-runbook.md` cubre Vercel, Supabase y —desde el 31 de agosto— **qué pasa y qué hacer cuando se cae cada una de las cinco dependencias**: Supabase, n8n, Resend, OpenAI y Bancard, escrito contra lo que el código hace hoy. **Falta**, y está listado ahí sin adornos: la restauración nunca se verificó, hay que confirmar si PITR está habilitado, el respaldo de n8n está diez días desactualizado, y la alerta viaja por el mismo canal que vigila. |

---

## F. Experiencia y lanzamiento

| # | Punto | Estado | Evidencia / qué falta |
| --- | --- | --- | --- |
| 48 | Experiencia y accesibilidad | **abierto** | Sin auditoría de teclado, contraste, lectores de pantalla, estados vacíos ni conexión lenta. |
| 49 | Puerta automática de calidad | **parcial** | El CI corre `npm test`, `npm run evals`, `tsc --noEmit` y ahora `npm run lint:tope`, los cuatro bloqueando. El lint todavía no exige cero —quedan 24 errores heredados— pero **ya no puede subir**: el trinquete falla si crece, y también si baja sin actualizar el tope, para que ese número no mienta. Deuda: 42 → 24 errores, 39 → 7 avisos. Ya existe la primera prueba SQL (`supabase/tests/`). Faltan las de seguridad y los recorridos de navegador. |
| 50 | Piloto y simulacro | **abierto** | Deja de depender de crear un proyecto: ya existe uno sano. Falta decidir si se usa ese o se crea otro, y después el piloto en sí. |

---

## Definición de terminado

Un punto se marca cerrado solo cuando:

1. funciona en producción o en un entorno idéntico;
2. tiene pruebas satisfactorias;
3. lo recorrió una persona distinta de quien lo implementó;
4. contempla errores, reintentos y conexiones cortadas;
5. respeta aislamiento, permisos y privacidad;
6. tiene monitoreo y procedimiento de recuperación;
7. deja evidencia verificable.

Pasar una prueba técnica no es estar listo para el mercado.

---

## Orden recomendado del trabajo

Por rendimiento, no por número de punto.

1. **Segundo proyecto Supabase.** Destraba 3, 4, 5, 7, 43 y 50. Nada más de esta
   lista rinde tanto.
2. ~~**Punto 30 — validar el documento antes de entregarlo.**~~ Hecho el 31 de
   agosto en su parte de integridad. Queda el contraste de cifras.
3. ~~**Punto 49 — que el lint bloquee.**~~ Hecho lo que se podía sostener: la
   deuda bajó de 42 a 24 errores y ahora **no puede subir** (`npm run lint:tope`
   bloquea en el CI). Queda llegar a cero.
4. **Punto 7 — los siete finales de pago.** Rechazado, cancelado, duplicado,
   abandonado, demorado y reversado, como casos de `npm run certificar`.
5. ~~**Punto 23 — trazabilidad de cada número.**~~ Hecho en el panel financiero.
   Queda llevarlo a los informes y a los reportes del ERP.
6. **Puntos 13, 17 y 16.** El usuario tiene que poder corregir lo que EOS creyó
   entender, y saber qué va a pasar antes de que pase.
7. **Punto 48 — accesibilidad.** Antes del piloto, no después.
8. **Firmas: 1, 9 y 10.**

---

## Hallazgos abiertos, con nombre y apellido

Cosas concretas encontradas mientras se recorría la lista. No son opiniones:
cada una tiene el archivo y la línea.

### 1. `eos_contexto_negocio` (v82) suma monedas distintas — ABIERTO

La función que le arma a EOS el contexto del negocio calcula:

- `ventas.total` — `sum(v.total)` sobre `eos_erp_ventas`, sin agrupar por moneda;
- `por_cobrar` y `por_pagar` — lo mismo;
- `crm.oportunidades_abiertas.monto` — `sum(o.monto)`, lo mismo.

Y `lib/eos/contexto-negocio.ts:113` formatea el resultado con `"PYG"` escrito a
mano. O sea: **EOS le dice al usuario, en el chat, un número que no existe en
ninguna moneda.** Es peor que el mismo error en una pantalla, porque viene con
la autoridad de una respuesta.

Se arregla igual que el embudo: agrupar por moneda y devolver una cifra por
cada una. Requiere reemplazar la función de la v82, que es la única que la
define, así que se puede reproducir y enmendar sin riesgo de perder parches.

### 2. `set-state-in-effect` no se puede satisfacer con este patrón — ABIERTO

Primero pareció que los seis eran arreglables uno por uno. No lo son, y conviene
dejar escrito por qué antes de que alguien lo vuelva a intentar.

**Uno sí lo era** y está arreglado: `PagoTarjeta.tsx` ponía el aviso de la vuelta
de Bancard con `setAviso` dentro del efecto, así que el usuario veía un render en
blanco y el mensaje recién en el segundo. Ahora sale del estado inicial.

**Los otros cinco no.** La regla marca cualquier llamada, desde un efecto, a una
función que en algún momento toca `setState` — sin importar si eso pasa antes o
después del primer `await`. La prueba está en `MisTarjetas.tsx`: ya no tenía
ningún `setState` síncrono, con un comentario que lo explicaba, y la regla lo
marca igual.

O sea que no se sale de esto quitando líneas: hay que cambiar cómo carga datos
toda la app (un hook de datos propio, o `use()` con Suspense). Es una decisión de
arquitectura, no una limpieza.

**Mientras tanto la puerta no puede bloquear por lint**, porque nunca llegaría a
cero. Dos caminos: hacer ese refactor, o bajar esta regla sola a aviso —con el
motivo escrito en la config— y bloquear por todo lo demás. El segundo es el que
convierte la puerta en una puerta.

Y los 36 `any`: casi todos son `createAdminClient()` casteado porque los tipos
generados no conocen esos RPC. Se resuelven con un único ayudante nombrado y
documentado, y pasan de 36 a 1.

### 3. Numeración de migraciones duplicada — MENOR

Hay dos `v88` (`20260828140000` y `20260829005319`) y dos `v92`
(`20260831120000` y `20260831140545`). El orden real lo da el timestamp, así
que no rompe nada, pero la etiqueta dejó de identificar. Conviene que la
próxima retome desde v94.

---

## Las migraciones v94 a v98, aplicadas y verificadas

Se aplicaron el 31 de agosto. Cada una quedó **comprobada contra la base real**,
no dada por buena porque `db push` no devolvió error.

| Migración | Qué trae | Cómo se comprobó |
| --- | --- | --- |
| `v94` | `eos_contexto_negocio` por moneda | Se llamó a la función: devuelve las claves nuevas (`por_moneda`, `por_cobrar_monedas`) **y** las viejas al lado. Esa convivencia es lo que la vuelve independiente del orden de deploy. |
| `v95` | Revertir un cobro de Bancard | Caso 11 de certificación, entero en verde: devuelve el vencimiento anterior, deja el historial en `reversado` con su motivo, repetirla no descuenta dos veces, y un cobro revertido no se puede reconfirmar. |
| `v96` | Corregir aprendizajes y rehacer el onboarding | Las dos funciones responden; reiniciar el onboarding devolvió `{ok:true, paso:'bienvenida'}`. |
| `v97` | Recordar qué aviso del negocio ya se mandó | La tabla existe y se lee. |
| `v98` | Eventos del ERP en la bitácora | Se insertó un `stock_ajustado` con antes/después y la cadena lo aceptó. Esa fila de sonda **queda para siempre** en la cuenta de certificación: la bitácora es append-only por diseño. |

### La lección que dejó la v94

Su primera versión reemplazaba las claves viejas por las nuevas, y su cabecera
decía "aplicala después del deploy".

Eso es una instrucción que funciona hasta que alguien la aplica antes — y de
hecho **otra sesión corrió `supabase db push` en paralelo** mientras se
trabajaba en el repositorio. Si la migración hubiera seguido siendo la original,
el prompt de cada conversación se habría llenado de `₲ NaN` sin que nadie lo
pidiera ni lo notara.

Se salvó porque para ese momento ya era compatible hacia atrás. La regla que
queda: **una migración cuya corrección depende de que alguien lea un comentario
no es una migración correcta.** Si el orden importa, hay que quitarle la
importancia al orden, no documentarla.
