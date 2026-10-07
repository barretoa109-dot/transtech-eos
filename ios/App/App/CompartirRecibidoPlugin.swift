import Capacitor
import UIKit

/**
 * Recibe lo que `ShareViewController.swift` (la Share Extension) dejó en el
 * contenedor del App Group: texto, o una imagen (foto, comprobante). Se lo
 * entrega al chat web con el evento `compartido`, mismo contrato que
 * `CompartirRecibidoPlugin.java` en Android: `{ texto }` o
 * `{ archivo: { nombre, mime, base64 } }`.
 *
 * A diferencia de Android, acá no hay un intent que reabra la app con el
 * contenido adentro: la Share Extension no puede avisarle directamente a la
 * app (ver ShareViewController.swift). Por eso se revisa el contenedor cada
 * vez que la app vuelve a primer plano, no solo al cargar el puente.
 */
@objc(CompartirRecibidoPlugin)
public class CompartirRecibidoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CompartirRecibidoPlugin"
    public let jsName = "CompartirRecibido"
    public let pluginMethods: [CAPPluginMethod] = []

    private let grupoApp = "group.com.transtech.eos"
    private let archivoCompartido = "compartido.json"

    override public func load() {
        revisarPendiente()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(revisarPendiente),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func revisarPendiente() {
        guard let carpeta = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: grupoApp) else {
            return
        }

        let ruta = carpeta.appendingPathComponent(archivoCompartido)
        guard let datos = try? Data(contentsOf: ruta) else { return }
        try? FileManager.default.removeItem(at: ruta)

        guard let contenido = try? JSONSerialization.jsonObject(with: datos) as? [String: Any] else { return }
        notifyListeners("compartido", data: contenido, retainUntilConsumed: true)
    }
}
