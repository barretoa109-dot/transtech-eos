import crypto from "node:crypto";
import { CONFIG } from "../entorno.mjs";

/**
 * Que alguien pueda crear una cuenta y quedar listo para usar EOS.
 *
 * ============================================================
 * LO QUE ESTE CASO CUIDA
 * ============================================================
 *
 * Que el perfil se cree solo. `handle_new_user` es el único dueño de esa fila y
 * fuerza el plan desde el servidor: si dejara de dispararse, alguien se
 * registraría, entraría, y EOS no sabría quién es. Y si el plan lo pudiera
 * decidir el cliente, cualquiera se daría a sí mismo el plan más caro gratis.
 *
 * Que el nombre venga del proveedor cuando el formulario no lo manda. Google
 * manda `full_name`, no `nombre`: sin eso la persona queda llamándose por la
 * parte izquierda de su correo, y ese nombre es el que después aparece en el
 * saludo del chat, en el briefing y en el comprobante.
 *
 * ============================================================
 * LO QUE NO PUEDE CUBRIR, Y HAY QUE MIRAR A MANO
 * ============================================================
 *
 * El login con Google de punta a punta, porque exige escribir una contraseña en
 * el formulario de Google. Acá se comprueba que el proveedor esté habilitado y
 * que el intercambio esté configurado; que la persona termine adentro se mira
 * a mano. Está en la lista del README.
 */

export const caso = {
  numero: 1,
  nombre: "Registro con correo y con Google",
  critico: true,

  async correr({ admin, comprobar, alTerminar }) {
    const cliente = admin();
    const correo = `cert-${crypto.randomUUID().slice(0, 8)}@transtech.test`;

    // ---------- Registro con correo ----------
    const { data: creado, error: errorCrear } = await cliente.auth.admin.createUser({
      email: correo,
      password: crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { nombre: "Cliente de Certificación", whatsapp: "0981000000" },
    });

    comprobar("se puede crear una cuenta", !errorCrear, errorCrear?.message ?? "");

    if (errorCrear || !creado?.user) return;

    const id = creado.user.id;
    alTerminar(() => cliente.auth.admin.deleteUser(id));

    const perfil = async () =>
      (await cliente.from("usuarios").select("nombre,email,plan").eq("id", id).maybeSingle()).data;

    const p = await perfil();

    comprobar("el perfil se crea solo", Boolean(p));
    comprobar("con el nombre que escribió", p?.nombre === "Cliente de Certificación", p?.nombre ?? "");
    comprobar("con su correo", p?.email === correo);
    comprobar("y arranca en el plan gratuito", p?.plan === "free", p?.plan ?? "");

    // ---------- El nombre que manda Google ----------
    const correoOauth = `cert-oauth-${crypto.randomUUID().slice(0, 8)}@transtech.test`;

    const { data: oauth } = await cliente.auth.admin.createUser({
      email: correoOauth,
      email_confirm: true,
      // Como los manda Google: `full_name`, nunca `nombre`.
      user_metadata: { full_name: "Rossana Giménez", avatar_url: "https://ejemplo/x.png" },
    });

    if (oauth?.user) {
      alTerminar(() => cliente.auth.admin.deleteUser(oauth.user.id));

      const { data: pg } = await cliente
        .from("usuarios")
        .select("nombre")
        .eq("id", oauth.user.id)
        .maybeSingle();

      comprobar(
        "quien entra con Google llega con su nombre y no con su correo",
        pg?.nombre === "Rossana Giménez",
        pg?.nombre ?? "",
      );
    }

    // ---------- Google, del lado de la configuración ----------
    const ajustes = await fetch(`${CONFIG.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: CONFIG.anonKey },
    })
      .then((r) => r.json())
      .catch(() => ({}));

    comprobar("el proveedor Google está habilitado", ajustes?.external?.google === true);

    const redireccion = await fetch(
      `${CONFIG.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(
        CONFIG.sitio + "/auth/callback",
      )}`,
      { redirect: "manual" },
    ).catch(() => null);

    const destino = redireccion?.headers?.get("location") ?? "";

    comprobar(
      "y manda a Google con credenciales cargadas",
      destino.includes("accounts.google.com") && destino.includes("client_id="),
      destino ? "" : "sin redirección",
    );

    // ---------- La vuelta de Google ----------
    const callback = await fetch(`${CONFIG.sitio}/auth/callback`, { redirect: "manual" }).catch(
      () => null,
    );

    comprobar(
      "la vuelta sin código no deja a nadie colgado",
      (callback?.headers?.get("location") ?? "").includes("/login?error="),
      callback ? "" : "no respondió",
    );
  },
};
