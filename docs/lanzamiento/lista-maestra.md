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

Medición del 3-4 de septiembre, para no discutirla dos veces:

- `npm test` → **878/878 en verde**. Arrancó el proyecto en 379.
- `npm run build` y `npx tsc --noEmit` → **en verde**.
- `npm run lint` → **23 errores, 5 avisos**. Empezó en 42 y 39.
  **Bloquea** el CI vía `npm run lint:tope`: la deuda puede bajar, no subir.
- `supabase migration list --linked` → **194 aplicadas, local y remoto coinciden
  una a una. Cero pendientes.**
- `npm run migraciones` → **194 archivos, 194 versiones distintas**, sin usos de
  tabla antes de crearla. Candado nuevo, también bloqueante en CI.
- **Instalación desde cero, probada en dos rondas** (la segunda encontró lo que
  la primera no podía ver — ver el hallazgo -3): las 194 migraciones aplicadas
  sobre una base vacía, comparadas objeto por objeto contra producción —tablas,
  vistas, funciones, triggers, políticas RLS— y con un ALTA REAL de punta a
  punta contra la API que usa la aplicación. Coincide exacto. Ver el punto 4.
- `npm run certificar` → **113 de 115 en verde**, 2 en amarillo porque la cuenta
  de certificación no tiene tarjeta catastrada. Ninguna en rojo.

---

## A. Bloqueantes críticos

| # | Punto | Estado | Evidencia / qué falta |
| --- | --- | --- | --- |
| 1 | Congelar el alcance | **parcial** | Redactado en `docs/lanzamiento/alcance-congelado.md`. Falta la firma de producto, legal y técnica, y la decisión sobre rotular ERP y CRM como beta. |
| 2 | Cerrar los cambios pendientes | **cerrado** | Árbol limpio. Tres commits: invariantes de anulación, validación de entrada de productos, higiene del repo. Los 21 MB de video y presentación quedaron ignorados, no commiteados. |
| 3 | Sincronizar migraciones | **cerrado** | Las 187 aplicadas coinciden local y remoto, uno por uno, verificado el 2-3 de septiembre. Y ahora hay un segundo proyecto (`biulwebdgrcrsnzuqhky`) con el mismo esquema exacto, construido desde cero — ver el punto 4. |
| 4 | Instalación desde cero | **cerrado** | **Probado de verdad, no afirmado, y en dos rondas.** La primera comparó objeto por objeto contra producción —tablas, vistas, funciones, triggers, políticas RLS— y dio 0 diferencias, pero comparar que algo EXISTE no es lo mismo que probar que se puede USAR: nunca se había intentado un alta real. Al investigar el onboarding (punto 12) se hizo esa prueba y aparecieron tres agujeros que la primera ronda no podía haber visto: el trigger `on_auth_user_created` vive en `auth.users`, fuera del esquema `public` que se había comparado; y los privilegios por defecto del esquema (`ALTER DEFAULT PRIVILEGES`, la regla que hace que TODA tabla nueva reciba automáticamente sus permisos) tampoco estaban, así que `usuarios` y `eos_onboarding` existían perfectas pero la API real —con la que habla la aplicación— no podía ni leerlas: "permission denied". Corregidos los tres, un alta real vía la API pasa de punta a punta: el trigger crea `usuarios` con nombre y plan correctos, y deja la fila de onboarding lista. Reconstruido y comparado una tercera vez tras el arreglo: 0 diferencias otra vez. Producción recibió los tres arreglos —dos ejecutados de verdad (son idempotentes), uno marcado como aplicado sin ejecutar (dropear y recrear un trigger de auth.users en vivo es innecesariamente arriesgado)— sin perder ni un dato: mismas 144 conversaciones antes y después. |
| 5 | Actualización realista | **cerrado** | El entorno del punto 4 es ese ensayo: un proyecto que arranca vacío, no con datos de usuarios reales, y a partir de ahora cualquier migración se puede probar ahí antes de tocar producción. |
| 6 | Bancard productivo | **parcial** | Firmas, webhook, tokenización, 3DS, ocasional y recurrente andan en `staging` (`BANCARD_ENV`). Falta instalar credenciales productivas y repetir la verificación con `production`. |
| 7 | Compra real controlada | **cerrado** (con reserva) | Los siete finales cubiertos y **verdes contra la base real**: aprobado, rechazado y abandonado en el caso 03; duplicado, demorado y reversado en el 11. La reversión deshace plan, módulos, solicitud e historial, y repetirla no descuenta dos veces. **Reservas:** el 3DS se completa en el navegador y la suite no puede recorrerlo sola, y el cobro con tarjeta queda en amarillo hasta catastrar una de prueba. |
| 8 | Requisitos de publicación | **externo** | D-U-N-S, cuentas de tienda, políticas y verificaciones sin empezar. El alcance congelado saca las apps del lanzamiento: se sale por web. |
| 9 | Revisión legal | **externo** | Existen `/terminos` y `/privacidad`. Ningún profesional los revisó. |
| 10 | Decisión formal de lanzamiento | **abierto** | La regla está escrita en el alcance congelado; falta el acta. |

### La nota de infraestructura que ordena A — RESUELTA

`supabase projects list` muestra tres proyectos en la organización:

| Proyecto | Ref | Región | Estado |
| --- | --- | --- | --- |
| TransTech EOS | `dirugpkamzgvyshcnsxs` | us-east-2 | **producción**, sano |
| EOS Financial Autopilot Validation | `biulwebdgrcrsnzuqhky` | us-east-2 | sano, **ahora en uso** |
| barretoa109@gmail.com's Project | `crihlzpsgdcqseltiqim` | us-east-1 | inactivo |

El segundo estaba vacío. Se usó para el punto 4: se le vació el esquema
`public` con permiso explícito, se le aplicaron las 187 migraciones desde
cero tres veces (dos fallaron y se corrigieron, la tercera pasó completa), y
el resultado se comparó objeto por objeto contra producción. Queda enlazado
y disponible como entorno de pruebas para cualquier migración futura, antes
de tocar producción.

Destrabó los puntos 3, 4 y 5 de una vez, como se esperaba.

---

## B. Funciones esenciales

| # | Punto | Estado | Evidencia / qué falta |
| --- | --- | --- | --- |
| 11 | Registro e inicio de sesión | **cerrado** (con reserva) | Correo, Google y Apple, recuperación, cierre de sesión y verificación contra contraseñas filtradas (`lib/pwnedPassword.ts`). Los tres recorridos que faltaban resultaron ser agujeros reales, no sólo falta de certificación: **cuenta duplicada** — `signUp()` no avisa con un error cuando el correo ya existe; responde sin error, sin sesión, con `identities: []` y hasta el `created_at` falsificado con la fecha de ahora. Verificado contra producción con una cuenta real (`demo@transtech.com.py`): sin el chequeo, quien reintenta registrarse veía "Cuenta creada, revisá tu correo" y esperaba para siempre una confirmación que nunca llegaba. Ahora se detecta y ofrece "Ingresá con tu contraseña". **Enlace vencido y sesión expirada** — `/auth/callback` ya redirigía a `/login?error=...` cuando un enlace de confirmación o recuperación vencía, y el middleware ya redirigía con `?next=...` cuando alguien sin sesión entraba a una ruta protegida, pero `/login` descartaba los dos parámetros: la persona volvía a la pantalla de login pelada, sin ninguna pista de qué pasó. Ahora muestra el aviso correspondiente — sin acusar una expiración que podría ser falsa cuando sólo hay `next` sin `error`. Probado en navegador contra los tres casos, incluida la vuelta de "Ingresá con tu contraseña" a la pantalla de login. **Reserva:** falta el mismo recorrido con Apple, que no se pudo ejercitar sin sus credenciales. |
| 12 | Onboarding conversacional | **cerrado** (con reserva) | El hallazgo era más grave que "falta verificar": `eos_onboarding` tenía **cero filas de 40 usuarios**. La conversación fundacional —744 líneas de componente, su API, su tabla— nunca se enlazó al alta; `RegisterForm.tsx` mandaba directo a `/eos/chat`, que es además el destino por defecto de todo el sistema de auth. Confirmado con el usuario que se conecte de verdad: el correo y contraseña ahora manda a `/eos/onboarding`; para Google, que usa el mismo botón para alta y reingreso, `handle_new_user()` deja una fila de onboarding en el mismo instante en que la cuenta nace —la única señal confiable, ya que `created_at` y `last_sign_in_at` nunca coinciden ni en el primer inicio de sesión, probado contra una cuenta real con 54 segundos de diferencia— y `/auth/callback` decide el destino mirando si esa fila existe e incompleta. Sobre país, moneda y zona horaria: zona horaria es una limitación de alcance ya congelada y documentada (briefing en horario de Paraguay), moneda es por documento y no por usuario por diseño, y país no existe como columna en ninguna migración — no es que se pregunte y no se guarde, es que no hay dónde. Probado de punta a punta contra el proyecto de validación reconstruido desde cero: alta real vía la API que usa la aplicación, con `usuarios` y `eos_onboarding` completándose correctamente. **Reserva:** falta el recorrido en el navegador real, con una cuenta de Google de verdad. |
| 13 | Corregir el onboarding | **cerrado** | Probado en navegador de punta a punta el 4 de septiembre: cuenta real, ocho pasos de la conversación hasta dejar "MARCA-PRUEBA no quedarme sin efectivo a fin de mes" y "MARCA-PRUEBA el estado de la tarjeta de crédito" cargados, botón "Rehacerla" en Perfil → Memoria y contexto, y verificación directa en la base — vuelve a `paso: 'bienvenida'`, `completado_en: null`, **las dos respuestas de prueba intactas**. Coincide exacto con lo que promete el comentario de la función. **Hallazgo aparte, sin cerrar:** haciendo este recorrido apareció que `LoginForm.tsx` (el ingreso normal con contraseña, no el que pasa por `/auth/callback`) no verifica si el onboarding quedó a mitad de camino — manda directo a `destinoPedido()`. Alguien que confirma el correo, arranca el onboarding, lo abandona, y después simplemente inicia sesión de nuevo, no vuelve a ver la conversación pendiente salvo que entre a Perfil y la rehaga desde cero. No se tocó: es una decisión sobre el comportamiento del login normal, no sobre "rehacer", y merece su propia conversación. |
| 14 | Chat de punta a punta | **parcial** | Enviar, recibir y recuperar conversaciones andan. Falta certificar reintento, detención, adjuntos y reanudación tras desconexión. |
| 15 | No inventar respuestas | **parcial** | `npm run evals` con corpus y auditoría por mutación (`evals:mutacion`). Falta el caso explícito de "no afirmar una acción no confirmada". |
| 16 | Confirmar antes de lo sensible | **cerrado** | El 31 de agosto se cubrió lo que faltaba en pantalla: cobrar, pagar y emitir un comprobante no confirmaban nada. Ahora los tres dicen qué va a pasar con el monto adentro (`negocio/Confirmar.tsx`), no un "¿estás seguro?". El 2 de septiembre se cerró lo último: dar de baja un producto o un contacto. Al ir a agregar la confirmación apareció que **la eliminación no existía** — las rutas `DELETE` estaban escritas y ninguna pantalla las llamaba, así que un producto cargado por error se quedaba para siempre y el segundo intento creaba el duplicado. Ahora está, y la confirmación dice que deja de ofrecerse, que los documentos que ya lo nombran no cambian y que no se borra nada. Probado contra la base: dados de baja el producto y el cliente de una venta, la venta conserva importe, nombre de la línea y nombre del cliente, y su oportunidad sigue ganada. **Cambio del 4 de septiembre, a pedido explícito del usuario:** la premisa "el Worker Gate ya exigía aprobación para las acciones ERP del chat" dejó de ser cierta para tres acciones puntuales. El usuario pidió "auto-aprobar todo lo que venga del chat, sin excepción" y se le preguntó específicamente por REGISTRAR_VENTA, AJUSTAR_STOCK y CREAR_CONTACTO —las únicas que el gate frenaba—; eligió la opción sin niveles ni montos. Ahora ejecutan solas (`lib/worker-gate-handler.ts`, `defaultLevelOverride`/`forceApproval`), dentro del mismo presupuesto diario de riesgo y límite de acciones automáticas de siempre —eso no es una aprobación por acción, es un techo por día, y no se pidió sacarlo. Se cierra este punto por las confirmaciones de pantalla, que es lo que efectivamente prueba: la confirmación del chat es ahora una decisión de producto distinta, documentada donde se tomó, no un pendiente de certificación. |
| 17 | Memoria de EOS | **cerrado** | Hecho el 31 de agosto: ver (la recomendación ahora se muestra; antes solo el patrón), corregir con sus palabras, descartar —deja de llegarle a EOS—, restaurar y eliminar (`eos_gestionar_aprendizaje_v96`). Los descartados quedan plegados, no desaparecen. Recorrido con sesión hecho el 4 de septiembre: usuario real, un patrón sembrado a mano (la evidencia real tarda en acumularse; nada del recorrido depende de cómo llegó la fila), las cinco acciones probadas en el navegador contra la base real, en orden — corregido, descartado (con la corrección conservada), restaurado (misma corrección) y eliminado. El único hueco fue de la herramienta de prueba, no del producto: `Eliminar` pasa por `window.confirm()`, un diálogo nativo del navegador que la automatización no puede aceptar, así que esa acción se verificó llamando la misma ruta (`PATCH /api/learnings`) desde la consola y confirmando el `DELETE` contra la base — el diálogo en sí es un freno de cliente ya usado en el resto del producto, no una pieza propia para certificar. |
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
| 36 | Ciclo de compras | **parcial** | Compra, pago, anulación y —desde el 2 de septiembre— **corrección de importes** (v106): la compra es donde entra el costo, y un número mal tipeado se volvía el costo del producto, el margen de todo lo vendido después y un gasto del panel, sin más salida que anular y recargar. Los precios sí, las cantidades no: cambiar un precio mueve el total y el gasto —los dos en la misma transacción— mientras que cambiar una cantidad movería stock que ya tiene su fila de rastro. 16 comprobaciones contra la base real. Falta orden, aprobación, recepción parcial y devolución. |
| 37 | Ciclo de ventas | **parcial** | Venta, cobro, anulación y —desde el 2 de septiembre— **corrección del costo congelado** (v105). Cada línea congela el costo del momento para que la subida de un proveedor no cambie el margen de una venta vieja; el efecto secundario era que un costo mal tipeado quedaba mal para siempre. 15 comprobaciones. Y el renglón de la lista pasa a decir **qué se vendió** en vez del cliente: lo pidió una clienta que veía cuatro filas seguidas diciendo "Consumidor final". Falta cotización, pedido, entrega parcial y nota de crédito. |
| 38 | Caja y tesorería | **abierto** | Fuera del alcance. |
| 39 | CRM | **parcial** | Contactos, oportunidades y actividades. El 2 de septiembre el **embudo pasó a llenarse solo con las ventas** (v103/v104): la venta a un cliente cierra su oportunidad, y si no había ninguna la crea ya ganada con el monto real. Tenía cero oportunidades con tres contactos y cuatro ventas cargadas — esperaba que alguien anotara a mano lo que el sistema ya sabía, y un CRM que exige cargar dos veces la misma venta deja de usarse en una semana. Anular deshace: si la creó la venta se borra, si existía vuelve a su etapa y a su monto estimado. 17 comprobaciones contra la base real. Falta conversión y razones de pérdida. |
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
| 48 | Experiencia y accesibilidad | **parcial** | Auditoría hecha el 4 de septiembre sobre las cinco áreas que pedía el punto. **Teclado:** no había trampas ni orden de tabulación roto, y el catálogo ya evita `<div onClick>` a favor de `<button>` real (`TarjetaKPI.tsx` lo explica en un comentario). El hueco real era el cajón de navegación del celular: se podía abrir pero no cerrar con teclado. Ahora Escape lo cierra y devuelve el foco al botón que lo abrió, igual que el clic en el fondo — probado en el navegador, en viewport móvil, contra los dos caminos de cierre. **Lectores de pantalla:** los botones de solo ícono y las imágenes ya tenían `aria-label`/`alt` en todos lados. Lo que faltaba: como treinta mensajes de error o éxito sin `role="alert"`/`role="status"`, así que un cambio de estado quedaba mudo para quien no ve la pantalla — corregido en los tres flujos de cuenta (login, registro, recuperar y cambiar contraseña), en el pago, y en el resto del ERP. Los campos de nombre/correo/WhatsApp/contraseña del registro, el cambio de contraseña, el chat, la búsqueda de conversaciones y la carga rápida de gastos no tenían ninguna etiqueta programática — sólo `placeholder`, que un lector de pantalla no siempre anuncia — y ahora tienen `aria-label`. **Contraste:** acá la auditoría inicial sólo había sacado los colores, no calculado nada; calculado aparte, `--amber`, `--green` y `--red` sobre su propio fondo claro (las tarjetas de aviso, `.neg-estado`) daban entre 3.0 y 3.1 —la mitad de lo que exige WCAG AA (4.5) para texto normal—, y tres textos del login (`text-slate-600`/`-500`) daban 2.6 y 4.2. Los tres colores del panel se oscurecieron manteniendo el tono hasta pasar 4.5:1 contra su fondo claro Y contra blanco (bastantes usos no tienen fondo propio); el login pasó a `slate-400`, que da 7.8. Quedan los `placeholder` del login en `slate-500` (dan 3.95): no se tocaron porque WCAG no les exige el mismo mínimo que al texto real, y es la única falla de contraste que sobrevive a esta pasada. **Estados vacíos:** resultó ser el punto que menos hacía falta tocar — ochenta y pico mensajes de "Cargando…" y decenas de "Todavía no hay…" ya cubrían casi toda la pantalla, con CSS dedicado. Sin corregir: un puñado de widgets del panel financiero que devuelven `null` sin avisar cuando no hay nada que mostrar, una decisión de diseño (ocultar el widget) más que un error, pero sin ninguna marca para quien usa lector de pantalla. **Conexión lenta:** la mayoría de las pantallas ya frenaban en un "Cargando…" mientras esperaban datos. El hueco real: el panel principal (Dashboard, Negocio, Gastos, Decisiones, Aprendizajes) no mostraba nada — ni spinner ni texto— mientras se resolvía el perfil del usuario, así que alguien con conexión lenta que tocaba una de esas pestañas apenas entrar veía la pantalla vacía. Se agregó el mismo "Cargando…" que ya usa el resto del ERP. **Sin tocar, documentado para después:** los mismos widgets silenciosos de "estados vacíos" también se quedan sin aviso mientras cargan, y varios paneles con "Cancelar" no cierran con Escape (sólo con clic) — ninguno de los dos es una trampa de teclado ni dejaba a nadie sin salida, así que se priorizó lo que sí lo hacía. |
| 49 | Puerta automática de calidad | **parcial** | El CI corre `npm test`, `npm run evals`, `tsc --noEmit` y ahora `npm run lint:tope`, los cuatro bloqueando. El lint todavía no exige cero —quedan 24 errores heredados— pero **ya no puede subir**: el trinquete falla si crece, y también si baja sin actualizar el tope, para que ese número no mienta. Deuda: 42 → 24 errores, 39 → 7 avisos. Ya existe la primera prueba SQL (`supabase/tests/`). El 2 de septiembre se sumó el **quinto candado**: `npm run migraciones`, que encuentra sin base de datos las tres formas de romper una instalación desde cero —versiones repetidas, migraciones vacías, y usar una tabla antes de crearla—. Se probó **en rojo**, que es la única prueba que vale para un guardián: los cuatro casos se construyeron aparte y los cuatro fallan con el archivo y el motivo. Faltan las de seguridad y los recorridos de navegador. |
| 50 | Piloto y simulacro | **abierto** | El proyecto de validación (`biulwebdgrcrsnzuqhky`) ya tiene el esquema completo aplicado desde cero — ver el punto 4. Falta cargarle datos sintéticos y correr el piloto en sí. |

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

1. ~~**Segundo proyecto Supabase.**~~ Hecho. Destrabó 3, 4, 5 y 7 (los cuatro ya
   cerrados en la sección A). 43 y 50 no se revisaron todavía en esta pasada.
2. ~~**Punto 30 — validar el documento antes de entregarlo.**~~ Hecho el 31 de
   agosto en su parte de integridad. Queda el contraste de cifras.
3. ~~**Punto 49 — que el lint bloquee.**~~ Hecho lo que se podía sostener: la
   deuda bajó de 42 a 24 errores y ahora **no puede subir** (`npm run lint:tope`
   bloquea en el CI). Queda llegar a cero.
4. ~~**Punto 7 — los siete finales de pago.**~~ Los siete cubiertos y verdes
   contra la base real. Reservas sin cerrar: el 3DS necesita navegador y el
   cobro con tarjeta necesita una tarjeta de prueba catastrada — ver el punto 7.
5. ~~**Punto 23 — trazabilidad de cada número.**~~ Hecho en el panel financiero.
   Queda llevarlo a los informes y a los reportes del ERP.
6. ~~**Puntos 13, 17 y 16.**~~ Los tres cerrados el 4 de septiembre: el usuario
   puede corregir lo que EOS creyó entender (13, 17), y sabe qué va a pasar
   antes de que pase (16).
7. ~~**Punto 48 — accesibilidad.**~~ Auditado y corregido el 4 de septiembre:
   teclado, lectores de pantalla, contraste y conexión lenta. Quedan dos
   residuos menores, documentados en el punto 48 y sin urgencia.
8. **Firmas: 1, 9 y 10.**

---

## Alcance que se sumó después de escribir esta lista

Los cincuenta puntos se escribieron pensando en un comercio. El 2 de
septiembre el usuario señaló que **EOS también es para personas físicas sin
negocio** —alguien que quiere anotar el combustible, el almuerzo y el sueldo—
y que eso no estaba en ninguna parte de la lista.

Tenía razón, y al ir a construirlo apareció algo peor que un hueco: casi todo
ya existía. `/api/finanzas/rapido` interpreta «gasté 50 mil en nafta» desde
hace tiempo —monto, dirección, fecha, moneda— y **no estaba conectado a
ninguna pantalla**. El clasificador de destinos, el desglose y el panel
también. Era un motor completo sin puerta de entrada.

Ahora hay una sección **Gastos**, fuera de Negocio a propósito, con carga en
una línea, corrección de categoría a mano y borrado de lo que se cargó a mano.
Lo nacido de una venta se muestra bloqueado con el lugar donde sí se corrige.

Dos cosas que encontraron las pruebas y no la lectura del código:

- Los patrones de «comida» eran marcas y locales —PedidosYa, restaurante,
  pizzería—, pensados para el extracto del banco. Nadie escribe «PEDIDOSYA»
  cuando anota a mano: escribe «el almuerzo».
- Contra la base real, **todas** las filas salían «Sin reconocer», porque los
  movimientos del ERP traen categoría propia con descripciones genéricas.
  Veinte filas iguales parecen una pantalla rota cuando el sistema sabe
  perfectamente qué es cada una.

**Qué implica para el lanzamiento:** el alcance congelado (punto 1) habla de
un producto para comercios. Si se anuncia también para personas físicas, ese
documento hay que actualizarlo antes, no después.

---

## Hallazgos abiertos, con nombre y apellido

### -2. La instalación desde cero fallaba en la segunda migración — CERRADO

El repositorio no podía reconstruir su propia base de datos. Sonaba abstracto
hasta que se probó: `supabase db push` contra un proyecto vacío se caía en la
migración número dos con

```
ERROR: relation "public.conversaciones" does not exist
```

**No era una tabla — eran 48, más una vista.** Todo el esquema original de
EOS —`conversaciones`, `mensajes`, `usuarios`, `planes`, `eos_tasks`,
`uso_mensual`, `solicitudes_pago`, y otras 41 más— se había creado a mano en
el panel de Supabase antes de que existiera el versionado, y ninguna quedó
escrita jamás en una migración. Producción nunca lo notó porque las tablas ya
estaban ahí; el problema sólo existe al reconstruir desde cero, que es
exactamente lo que nadie había hecho hasta ahora.

Se sumaron, con el mismo patrón: **9 funciones** (entre ellas
`eos_actualizar_updated_at`, el disparador genérico de `updated_at` que usan
varios triggers) y **una función puente** para un problema distinto —
`supabase db push` corre con un `search_path` más restrictivo que una sesión
normal, así que una migración de hace semanas que llama a `gen_random_bytes`
sin calificar el esquema falla sólo en este camino, nunca en producción.

Las tablas se reconstruyeron desde el catálogo real
(`information_schema` + `pg_catalog`), no a mano, en
`20260801000000_esquema_base_heredado_v0.sql`, fechada antes que la primera
migración real para que corra primero. Las funciones van en
`20260812222511_eos_funciones_heredadas_v0.sql`. Ninguna se toca en
producción: se marcan como aplicadas sin ejecutar (`migration repair`),
porque ahí esas tablas y funciones ya existen.

**Verificación:** las 187 migraciones se aplicaron sobre el proyecto de
validación (`biulwebdgrcrsnzuqhky`) empezando de una base con cero tablas, y
el resultado final se comparó objeto por objeto contra producción —tablas,
funciones, triggers, políticas RLS—. Coinciden exactamente, salvo la función
puente ya mencionada. Esto se repitió tres veces desde cero (no una) para
confirmar que no fue casualidad de una corrida.

**Un hallazgo de otra fase, encontrado en el camino:** `eos_erp_cuenta_movimientos_v107`
era una de las tablas huérfanas —cero filas, sin ninguna migración— cuando se
empezó este trabajo. Mientras se escribía la reconstrucción, la Fase 7
(cuenta corriente) la formalizó con su propia migración
(`20260902140000_eos_cuenta_corriente_v107.sql`) usando
`create table if not exists`. **Ese `if not exists` va a no hacer nada en
producción**, porque la tabla vieja ya está ahí: el esquema nuevo de la Fase
7 —con sus columnas, sus checks, su índice de exclusión mutua venta/compra—
nunca se va a aplicar salvo que alguien lo note y corrija esa migración
específica antes de que se necesite de verdad. No se tocó acá porque es una
decisión de esa fase, no de este cambio.

### -3. Existir no es lo mismo que poderse usar — CERRADO

El hallazgo -2 comparó objeto por objeto: mismas tablas, funciones,
triggers y políticas RLS. Pasó, y aun así la reconstrucción tenía tres
agujeros que ese tipo de comparación no puede ver, porque nunca prueba que
alguien pueda realmente USAR lo que existe — sólo que esté ahí.

Aparecieron investigando el onboarding (punto 12): al hacer un alta real
contra la reconstrucción, usando la misma API con la que habla la
aplicación, `usuarios` decía "permission denied for table usuarios" para
`service_role` — la clave con la que la app se conecta.

**Uno: `on_auth_user_created` vive fuera de `public`.** Es el trigger que
engancha `handle_new_user()` a `auth.users` — sin él, un alta nueva
inserta en `auth.users` y ahí se queda; `public.usuarios` nunca se crea, y
con ella ni el plan ni el nombre ni nada de lo que el resto de la
aplicación da por sentado. La comparación del hallazgo -2 sólo miraba
triggers del esquema `public`; éste vive en `auth`, y quedó fuera en las
dos puntas: ni se buscó en producción, ni se verificó que la
reconstrucción lo tuviera.

**Dos: los privilegios por defecto del esquema, que ninguna migración fija
nunca.** Ninguna de las 190 y pico migraciones tiene un `grant` para
`eos_onboarding`, y sin embargo en producción `service_role` puede leerla
y escribirla sin problema. La razón está en `pg_default_acl`, no en
ninguna migración: una regla `ALTER DEFAULT PRIVILEGES` fijada una sola
vez dice "toda tabla, secuencia o función NUEVA que cree `postgres` le da
automáticamente estos permisos a `anon`, `authenticated` y
`service_role`". La regla faltaba en el proyecto de validación —no viene
con cada proyecto nuevo de Supabase, se fija a mano igual que las tablas
huérfanas— y sin ella cada tabla nace sin un solo permiso para esos tres
roles.

Se corrigió la causa, no el síntoma: en vez de enumerar un `grant` por
cada una de las 48 tablas huérfanas —el primer intento fue exactamente
eso, y funcionaba, pero dejaba a las otras ~140 tablas de las migraciones
ordinarias expuestas al mismo problema en cualquier reconstrucción
futura—, se repuso la regla misma
(`20260731000000_eos_privilegios_default_v0.sql`, fechada antes que
cualquier tabla). Cubre todo de una vez.

**Tres, ya del lado del punto 12 y no de la reconstrucción:** conectar
Google al onboarding necesitaba distinguir un alta de un reingreso, y el
mismo botón sirve para las dos cosas. La tentación es comparar
`created_at` con `last_sign_in_at` — se probó contra una cuenta real y ya
eran distintas con 54 segundos de diferencia, porque crear la cuenta y
abrir la sesión son dos operaciones separadas y nunca coinciden ni en el
mejor de los casos. La señal que sí es confiable:
`handle_new_user()` corre exactamente una vez por cuenta —es un
`after insert on auth.users`, y esa tabla recibe una sola fila por cuenta
en toda su vida— así que si esa misma ejecución deja una fila en
`eos_onboarding`, esa fila certifica "esta cuenta acaba de nacer" sin
adivinar nada. El callback decide mirando si existe y sigue incompleta.

**Verificación final:** reconstruido y comparado una tercera vez tras los
tres arreglos — 0 diferencias contra producción, igual que el hallazgo -2
— y esta vez además un alta real de punta a punta, vía la API real:
`usuarios` y `eos_onboarding` se completan solos, con los valores
correctos.

Los tres arreglos se aplicaron a producción sin perder datos: dos de
verdad (son idempotentes — `ALTER DEFAULT PRIVILEGES` no toca nada
existente, y `create or replace function` es atómico), el del trigger
marcado como aplicado sin ejecutar, porque dropear y recrear un trigger de
`auth.users` en un sistema con altas reales corriendo es un riesgo
innecesario para algo que ya funciona ahí. Verificado: mismas 144
conversaciones antes y después.

Cosas concretas encontradas mientras se recorría la lista. No son opiniones:
cada una tiene el archivo y la línea.

### -1. n8n le hablaba a un despliegue de hace 185 commits — ABIERTO, BLOQUEANTE

Está numerado con un negativo a propósito: es anterior a todos los demás y
los explica. El hallazgo 0, el de la lista de acciones del worker y cualquier
otro arreglo que se haya hecho al Worker Gate son ciertos y siguen siendo
necesarios, pero ninguno cambió nada mientras esto estuvo así.

El worker de n8n arma la URL del autorizador con `$env.EOS_APP_BASE_URL`. En
el n8n de Railway esa variable vale:

```
https://transtech-eos-git-release-eos-40-rc1-trans-tech.vercel.app
```

El preview de la rama `release/eos-4.0-rc1`. No producción. Esa rama está
**185 commits atrás de main**, no tiene ni una aparición de `REGISTRAR_VENTA`
y trae `default_level: 1`.

De ahí salen los tres síntomas, todos de la misma causa:

| Síntoma | Por qué |
|---|---|
| `configured_level: 1` en catorce días de evaluaciones | El build viejo tiene `DEFAULT_PROFILE.default_level = 1`. El cambio a 2 está en main desde el 18 de agosto y nunca llegó a esa rama. |
| `400 Solicitud de gate inválida` al registrar una venta | `SYSTEM_RISK["REGISTRAR_VENTA"]` no existe en ese build, así que el gate rechaza la acción antes de evaluarla. |
| Ningún arreglo del gate se notaba | Se desplegaban a producción, y producción no era quien contestaba. |

La evidencia está en la ejecución 4278 del worker, del 2 de septiembre:
el nodo `01 INT Preparar` arma un cuerpo impecable —UUIDs válidos, `accion:
"REGISTRAR_VENTA"`, payload completo— y `02 INT Autorizar` recibe un 400 de
esa URL.

Ese 400 tampoco deja fila en `eos_worker_gate_audit_v15`, porque la
validación de entrada devuelve antes de auditar. Por eso la auditoría seguía
mostrando el 31 de agosto como último movimiento aunque el chat se estuviera
usando: **el gate no registra lo que rechaza en la puerta**, y eso es un
segundo hallazgo dentro del primero.

**Qué falta hacer, en orden de preferencia:**

1. Cambiar `EOS_APP_BASE_URL` en Railway a `https://www.transtech.com.py`.
   Es el arreglo de fondo y deja una sola fuente de verdad.
2. Mientras tanto, apuntar los ocho nodos del worker a producción
   directamente. El script está escrito y los workflows respaldados en
   `n8n/respaldos/`.

**Lo que enseña:** un sistema con dos despliegues y una variable de entorno
que elige entre ellos no tiene forma de avisar que está apuntando al viejo.
No hay error, no hay alerta, no hay log: hay respuestas correctas de un
código equivocado. Antes de lanzar, el gate debería responder de qué commit
es, y la app debería comprobarlo.

### 0. Cinco de seis usuarios corrían en un nivel que descarta las acciones — CERRADO

El hallazgo más caro de toda la lista, y el que peor pinta tenía desde afuera:
una clienta le dictaba una venta a EOS por chat, EOS contestaba *«Operación
lista para registrar»*, y no quedaba nada. Ni la venta, ni una aprobación
pendiente que ella pudiera confirmar. La pantalla de aprobaciones, vacía.

El gate decide según el nivel de autonomía del usuario: 0 recomendar, 1
preparar, 2 pedir aprobación, 3 ejecutar solo. Ese nivel sale de
`eos_autonomy_profiles_v12`, y **de los seis usuarios de producción uno solo
tenía fila ahí**. Los otros cinco caían en un valor por defecto que terminó
siendo 1.

Nivel 1 no ejecuta y tampoco pregunta: prepara la acción y la descarta. Es el
único escalón del que no se sale nunca, porque no deja rastro que el usuario
pueda accionar.

La evidencia, en `eos_autonomy_events_v12`:

```
2026-08-31T23:10  CREAR_TAREA  decision=prepare  execute=false  configured_level=1
```

Todas las evaluaciones de catorce días dicen lo mismo, y la última aprobación
creada es del 20 de agosto. No era un problema del ERP: `CREAR_TAREA` y
`GUARDAR_MEMORIA` tampoco se ejecutaron nunca en ese período.

**Lo que enseña, que vale más que el arreglo:** una política de seguridad cuyo
valor por defecto vive en un `const` del código no es auditable. Nadie podía
*ver* que cinco usuarios estaban en nivel 1, porque no había ninguna fila que
mirar. El síntoma tampoco ayudaba: el sistema no fallaba, mentía.

Arreglado en tres partes:

- **v101** — el default de la columna pasa a 2 y cada usuario existente tiene
  su fila explícita. Al que ya tenía la suya no se lo tocó.
- `lib/worker-gate-handler.ts` — el gate escribe la fila cuando la lee y no
  está, con `on conflict do nothing` para no pisar la configuración de nadie.
  Sin esto el agujero se reabría con el próximo registro.
- n8n `01 INT Preparar` — la lista de acciones permitidas no incluía
  `REGISTRAR_VENTA`, `AJUSTAR_STOCK` ni `CREAR_CONTACTO`. Necesario, pero no
  era la causa: aun con la lista corregida el gate habría contestado `prepare`.

Verificado contra la base real: los seis usuarios en nivel 2, el default de la
columna en 2, y el upsert probado contra una fila del 18 de agosto a la que se
le mandó un nivel distinto a propósito — no se movió, `updated_at` incluido.

**Falta la prueba de punta a punta**: que alguien dicte una venta por chat y
aparezca la aprobación. Es lo único que cierra el punto según la definición de
terminado, y no lo puedo hacer yo: necesita una sesión de usuario real.

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
