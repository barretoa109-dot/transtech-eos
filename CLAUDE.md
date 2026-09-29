@AGENTS.md

# Decisiones del dueño

Ya están tomadas. No se vuelven a proponer como pendientes ni a discutir.

- **Todo plan tiene tope de uso.** El cliente no ve el número, y nunca se le
  dice que no existe: "ilimitado", "sin tope" y "sin límite" no se usan para
  ningún plan, ni en pantallas, ni en términos, ni en material comercial.
- **El tope es un aviso interno, no un freno.** Cuando una cuenta lleva
  Gs. 70.000 de consumo de IA en el mes, le llega un correo al dueño. Al
  usuario nunca se lo frena, se le corta ni se le avisa nada. No proponer un
  freno automático.
- **Vercel Pro y Supabase Pro se pagan con el primer cliente pago**, no antes.
- **Las sesiones de trabajo no ven Vercel ni producción.** No afirmes que una
  variable de entorno está o no cargada, ni que algo está prendido o apagado,
  a partir de un documento de `docs/`: pueden estar atrasados respecto de lo
  que el dueño ya cargó. Preguntá, o pedí la salida de `npm run go`, que dice
  qué etapa del gateway en TypeScript está atendiendo.

# Un solo camino a producción

Lo que cambia producción se aplica **desde `main`, después del merge**, nunca
desde una rama. Vale para las dos cosas que se aplicaban a mano:

- **Migraciones:** `npx supabase db push` desde una carpeta en `origin/main`
  (`C:\Users\galea\eos-db-push`, con `git fetch && git checkout --detach
  origin/main` antes). Para probar una migración antes de mergear, dentro de
  una transacción que termina en `raise exception`, o en el proyecto de
  ensayo; nunca aplicarla en producción desde la rama.
- **Parches de n8n** (`n8n/parches/`), prompt incluido: se mergea el parche,
  se corre desde `main`, y en el mismo movimiento se reexporta
  (`node n8n/exportar.mjs`) y se sube el JSON en un PR.

El workflow `deriva` compara todas las noches producción contra `main`
(migraciones y, si tiene la clave, los workflows de n8n) y queda en rojo si
difieren. Si está en rojo, arreglar la diferencia antes de seguir.
