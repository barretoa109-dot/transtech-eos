# WhatsApp de la empresa con sus clientes

Dos canales que **no se mezclan**:

| | Canal Usuario ↔ EOS | Canal Empresa ↔ Cliente |
|---|---|---|
| Quién escribe | La persona, a EOS | El cliente, al WhatsApp Business de la empresa |
| Tabla | `eos_whatsapp_vinculos_v162` | `eos_wa_canales` (v177) |
| Identifica por | teléfono verificado con código | `metadata.phone_number_id` de Meta |
| Qué hace EOS | Ejecuta lo que la persona pide | Registra, entiende y ayuda a hacer seguimiento |

Los dos comparten la URL del webhook (`app/api/whatsapp/webhook/route.ts`). El
webhook mira **primero** el `phone_number_id`: si es de un canal de empresa,
entrega todo a `lib/whatsapp-crm/entrante.ts` y no sigue. Sin ese desvío, un
cliente preguntando un precio caería en el camino de "número sin vincular" y se
lo trataría como alguien que quiere abrir una cuenta de EOS.

## El recorrido de un mensaje

```
Cliente ── WhatsApp ──▶ Meta ──▶ webhook (firma HMAC)
                                   │
                    ¿phone_number_id de un canal de empresa?
                                   │ sí
                                   ▼
                   prepararEntrantes()   ← lib/whatsapp-crm/entrante.ts (puro)
                     · lee texto, botón o pie de foto
                     · clasificarIntencion()  ← intencion.ts (puro)
                                   │
                                   ▼
                   eos_wa_recibir_v177()   ← UNA transacción, idempotente
                     · encuentra al cliente DENTRO de la empresa (o lo crea)
                     · guarda el mensaje (dedupe por wamid)
                     · ultima_interaccion_en + actividad "whatsapp"
                     · consentimiento / baja
                     · oportunidad · seguimiento · aviso al dueño
```

Lo que pide cada intención:

| El cliente dice | Intención | En el CRM |
|---|---|---|
| "¿Cuánto cuesta el plan empresarial?" | `consulta_precio` | Abre una oportunidad (etapa *nueva*) |
| "Me interesa, ¿tienen disponible?" | `interes` | Abre una oportunidad |
| "Lo voy a pensar" | `lo_pensara` | Tarea de seguimiento a 3 días |
| "Dale, confirmo" | `confirma_compra` | Oportunidad a *negociación* + aviso al dueño para **autorizar la venta** |
| "Quiero hablar con una persona" / reclamo | `pide_persona` | Aviso al dueño |
| "STOP", "no me escriban más" | `baja` | Revoca el consentimiento. Nada más se le envía |

`confirma_compra` **no cierra una venta sola**: la venta mueve inventario y
plata, y una conversación de WhatsApp no es un comprobante. La oportunidad pasa a
*ganada* cuando la venta existe (`eos_crm_embudo_desde_ventas`).

## Qué protege a la empresa y a su número

* **Consentimiento** (`eos_wa_consentimientos`): una fila por cliente y canal.
  `revocado` gana sobre todo y **no se levanta porque el cliente vuelva a
  escribir**.
* **Ventana de 24 h**: texto libre solo si el cliente escribió en las últimas 24
  horas. Pasado ese plazo, solo una **plantilla aprobada** por Meta
  (`eos_wa_plantillas`).
* **Límites**: diario por número (250 por defecto, conservador; el tope real lo
  fija Meta) y por cliente (2 mensajes automáticos por día).
* **Silencio nocturno** 21:00–07:00 (Paraguay) para lo que EOS inicia. Contestar
  al instante a quien acaba de escribir no cuenta como molestar.
* **Autorización**: lo que EOS inicia por su cuenta no sale sin el "Sí,
  escribile" del dueño o una regla de autonomía. Contestarle a un cliente que
  acaba de escribir sí puede hacerlo EOS (y solo si la empresa activó
  `respuesta_automatica`, apagada por defecto).
* **Auditoría**: cada mensaje queda con su decisión y su motivo
  (`eos_wa_mensajes.estado`, `.motivo`), y las acciones automáticas en
  `eos_wa_eventos`, que es **append-only**: ni `service_role` puede editar o
  borrar filas.
* **Aislamiento**: todas las tablas llevan `usuario_id` y `empresa_id` y la
  misma policy de lectura que el resto del ERP/CRM. Un cliente de otra empresa
  no puede recibir por este canal (`EOS_WA_CONTACTO_AJENO`), y el mismo teléfono
  en dos empresas son dos clientes.

La política de envío es **una sola** y vive en TypeScript
(`lib/whatsapp-crm/politica.ts`, `evaluarEnvio`), donde se prueba. La base solo
trae los números (`eos_wa_contexto_envio_v177`) y registra lo decidido
(`eos_wa_registrar_saliente_v177`, que registra también lo **bloqueado**, con su
motivo).

## Qué está hecho y qué falta

**Hecho y probado** (v177, v185 y v186)

* Esquema, RLS, bitácora inmutable, funciones (v177).
* Recepción completa: cliente, mensaje, última interacción, actividad,
  consentimiento, baja, oportunidad, seguimiento, aviso.
* **Conectar un canal desde la pantalla** (CRM > Conversaciones): la empresa pega su
  `phone_number_id` y su token. El token va a **Vault** (`eos_wa_guardar_secreto_v185`), nunca a
  la tabla, y solo lo lee el servidor con la clave de servicio. Cada canal tiene su
  `verify_token` y, si la empresa usa su propia app de Meta, su propio secreto de firma.
* **Enviar** por el canal de la empresa (`lib/whatsapp-crm/enviar.ts`) con la política completa:
  consentimiento, ventana de 24 h, plantillas aprobadas, tope diario y horario de silencio. Todo
  envío queda registrado, también el que se bloquea, con su motivo. Idempotente por clave.
* **Plantillas**: alta, sincronización de estado con Meta y uso desde la caja de respuesta.
* **Conversaciones** en el CRM y **ficha del cliente** con su historia.
* **Seguimientos** (CRM > Para retomar): quién no contestó, qué oportunidad se estancó, qué cierre
  se acerca, con un mensaje propuesto **editable** y el "Sí, escribile". Un aviso diario por correo
  o push de lo urgente, sin repetirlo.
* **"Sí, escribile" en el chat** (`ENVIAR_WHATSAPP_CLIENTE`, v186): el ejecutor valida, el servidor
  envía con la misma política. EOS solo lo emite con el texto confirmado, y dice lo que Meta
  contestó de verdad.
* **EOS aprende** de las oportunidades cerradas (tasa, ciclo, motivos de pérdida, origen) y lo usa
  en el chat.
* **Lectura de intención con IA** por encima de las reglas (`lib/whatsapp-crm/intencion-ia.ts`).
  **Apagada por defecto**: ver más abajo.
* Pruebas de punta a punta de la base: `supabase/pruebas/whatsapp_crm_e2e.sql`,
  `crm_completo_e2e.sql` y `chat_escribe_cliente_e2e.sql`.

**Falta, y depende de la empresa o de Meta (no es código)**

1. **El token de acceso** de la cuenta de WhatsApp Business de cada empresa. Lo entrega Meta al
   completar el *Embedded Signup* (o lo genera la empresa en su app de Meta con el permiso
   `whatsapp_business_messaging`). Sin token, nada sale; el resto funciona.
2. **Plantillas aprobadas.** Cada plantilla la revisa Meta (horas o días). Hasta entonces, EOS solo
   puede escribir dentro de las 24 h de que el cliente escribió.
3. **Suscripción del webhook**: en la app de Meta, suscribir el campo `messages` de cada WABA a la
   URL existente. No hay que crear otra.
4. **Embedded Signup** (alta con un clic, sin pegar el token) requiere una app de Meta con
   verificación de negocio: es un trámite de TransTech con Meta.
5. **Encender la lectura con IA** es una decisión de la empresa: manda el texto de un CLIENTE suyo a
   un proveedor de IA. Se enciende con `EOS_INTENCION_IA=1` (y `OPENAI_API_KEY`); el modelo se
   cambia con `EOS_INTENCION_MODELO`. Sin la variable, todo sigue exactamente como antes.

## Orden de despliegue

1. Aplicar las migraciones **v185** y **v186** en la base (`db push`).
2. Mergear y desplegar el código.
3. Aplicar el parche de n8n del chat (`node n8n/parches/2026-09-19-chat-escribe-cliente.mjs`), después
   exportar y sincronizar el prompt.

Si el código sale antes que las migraciones, todo lo nuevo se apaga solo sin romper lo de antes: las
lecturas caen a las columnas de siempre y las escrituras de la ficha responden que todavía no están
disponibles. Si el prompt de n8n sale antes que la v186, el verbo nuevo lo rechaza un CHECK de la base
y la persona lee "no pude": por eso el orden.
