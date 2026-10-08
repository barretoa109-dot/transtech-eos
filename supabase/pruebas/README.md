# Pruebas de extremo a extremo contra la base

No son migraciones: no se aplican. Cada archivo corre **dentro de una
transacción que termina en `rollback`**, así que no deja una sola fila, y devuelve
una fila por comprobación (`ok = true` en todas).

| Archivo | Qué prueba | Cómo se corre |
|---|---|---|
| `negocio_e2e.sql` | CRM → venta → inventario → ingreso → oportunidad ganada; stock bajo; cartera vencida; plata personal que no toca el negocio; dos empresas aisladas (RLS) | `npx supabase db query --linked -f supabase/pruebas/negocio_e2e.sql` |
| `compra_vence_el_e2e.sql` | Compras a crédito con vencimiento (v180): se guarda, corregir lo conserva, al contado no aplica | Ver la cabecera del archivo: va tras la v180 |
| `chat_vence_el_e2e.sql` | El chat traduce "me paga el 30" / "en 15 días" a un vencimiento (v182), incluida la compra por el chat completa | Ver la cabecera: va tras la v182 |
| `whatsapp_crm_e2e.sql` | Canal de WhatsApp de la empresa (v177): recepción, dedupe, baja, oportunidad, seguimiento, aislamiento | Ver la cabecera del archivo: va **después** de la migración v177 |
| `crm_completo_e2e.sql` | CRM completo (v185): ficha del cliente, oportunidades, etapas configurables, seguimientos y token de WhatsApp en Vault | Ver la cabecera: va tras la v185 |
| `chat_escribe_cliente_e2e.sql` | El chat le escribe a un cliente (v186): valida cliente único, texto, canal, teléfono y baja; aislamiento entre cuentas; permisos | Ver la cabecera: **se corre con v185 + v186 concatenadas** si todavía no están aplicadas. Las migraciones NO llevan `commit` de nivel superior a propósito |
| `aislamiento_rls_e2e.sql` | Dos cuentas: B no ve ni toca lo de A (usuario, mensajes, memorias, objetivos, pagos, consumo, aprobaciones); A no se puede asignar un plan pago ni poner su consumo en cero; anon no lee usuarios; toda tabla de public tiene RLS (v197) | `npx supabase db query --linked -f supabase/pruebas/aislamiento_rls_e2e.sql`, o local con `supabase/pruebas/local/reconstruir.sh` |
| `finanzas_no_repite_e2e.sql` | El caso Green del 29/09/2026 (v222 + v226): la compra con tarjeta y el ingreso van cada uno a su lugar; la misma compra reenviada no se duplica; un gasto de una captura que ya estaba no se vuelve a anotar; la tarjeta repetida no cambia el resumen y un cambio dice su antes; el pago explícito de la tarjeta baja el usado; dos iguales de verdad sí se anotan | Ver la cabecera: **se corre con `finanzas_no_repite_e2e_inicio.sql` + v222 + v226 + la prueba** si no están aplicadas |
| `plan_efectivo_e2e.sql` | INC-09 (v228): un tramo de conversaciones pago y vigente cuenta para el cupo aunque `usuarios.plan` diga free; las cortesías no suben el plan; vencido, suspendido y sin módulos siguen como antes; solo el servidor ejecuta la función | Ver la cabecera: **se corre con `plan_efectivo_e2e_inicio.sql` + v228 + la prueba** si la v228 no está aplicada |
| `aprobacion_whatsapp_e2e.sql` | Aprobación por WhatsApp (INC-25): otra cuenta no aprueba ni consume; el segundo SÍ no vuelve a aprobar; un payload distinto del aprobado no se ejecuta; no se consume dos veces; vencida no se ejecuta | `plan_efectivo_e2e_inicio.sql` (solo `begin;`) + la prueba |
| `venta_citada_e2e.sql` | Casos de WhatsApp del 01/10/2026 (v231): el mensaje citado se encuentra por su id de WhatsApp y solo en su cuenta; la venta guarda producto, clienta, precio, costo y la nota ("sobrepedido"); un reintento no duplica; vender no cambia costos del catálogo; un pedido que falla no deja nada; otra cuenta no ve mensajes, ventas ni productos | `plan_efectivo_e2e_inicio.sql` + v231 + la prueba |
| `memoria_e2e.sql` | Memoria entre turnos: se escribe con el ejecutor del chat, el turno siguiente la lee, un reintento no duplica, una corrección reemplaza y guarda el dato anterior, otra persona no la ve, sin autorización no se escribe, lo archivado no se revive | `plan_efectivo_e2e_inicio.sql` + la prueba |
| `crear_decision_e2e.sql` | CREAR_DECISION (v236): se guarda con la métrica declarada, `fecha_revision` cae a +14 días (trigger v179), un reintento no duplica, sin `decision` falla sin escribir, sin autorización no se escribe, otra cuenta no la ve | Ver la cabecera: va **después** de aplicar la v236 |

Los indicadores del Dashboard y la salud financiera se calculan en TypeScript
(`lib/kpi`) y tienen sus tests con `npm test`; estas pruebas comprueban los
datos de los que se alimentan.

Resumen legible de la salida:

```bash
npx supabase db query --linked -f supabase/pruebas/negocio_e2e.sql > salida.json
node -e 'const t=require("fs").readFileSync("salida.json","utf8");const r=JSON.parse(t.slice(t.indexOf("{"))).rows;for(const x of r)console.log((x.ok?"OK   ":"FALLA")+" "+x.prueba)'
```
