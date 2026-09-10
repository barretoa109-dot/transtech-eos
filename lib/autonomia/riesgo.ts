/**
 * Cuánto arriesga cada acción, y con qué nivel de autonomía se ejecuta sola.
 *
 * ============================================================
 * POR QUÉ VIVE ACÁ Y NO EN EL HANDLER
 * ============================================================
 *
 * Estaba adentro de `lib/worker-gate-handler.ts`, que importa `next/server`.
 * Eso hace que ninguna prueba de `lib/` pueda importarlo, y esta tabla es
 * justo la que hay que poder probar: una acción sin fila acá muere en la
 * puerta del gate con un 400, y la persona lee "no pude" sin motivo.
 *
 * Es el quinto de los nueve lugares donde hay que dar de alta una acción, y
 * de los que fallan callados.
 *
 * El bloque se movió tal cual, comentarios incluidos: explican decisiones
 * que costaron incidentes de producción y valen más que el código.
 */
export type SystemRisk = {
  tier: number;
  points: number;
  maxLevel: number;
  forceApproval?: boolean;
  defaultLevelOverride?: number;
};

export const SYSTEM_RISK: Record<string, SystemRisk> = {
  RESPONDER: { tier: 0, points: 0, maxLevel: 3 },
  VER_DASHBOARD: { tier: 0, points: 0, maxLevel: 3 },
  VER_BRIEFING: { tier: 0, points: 0, maxLevel: 3 },
  GUARDAR_MEMORIA: { tier: 1, points: 1, maxLevel: 3 },
  GENERAR_EXCEL: { tier: 1, points: 1, maxLevel: 3 },
  GENERAR_PDF: { tier: 1, points: 1, maxLevel: 3 },
  GENERAR_WORD: { tier: 1, points: 1, maxLevel: 3 },
  CREAR_TAREA: { tier: 1, points: 2, maxLevel: 3 },

  /*
   * Crear un objetivo estaba en tier 2 con `maxLevel: 2`, o sea: aprobación
   * explícita SIEMPRE, sin importar el nivel configurado. Era la acción más
   * restringida de todo el sistema.
   *
   * No hay ninguna razón por la que un objetivo sea más peligroso que una
   * tarea. Los dos son una fila que el usuario puede borrar; ninguno mueve
   * plata ni stock. Y desde el 3 de septiembre, registrar una venta —que
   * descuenta inventario y suma un ingreso al panel— se ejecuta sola porque
   * el usuario lo pidió así. Que crear un objetivo fuera lo único que hay que
   * ir a aprobar a otra pantalla no era una política: era el valor con el que
   * quedó en la v12, cuando estas acciones eran un experimento.
   *
   * Se alinea con CREAR_TAREA. Sigue acotado por el presupuesto diario, que
   * es el freno que de verdad protege.
   */
  CREAR_OBJETIVO: { tier: 1, points: 2, maxLevel: 3 },

  /*
   * Las tres que tocan el negocio: registrar venta, ajustar stock, crear
   * contacto.
   *
   * Hasta el 3 de septiembre de 2026 estas tres pedían aprobación explícita
   * sin importar el nivel de autonomía configurado, a propósito: una venta
   * descuenta stock y suma plata al panel, y un ajuste reescribe un
   * inventario. Si el modelo entendía mal "vendile tres panes" y cargaba
   * treinta, el error quedaba escrito en las dos partes del sistema donde
   * más caro sale.
   *
   * El usuario pidió lo contrario, en estos términos exactos: "Auto-aprobar
   * todo lo que venga del chat, sin excepción." Se le preguntó puntualmente
   * por estas tres acciones —las únicas que el gate frenaba— y eligió la
   * opción sin niveles ni montos, no la recomendada.
   *
   * Tres cambios, los tres necesarios juntos:
   *   - `maxLevel: 3` ya no recorta a 2 a quien tenga nivel 3 configurado.
   *   - `forceApproval: false` saca el piso de tier que exigía aprobación
   *     sin importar el nivel.
   *   - `defaultLevelOverride: 3` es lo que hace "sin excepción" cierto:
   *     ninguna fila en `eos_autonomy_rules_v12` puede existir hoy para
   *     estas tres acciones (ver el porqué abajo), así que sin este override
   *     `configuredLevel` caía siempre al 2 de
   *     `DEFAULT_PROFILE.default_level` y las dos condiciones de arriba no
   *     alcanzaban para nadie. No se tocó `DEFAULT_PROFILE.default_level`
   *     en sí, porque ese default rige TODAS las acciones —incluidas
   *     GENERAR_PDF, CREAR_TAREA, GUARDAR_MEMORIA— y de esas no se habló ni
   *     se pidió nada.
   *
   *     `eos_autonomy_rules_v12.accion` tiene un check que sólo admite
   *     RESPONDER, GENERAR_EXCEL/PDF/WORD, CREAR_TAREA, CREAR_OBJETIVO,
   *     GUARDAR_MEMORIA, VER_DASHBOARD y VER_BRIEFING — nunca incluyó estas
   *     tres, así que ninguna fila de excepción por usuario existió nunca
   *     ni puede insertarse hoy para ellas. `rule` siempre da null acá, y
   *     por eso el override rige igual para todos los usuarios de
   *     producción y para cualquiera que se sume después: "sin excepción"
   *     tal cual.
   *
   * Siguen dentro del presupuesto diario de riesgo y del límite de acciones
   * automáticas de `DEFAULT_PROFILE` (más abajo): eso no es una aprobación
   * por acción, es un techo por día, y el usuario no pidió sacarlo.
   *
   * CREAR_OBJETIVO se queda como estaba porque no era una de las tres
   * nombradas en la pregunta ni en la respuesta.
   */
  REGISTRAR_VENTA: {
    tier: 3,
    points: 6,
    maxLevel: 3,
    forceApproval: false,
    defaultLevelOverride: 3,
  },
  AJUSTAR_STOCK: {
    tier: 3,
    points: 6,
    maxLevel: 3,
    forceApproval: false,
    defaultLevelOverride: 3,
  },
  CREAR_CONTACTO: {
    tier: 2,
    points: 3,
    maxLevel: 3,
    forceApproval: false,
    defaultLevelOverride: 3,
  },

  /*
   * Cargar productos al catálogo.
   *
   * Más barato que una venta y por buenas razones: no mueve plata ni descuenta
   * stock, y un producto de más se da de baja en un clic. Lo que sí hace es
   * fijar el precio del que salen todos los márgenes de ahí en adelante, y por
   * eso no es gratis: 2 puntos, como crear una tarea.
   *
   * La protección real no es el nivel sino la regla de la v131: si el nombre
   * ya existe, no se toca. Nunca cambia un precio en silencio.
   */
  CREAR_PRODUCTO: {
    tier: 1,
    points: 2,
    maxLevel: 3,
    forceApproval: false,
    defaultLevelOverride: 3,
  },

  /*
   * Poner el costo y corregir el precio de un producto que ya existe.
   *
   * Cuesta más que crear —3 puntos, como agendar un contacto— y no por
   * simetría: crear de más deja un producto que nadie usa, y actualizar de
   * más pisa un número del que ya salieron márgenes. Un precio equivocado no
   * se nota hasta que alguien mira la rentabilidad del mes.
   *
   * Lo que lo hace seguro no es el nivel sino el alcance de la v133: no toca
   * stock —eso es AJUSTAR_STOCK, que además deja el movimiento asentado— ni
   * moneda, y devuelve el antes y el después de cada campo para que la
   * confirmación diga "de 165.000 a 200.000" en vez de "listo".
   */
  ACTUALIZAR_PRODUCTO: {
    tier: 2,
    points: 3,
    maxLevel: 3,
    forceApproval: false,
    defaultLevelOverride: 3,
  },

  /*
   * La plata que sale.
   *
   * Una compra cuesta lo mismo que una venta —tier 3, 6 puntos— y es de las
   * pocas simetrías que se sostienen solas: las dos mueven plata y stock, las
   * dos dejan un movimiento financiero, y las dos son igual de caras de
   * revertir. Si una venta mal cargada ensucia el inventario y las finanzas a
   * la vez, una compra mal cargada hace exactamente lo mismo con el signo
   * cambiado.
   *
   * El gasto fijo es más barato y más peligroso de otra manera: no mueve un
   * guaraní hoy, pero se proyecta hacia adelante todos los meses. Un fijo de
   * más no descuadra nada; simplemente hace que el pronóstico de caja diga
   * que hay menos plata de la que va a haber. 3 puntos, como agendar un
   * contacto, y la protección real es que la respuesta diga el monto mensual
   * y el día, que es lo que permite verlo mal enseguida.
   */
  REGISTRAR_COMPRA: {
    tier: 3,
    points: 6,
    maxLevel: 3,
    forceApproval: false,
    defaultLevelOverride: 3,
  },
  REGISTRAR_GASTO_FIJO: {
    tier: 2,
    points: 3,
    maxLevel: 3,
    forceApproval: false,
    defaultLevelOverride: 3,
  },

  /*
   * La plata de la persona, que no es la del negocio.
   *
   * Más barata que una compra —2 puntos, como crear una tarea— y no por
   * simetría contable sino porque el daño es distinto. Una compra mal cargada
   * mueve stock y ensucia el margen de un mes entero; un gasto personal mal
   * cargado corre el disponible real de una persona hasta que lo borra, que
   * es un clic.
   *
   * Y sobre todo: si esto costara caro, dejaría de usarse. Anotar "gasté 50
   * mil en nafta" es la única vía que existe para tapar el punto ciego del
   * efectivo, y una vía que se raciona es igual a no tenerla.
   */
  REGISTRAR_MOVIMIENTO_PERSONAL: {
    tier: 1,
    points: 2,
    maxLevel: 3,
    forceApproval: false,
    defaultLevelOverride: 3,
  },

  /*
   * Mover plata entre cuentas propias.
   *
   * Es la más barata de todas —1 punto— y no por descuido: no cambia cuánto
   * tiene la persona, solo dónde lo tiene. Una transferencia mal cargada se
   * borra y no deja rastro en ningún cálculo de flujo, porque por diseño no
   * entra en la tabla de movimientos.
   *
   * Y tiene que ser barata por la misma razón que el gasto rápido: si
   * registrar una transferencia gastara presupuesto de riesgo, la gente
   * dejaría de registrarlas, y volveríamos a tener transferencias anotadas
   * como gastos, que es justo el error que la v138 vino a sacar.
   */
  REGISTRAR_TRANSFERENCIA: {
    tier: 1,
    points: 1,
    maxLevel: 3,
    forceApproval: false,
    defaultLevelOverride: 3,
  },

  /*
   * Las deudas.
   *
   * Declarar una es barata —2 puntos— y tiene que serlo: a alguien endeudado
   * hay que ponerle la menor cantidad de trabas posible para contarle a EOS
   * cuánto debe, que es el dato del que depende todo el centro de deudas.
   *
   * Pagar una cuota cuesta más, 4 puntos, y es la única acción del sistema que
   * escribe en dos tablas: baja el saldo de la deuda y deja el gasto del mes.
   * Un pago mal cargado deja mal las dos cosas a la vez, y sobre el saldo de
   * una deuda se decide a quién pagarle primero el mes siguiente.
   */
  REGISTRAR_DEUDA: {
    tier: 1,
    points: 2,
    maxLevel: 3,
    forceApproval: false,
    defaultLevelOverride: 3,
  },
  REGISTRAR_PAGO_DEUDA: {
    tier: 2,
    points: 4,
    maxLevel: 3,
    forceApproval: false,
    defaultLevelOverride: 3,
  },

  /*
   * Corregir un movimiento cuesta 1 punto: menos que anotarlo.
   *
   * Es deliberado. Una corrección casi siempre existe porque EOS entendió mal
   * un monto, y cobrarle a la persona el mismo presupuesto por el error del
   * sistema que por su propio trabajo la deja sin cupo justo cuando está
   * arreglando algo que no rompió ella.
   *
   * Y no destruye: cambia monto, fecha o descripción de una fila que ya
   * estaba, dejando el valor anterior en `metadata`. Borrar no se puede desde
   * el chat, a propósito — ver la migración v148.
   */
  CORREGIR_MOVIMIENTO: {
    tier: 1,
    points: 1,
    maxLevel: 3,
    forceApproval: false,
    defaultLevelOverride: 3,
  },

  /*
   * Declarar el saldo de una cuenta cuesta 1 punto, el mínimo, y tiene que
   * costarlo.
   *
   * Es el dato del que dependen el patrimonio, el disponible real y la
   * cobertura del fondo de emergencia, y el que más cambia: cada vez que la
   * persona mira su homebanking hay uno nuevo. Cobrarle presupuesto de riesgo
   * por contarle a EOS cuánto tiene la enseñaría a no contárselo, y el sistema
   * entero pasa a proyectar sobre un número viejo.
   *
   * No mueve plata: corrige lo que EOS cree. Y lo único que pisa —el saldo
   * anterior— era, por definición, el que estaba desactualizado.
   */
  DECLARAR_SALDO: {
    tier: 1,
    points: 1,
    maxLevel: 3,
    forceApproval: false,
    defaultLevelOverride: 3,
  },

  /*
   * Cobrar una venta y pagar una compra: 4 puntos, como pagar una cuota.
   *
   * Son las dos acciones del negocio que escriben en DOS lados a la vez —
   * bajan el saldo del documento y dejan el movimiento financiero— y por eso
   * cuestan lo mismo que su hermana personal, REGISTRAR_PAGO_DEUDA.
   *
   * Un cobro mal cargado no solo ensucia la caja: deja una factura como
   * cobrada, y la persona deja de reclamarla. Es de los pocos errores del
   * sistema que le cuestan plata de verdad, y no solo un número mal.
   *
   * Aun así se auto-aprueban, como todo lo que viene del chat: es lo que el
   * usuario pidió en estos términos —"auto-aprobar todo lo que venga del
   * chat, sin excepción"— y el freno real es el presupuesto diario, no una
   * pantalla de aprobación que nadie mira.
   */
  REGISTRAR_COBRO: {
    tier: 2,
    points: 4,
    maxLevel: 3,
    forceApproval: false,
    defaultLevelOverride: 3,
  },
  REGISTRAR_PAGO_COMPRA: {
    tier: 2,
    points: 4,
    maxLevel: 3,
    forceApproval: false,
    defaultLevelOverride: 3,
  },
};

/**
 * Las acciones que tienen su riesgo declarado.
 *
 * Se exporta solo para que una prueba pueda comprobar que ninguna acción del
 * prompt se quedó sin fila. Sin fila, el gate la rechaza en la puerta con un
 * 400 y la persona lee "no pude" sin motivo — el quinto de los nueve lugares
 * donde hay que dar de alta una acción, y de los que fallan callados.
 */
export const ACCIONES_CON_RIESGO = new Set(Object.keys(SYSTEM_RISK));
