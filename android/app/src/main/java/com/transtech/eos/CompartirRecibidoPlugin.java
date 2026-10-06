package com.transtech.eos;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Recibe el texto que otra app comparte con EOS ("Compartir" → TransTech EOS)
 * y lo entrega al chat web con el evento `compartido`. Si el chat todavía no
 * está escuchando (la persona tiene que iniciar sesión primero), el evento se
 * retiene hasta que alguien lo consuma. Ver `lib/app-nativa/cliente.ts` y
 * `docs/app-nativa/tiendas.md`.
 */
@CapacitorPlugin(name = "CompartirRecibido")
public class CompartirRecibidoPlugin extends Plugin {

    private static String pendiente;
    private static CompartirRecibidoPlugin activo;

    /** Guarda el texto de un intent ACTION_SEND de texto plano. Ignora cualquier otra cosa. */
    static void recibir(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        if (!"text/plain".equals(intent.getType())) return;

        CharSequence texto = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (texto == null) return;

        pendiente = texto.toString();
        if (activo != null) activo.notificar();
    }

    @Override
    public void load() {
        activo = this;
        if (pendiente != null) notificar();
    }

    private void notificar() {
        if (pendiente == null) return;
        JSObject datos = new JSObject();
        datos.put("texto", pendiente);
        pendiente = null;
        notifyListeners("compartido", datos, true);
    }
}
