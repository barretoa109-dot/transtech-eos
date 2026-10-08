import Capacitor

/**
 * `CompartirRecibidoPlugin` vive en el proyecto, no en un paquete npm: a esos
 * Capacitor no los descubre solo (ver `registerPlugins()` en
 * `node_modules/@capacitor/ios`, que solo lee `capacitor.config.json`). Hay
 * que registrarlos a mano, igual que `MainActivity.java` hace en Android con
 * `registerPlugin(CompartirRecibidoPlugin.class)`.
 */
class BridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CompartirRecibidoPlugin())
    }
}
