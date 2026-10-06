package com.transtech.eos;

import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Recibe lo que otra app comparte con EOS ("Compartir" → TransTech EOS): texto,
 * o una imagen (foto, comprobante). Lo entrega al chat web con el evento
 * `compartido`. Si el chat todavía no está escuchando (la persona tiene que
 * iniciar sesión primero), el evento se retiene hasta que alguien lo consuma.
 * Ver `lib/app-nativa/cliente.ts` y `docs/app-nativa/tiendas.md`.
 */
@CapacitorPlugin(name = "CompartirRecibido")
public class CompartirRecibidoPlugin extends Plugin {

    /** Un archivo más grande que esto no se manda: el puente lo pasaría entero en memoria. */
    private static final int TAMANO_MAXIMO = 8 * 1024 * 1024;

    private static JSObject pendiente;
    private static CompartirRecibidoPlugin activo;

    /** Guarda lo que llegó en un intent ACTION_SEND. Ignora cualquier otra cosa. */
    static void recibir(Intent intent, android.content.ContentResolver resolver) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String tipo = intent.getType();
        if (tipo == null) return;

        if (tipo.equals("text/plain")) {
            CharSequence texto = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (texto == null) return;
            JSObject datos = new JSObject();
            datos.put("texto", texto.toString());
            guardar(datos);
            return;
        }

        if (tipo.startsWith("image/")) {
            @SuppressWarnings("deprecation")
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri == null) return;
            JSObject archivo = leerImagen(uri, tipo, resolver);
            if (archivo == null) return;
            JSObject datos = new JSObject();
            datos.put("archivo", archivo);
            guardar(datos);
        }
    }

    /** Lee la imagen compartida, o devuelve null si no se pudo leer o es demasiado grande. */
    private static JSObject leerImagen(Uri uri, String tipo, android.content.ContentResolver resolver) {
        try (InputStream entrada = resolver.openInputStream(uri)) {
            if (entrada == null) return null;
            ByteArrayOutputStream salida = new ByteArrayOutputStream();
            byte[] buffer = new byte[16 * 1024];
            int leidos;
            while ((leidos = entrada.read(buffer)) != -1) {
                salida.write(buffer, 0, leidos);
                if (salida.size() > TAMANO_MAXIMO) return null;
            }

            String nombre = uri.getLastPathSegment();
            if (nombre == null || nombre.isEmpty()) nombre = "compartido";

            JSObject archivo = new JSObject();
            archivo.put("nombre", nombre);
            archivo.put("mime", tipo);
            archivo.put("base64", Base64.encodeToString(salida.toByteArray(), Base64.NO_WRAP));
            return archivo;
        } catch (IOException | SecurityException e) {
            return null;
        }
    }

    private static void guardar(JSObject datos) {
        pendiente = datos;
        if (activo != null) activo.notificar();
    }

    @Override
    public void load() {
        activo = this;
        if (pendiente != null) notificar();
    }

    private void notificar() {
        if (pendiente == null) return;
        JSObject datos = pendiente;
        pendiente = null;
        notifyListeners("compartido", datos, true);
    }
}
