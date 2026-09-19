# Pruebas de extremo a extremo contra la base

No son migraciones: no se aplican. Cada archivo corre **dentro de una
transacción que termina en `rollback`**, así que no deja una sola fila, y devuelve
una fila por comprobación (`ok = true` en todas).

| Archivo | Qué prueba | Cómo se corre |
|---|---|---|
| `negocio_e2e.sql` | CRM → venta → inventario → ingreso → oportunidad ganada; stock bajo; cartera vencida; plata personal que no toca el negocio; dos empresas aisladas (RLS) | `npx supabase db query --linked -f supabase/pruebas/negocio_e2e.sql` |
| `compra_vence_el_e2e.sql` | Compras a crédito con vencimiento (v180): se guarda, corregir lo conserva, al contado no aplica | Ver la cabecera del archivo: va tras la v180 |
| `whatsapp_crm_e2e.sql` | Canal de WhatsApp de la empresa (v177): recepción, dedupe, baja, oportunidad, seguimiento, aislamiento | Ver la cabecera del archivo: va **después** de la migración v177 |

Los indicadores del Dashboard y la salud financiera se calculan en TypeScript
(`lib/kpi`) y tienen sus tests con `npm test`; estas pruebas comprueban los
datos de los que se alimentan.

Resumen legible de la salida:

```bash
npx supabase db query --linked -f supabase/pruebas/negocio_e2e.sql > salida.json
node -e 'const t=require("fs").readFileSync("salida.json","utf8");const r=JSON.parse(t.slice(t.indexOf("{"))).rows;for(const x of r)console.log((x.ok?"OK   ":"FALLA")+" "+x.prueba)'
```
