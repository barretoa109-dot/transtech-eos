package com.transtech.eos;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Antes de super: Capacitor arma el puente dentro de super.onCreate.
        registerPlugin(CompartirRecibidoPlugin.class);
        super.onCreate(savedInstanceState);
        CompartirRecibidoPlugin.recibir(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        CompartirRecibidoPlugin.recibir(intent);
    }
}
