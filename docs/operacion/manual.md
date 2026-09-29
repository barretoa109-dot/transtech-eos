# Manual de operación de EOS

Tarea **equipo-03** del tablero de lanzamiento: que una persona nueva pueda
atender el día a día sin preguntarle todo al dueño. Escrito el 29/09/2026
contra el código de `main`.

**Este repositorio es público.** Acá van procedimientos y consultas, nunca
claves, correos de clientes ni datos de nadie. Las claves y los accesos van en
el gestor de contraseñas (tarea equipo-01, acceso de emergencia).

Para caídas, restauraciones y despliegues, el documento es
[`docs/rollback-runbook.md`](../rollback-runbook.md). Este manual cubre lo de
todos los días.

---

## 1. La revisión de cada mañana (10 minutos)

| Qué | Cómo | Qué mirar |
|---|---|---|
| Cuentas para contactar hoy | `npm run piloto` | Las filas `INTERVENIR` y `SE ENFRIÓ` van arriba. Tienen nombre y teléfono: no pegues la salida en ningún lado. |
| Cuentas nuevas atascadas | `npm run primeros-pasos` | Quién vinculó WhatsApp y nunca escribió, y quién escribió y nunca anotó nada. |
| Producción sana | `npm run go` | Tiene que decir `RESULTADO AUTOMÁTICO: GO` y qué etapa del gateway atiende. |
| Números de la semana | `npm run tablero` (los viernes llega solo por correo) | Lo marcado con `!!` está del lado malo de su meta. |

Los tres comandos leen producción **en modo lectura** con el
`SUPABASE_ACCESS_TOKEN` de `.env.local`. No escriben nada.

---

## 2. "EOS no anotó lo que le dije"

Es el reclamo más común y casi nunca es el modelo. Hay que mirar en este orden:

1. **¿Existe la acción?** Si lo que pidió no tiene verbo (por ejemplo, el
   retiro del dueño), EOS lo guarda como memoria y suena a que quedó hecho.
   La lista de verbos está en `lib/gateway/sistema.ts`.
2. **¿Qué pasó con ese mensaje?** Desde la v212, cada mensaje deja su rastro
   en `eos_message_usage_v40.turno`, sin el texto:

   ```sql
   select created_at, turno
   from public.eos_message_usage_v40
   where usuario_id = '<id de la cuenta>'
   order by created_at desc
   limit 20;
   ```

   - `solo_memoria: true` quiere decir que la respuesta dijo "anotado" y quedó
     solo como memoria. Es el caso de encargado-03: anotalo en el tablero.
   - `verificacion` dice cómo terminó cada acción (`REGISTRAR_VENTA:confirmada`,
     `...:fallida`).
3. **¿Llegó la acción y se decidió no ejecutarla?**

   ```sql
   select created_at, accion, decision, reason, error_code
   from public.eos_worker_gate_audit_v15
   where usuario_id = '<id>'
   order by created_at desc
   limit 20;
   ```

4. **¿Falló ejecutándose?**

   ```sql
   select created_at, accion, estado, error_code, error_message
   from public.eos_action_commands
   where usuario_id = '<id>'
   order by created_at desc
   limit 20;
   ```

5. **Leé lo que EOS le contestó.** Casi siempre dice qué le faltaba.

Con la causa en la mano, contestale a la persona con lo que pasó y cómo
quedó. Si es un error del producto, va al tablero con la consulta que lo
muestra.

## 3. "Se me borraron los datos"

Antes de buscar un borrado, confirmá que el dato existió alguna vez. El
18/09 y el 20/09 no se había borrado nada: los productos nunca se habían
creado.

```sql
select count(*) filter (where activo) as activos, count(*) as todos
from public.eos_erp_productos where usuario_id = '<id>';
```

Si hay 0 filas en total, nunca se cargaron. Buscá en `eos_action_commands` qué
se pidió (en general un `GUARDAR_MEMORIA` o una compra con renglones libres).
La baja de un producto es lógica (`activo = false`): no hay ninguna ruta que lo
borre de verdad.

## 4. Una cuenta que pasó 24 horas sin valor

`npm run piloto` la marca `INTERVENIR`. Qué hacer:

1. Fijate si vinculó WhatsApp y si escribió algo (`npm run primeros-pasos`).
2. Escribile **una vez**, por el canal por el que llegó, con algo concreto que
   pueda hacer ya: "Mandame por acá tu última venta, por ejemplo *vendí 3
   bolsas a 180 mil*, y te muestro cómo queda".
3. Si contesta con un problema, seguí la sección 2.
4. No insistas más de una vez por semana. No le ofrezcas descuentos.

## 5. Pagos

### Conciliar

- **Bancard (tarjeta):** se acredita solo. Si alguien dice que pagó y no se le
  activó, buscá su solicitud:

  ```sql
  select id, estado, plan_codigo, monto, proveedor, created_at, pagado_at
  from public.solicitudes_pago
  where usuario_id = '<id>'
  order by created_at desc
  limit 5;
  ```

  `pagado` con el plan sin activar es un bug: va al tablero con la consulta.
  `pendiente` quiere decir que Bancard no confirmó. Pedile el comprobante y
  revisá el panel de Bancard antes de activar nada a mano.
- **Transferencia:** se aprueba desde `/admin/pagos`, que solo abre para los
  correos de `ADMIN_EMAILS`. Aprobá solo cuando la plata esté en la cuenta, no
  con la captura del cliente.
- **`npm run go`** avisa si hay pagos pendientes viejos (`Cobros: sin pagos
  pendientes viejos`).

### Lo que no se hace

- No se le cambia el plan a nadie editando `usuarios` a mano: el plan sale de
  los pagos y de los módulos. Hacerlo a mano deja una cuenta que nadie sabe
  por qué tiene lo que tiene.
- No se le frena el uso a nadie por consumo. El aviso de Gs. 70.000 en el mes
  es interno y solo sirve para mirar esa cuenta. Es una decisión del dueño.

## 6. Mensajes que quedaron en espera

Desde la v214, si la IA no responde, el mensaje queda en
`eos_mensajes_en_espera_v214` y se reintenta cada 5 minutos, colgado del
chequeo de salud. Para ver si hay algo trabado:

```sql
select estado, count(*), min(created_at) as el_mas_viejo
from public.eos_mensajes_en_espera_v214
where created_at > now() - interval '2 days'
group by estado;
```

Muchos `esperando` con más de 15 minutos quiere decir que el reintento no está
corriendo. Revisá que el monitor de salud de n8n siga llamando con el secreto.
Los `vencidos` ya recibieron un aviso para que reenvíen el mensaje: no hace
falta hacer nada más con ellos.

## 7. Pedidos sobre los datos de la persona

| Pide | Qué hacer |
|---|---|
| Llevarse sus datos | Perfil → **Descargar mis datos**. Lo hace sola. |
| Borrar su cuenta | Perfil → **Eliminar mi cuenta**, con la frase de confirmación. Borra todo lo suyo, salvo los registros de cobro que la ley obliga a guardar (`docs/privacidad-retencion-de-datos.md`). |
| Que borremos nosotros | Pedile que lo haga desde el perfil. Si no puede entrar, verificá que el pedido venga del correo de la cuenta y pasáselo al dueño. Nunca con un `delete` a mano: el borrado recorre más de cien tablas y además da de baja las tarjetas en Bancard y el acceso. |

## 8. Soporte

- Los pedidos de ayuda desde adentro de EOS (botón **Ayuda**) llegan a
  `soporte@transtech.com.py` con quién es, su plan y desde qué pantalla
  escribió. No hace falta preguntarle esos datos.
- Las respuestas listas para las preguntas más comunes están en
  [`respuestas-preparadas.md`](respuestas-preparadas.md).
- La meta es contestar dentro de las 4 horas hábiles (tarea soporte-01).

## 9. Lo que nunca se hace

- Pegar la salida de `npm run piloto` (tiene nombres y teléfonos) en un chat,
  un issue o un documento del repositorio.
- Probar el chat contra una cuenta real. Para probar está la batería
  (`npm run bateria`), que no ejecuta nada.
- Aplicar una migración o parchear n8n desde una rama sin mergear. Hay un solo
  camino a producción: `main`.
- Prometerle a un cliente algo que el producto no hace.
