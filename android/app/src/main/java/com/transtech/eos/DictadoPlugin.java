package com.transtech.eos;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

/**
 * El dictado por voz con el reconocedor nativo de Android, para cuando la app
 * corre instalada: el WebView no tiene `SpeechRecognition` del navegador
 * (`app/eos/components/useDictado.ts`). Mismo contrato de eventos que
 * `DictadoPlugin.swift` en iOS: ver `lib/app-nativa/cliente.ts`.
 *
 * `empezar()` **nunca rechaza**: resuelve `{}` con el micrófono abierto de
 * verdad (`onReadyForSpeech`), o `{ error: <código> }` con uno de los códigos
 * que entiende `mensajeDeErrorDeVoz` (`lib/eos/dictado.ts`). Así el lado
 * JavaScript no depende de cómo cada plataforma cruza un rechazo de promesa
 * por el puente de Capacitor.
 *
 * El número de sesión descarta los eventos de un reconocedor que ya se
 * canceló pero todavía tenía algo en vuelo, el mismo problema (y la misma
 * solución) que documenta `useDictado.ts` del lado web.
 */
@CapacitorPlugin(
    name = "Dictado",
    permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microfono") }
)
public class DictadoPlugin extends Plugin {

    private SpeechRecognizer reconocedor;
    private int sesion = 0;

    @PluginMethod
    public void empezar(PluginCall call) {
        if (getPermissionState("microfono") == PermissionState.GRANTED) {
            arrancar(call);
            return;
        }
        requestPermissionForAlias("microfono", call, "alPedirPermiso");
    }

    @PermissionCallback
    private void alPedirPermiso(PluginCall call) {
        if (getPermissionState("microfono") != PermissionState.GRANTED) {
            JSObject datos = new JSObject();
            datos.put("error", "not-allowed");
            call.resolve(datos);
            return;
        }
        arrancar(call);
    }

    @PluginMethod
    public void cancelar(PluginCall call) {
        sesion++;
        getActivity().runOnUiThread(this::apagar);
        call.resolve();
    }

    private void arrancar(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            JSObject datos = new JSObject();
            datos.put("error", "network");
            call.resolve(datos);
            return;
        }

        sesion++;
        final int miSesion = sesion;
        final String idioma = call.getString("idioma", "es-PY");

        getActivity().runOnUiThread(() -> {
            apagar();

            reconocedor = SpeechRecognizer.createSpeechRecognizer(getContext());
            reconocedor.setRecognitionListener(new RecognitionListener() {
                @Override
                public void onReadyForSpeech(Bundle params) {
                    if (miSesion != sesion) return;
                    call.resolve(new JSObject());
                }

                @Override
                public void onResults(Bundle resultados) {
                    avisar(resultados, true);
                }

                @Override
                public void onPartialResults(Bundle resultados) {
                    avisar(resultados, false);
                }

                private void avisar(Bundle resultados, boolean definitivo) {
                    if (miSesion != sesion) return;

                    ArrayList<String> lista = resultados.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    String texto = (lista == null || lista.isEmpty()) ? "" : lista.get(0);

                    JSObject datos = new JSObject();
                    datos.put("definitivo", definitivo ? texto : "");
                    datos.put("provisorio", definitivo ? "" : texto);
                    notifyListeners("resultado", datos);

                    if (definitivo) {
                        apagar();
                        notifyListeners("fin", new JSObject());
                    }
                }

                @Override
                public void onError(int codigoError) {
                    if (miSesion != sesion) return;
                    apagar();
                    JSObject datos = new JSObject();
                    datos.put("codigo", codigoDeError(codigoError));
                    notifyListeners("error", datos);
                }

                @Override
                public void onEndOfSpeech() {}

                @Override
                public void onBeginningOfSpeech() {}

                @Override
                public void onRmsChanged(float rmsdB) {}

                @Override
                public void onBufferReceived(byte[] buffer) {}

                @Override
                public void onEvent(int eventType, Bundle params) {}
            });

            Intent pedido = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            pedido.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            pedido.putExtra(RecognizerIntent.EXTRA_LANGUAGE, idioma);
            pedido.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            reconocedor.startListening(pedido);
        });
    }

    /** Suelta el micrófono, pase lo que pase: `empezar` lo llama antes de arrancar de nuevo, `cancelar` directo, y el propio reconocedor cuando termina solo. */
    private void apagar() {
        if (reconocedor != null) {
            reconocedor.cancel();
            reconocedor.destroy();
            reconocedor = null;
        }
    }

    private String codigoDeError(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "not-allowed";
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "no-speech";
            case SpeechRecognizer.ERROR_AUDIO:
                return "audio-capture";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "network";
            case SpeechRecognizer.ERROR_CLIENT:
                return "aborted";
            default:
                return "no-speech";
        }
    }
}
