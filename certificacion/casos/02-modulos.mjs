/**
 * Que elegir qué EOS querés dé siempre el mismo precio.
 *
 * ============================================================
 * POR QUÉ ESTO ES CRÍTICO
 * ============================================================
 *
 * El precio se calcula en DOS lugares: en el navegador, para que el total se
 * mueva mientras la persona toca los interruptores, y en la base, que es la
 * que manda cuando se cobra. Si esos dos números se separan, alguien ve
 * Gs. 145.000 en pantalla y le llega otra cosa a la tarjeta. No hay disculpa
 * que arregle eso.
 *
 * Acá se comprueba contra la base, que es la que cobra. La otra mitad —que el
 * navegador calcule igual— la cubren las pruebas de `lib/modulos/armado.ts`.
 *
 * También se cuida el tope: prender todo tiene que dar exactamente
 * Gs. 500.000, que es lo que se prometió. Un catálogo que crece sin que nadie
 * mire el techo convierte esa promesa en mentira de a poco.
 */

const TOPE = 500_000;

export const caso = {
  numero: 2,
  nombre: "Elegir módulos y saber cuánto cuesta",
  critico: true,

  async correr({ admin, usuario, comprobar, alTerminar }) {
    const cliente = admin();

    const { data: catalogo, error } = await cliente
      .from("eos_modulos")
      .select("codigo,nombre,precio_mensual_pyg,activo")
      .order("precio_mensual_pyg", { ascending: false });

    comprobar("el catálogo se puede leer", !error && (catalogo?.length ?? 0) > 0);

    if (!catalogo?.length) return;

    const codigos = catalogo.map((m) => m.codigo);

    const precio = async (mods, periodicidad = "mensual") => {
      const { data } = await cliente.rpc("eos_precio_armado", {
        p_modulos: mods,
        p_periodicidad: periodicidad,
      });

      return Number(data?.total ?? -1);
    };

    // ---------- El techo ----------
    const todo = await precio(codigos);

    comprobar(
      `prender todo cuesta el tope prometido`,
      todo === TOPE,
      `Gs. ${todo.toLocaleString("es-PY")}`,
    );

    // ---------- Los tres paquetes que se piensan vender ----------
    const paquetes = [
      ["EOS Finanzas", ["dashboard", "lectura", "alertas", "briefing", "conversaciones"]],
      [
        "EOS Comercio",
        ["dashboard", "lectura", "alertas", "briefing", "conversaciones", "erp", "crm", "documentos"],
      ],
    ];

    for (const [nombre, mods] of paquetes) {
      const existen = mods.every((m) => codigos.includes(m));

      comprobar(`${nombre}: todos sus módulos existen`, existen);

      if (!existen) continue;

      const total = await precio(mods);
      const suma = mods.reduce(
        (t, m) => t + Number(catalogo.find((c) => c.codigo === m)?.precio_mensual_pyg ?? 0),
        0,
      );

      comprobar(
        `${nombre}: el total es la suma de sus partes`,
        total === Math.min(suma, TOPE),
        `Gs. ${total.toLocaleString("es-PY")}`,
      );
    }

    // ---------- Un armado no puede costar más que el tope ----------
    comprobar("ningún armado supera el tope", todo <= TOPE);

    // ---------- Se guarda y se puede volver a leer ----------
    const elegidos = ["dashboard", "briefing"];
    const esperado = await precio(elegidos);

    const { data: armado, error: errorArmado } = await cliente.rpc("eos_guardar_armado", {
      p_usuario_id: usuario.id,
      p_modulos: elegidos,
      p_periodicidad: "mensual",
    });

    const armadoId = armado?.armado_id ?? armado?.id;

    comprobar("se puede guardar lo elegido", !errorArmado && Boolean(armadoId), errorArmado?.message ?? "");

    if (!armadoId) return;

    alTerminar(async () => {
      await cliente.from("eos_planes_armados").delete().eq("id", armadoId);
    });

    const { data: guardado } = await cliente
      .from("eos_planes_armados")
      .select("monto,modulos,estado")
      .eq("id", armadoId)
      .maybeSingle();

    comprobar(
      "y se guarda con el precio que se mostró",
      Number(guardado?.monto) === esperado,
      `Gs. ${Number(guardado?.monto ?? 0).toLocaleString("es-PY")}`,
    );

    comprobar(
      "con los módulos que se eligieron",
      elegidos.every((m) => (guardado?.modulos ?? []).includes(m)),
    );

    // ---------- El anual no puede salir más caro que doce meses ----------
    const anual = await precio(elegidos, "anual");

    comprobar(
      "el pago anual conviene, no castiga",
      anual > 0 && anual < esperado * 12,
      `Gs. ${anual.toLocaleString("es-PY")} vs ${(esperado * 12).toLocaleString("es-PY")}`,
    );
  },
};
