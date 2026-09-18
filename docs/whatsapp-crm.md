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

**Hecho y probado**

* Esquema, RLS, bitácora inmutable, funciones (v177).
* Recepción completa: cliente, mensaje, última interacción, actividad,
  consentimiento, baja, oportunidad, seguimiento, aviso.
* Confirmaciones de entrega y lectura (estados que solo avanzan).
* Política de envío, lectura de intención, normalización de teléfonos.
* Prueba de punta a punta de la base: `supabase/pruebas/whatsapp_crm_e2e.sql`
  (dos empresas, mismo teléfono, RLS, anon, idempotencia).

**Falta, y por qué**

1. **Enviar.** Hace falta el **token de acceso** de la cuenta de WhatsApp
   Business de cada empresa. Lo entrega Meta al completar el *Embedded Signup*
   (o lo genera la empresa en su app de Meta con permiso
   `whatsapp_business_messaging`). Debe guardarse en **Supabase Vault** y
   referenciarse en `eos_wa_canales.secreto_ref`; nunca en la tabla.
   Sin token, el código de envío no puede probarse contra Meta.
2. **Plantillas aprobadas.** Cada plantilla se registra en el Business Manager
   de la empresa y Meta la revisa (horas o días). Hasta entonces, EOS solo puede
   contestar dentro de la ventana de 24 h.
3. **Alta de un canal desde la interfaz.** Requiere el flujo de Embedded Signup
   (una app de Meta con verificación de negocio, que es un trámite de
   TransTech con Meta, no de código) o, como alternativa, un formulario para que
   la empresa pegue su `phone_number_id` y su token.
4. **Pantalla de conversaciones en el CRM** y el "Sí, escribile" que dispara el
   envío autorizado.
5. **Suscripción del webhook**: en la app de Meta, suscribir el campo
   `messages` de cada WABA a la URL existente. No hay que crear otra.

## Orden de despliegue

1. Aplicar la **v177** en la base.
2. Desplegar el código.

Si el código sale antes, el webhook trata la tabla inexistente como "no hay
canales de empresa" y sigue funcionando para los usuarios de EOS
(`buscarCanalEmpresa`, error `42P01`/`PGRST205`).
