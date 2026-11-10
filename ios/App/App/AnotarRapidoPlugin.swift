import Capacitor
import UIKit

/**
 * Recibe lo que `AnotarRapidoIntent.swift` (Siri o Back Tap) dejó en el
 * contenedor del App Group, y se lo entrega al chat web con el evento
 * `anotarPendiente`: `{}` cuando vino de Back Tap (ficha vacía) o
 * `{ texto }` cuando vino de Siri.
 *
 * Mismo patrón que `CompartirRecibidoPlugin.swift`: un App Intent no puede
 * avisarle directamente a la app con garantías (`openAppWhenRun` la trae al
 * frente, pero no hay forma confiable de pasarle datos en ese mismo
 * instante), así que se revisa el contenedor cada vez que la app vuelve a
 * primer plano, no solo al cargar el puente.
 */
@objc(AnotarRapidoPlugin)
public class AnotarRapidoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AnotarRapidoPlugin"
    public let jsName = "AnotarRapido"
    public let pluginMethods: [CAPPluginMethod] = []

    private let grupoApp = "group.com.transtech.eos"
    private let archivoAnotarRapido = "anotar-rapido.json"

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

        let ruta = carpeta.appendingPathComponent(archivoAnotarRapido)
        guard let datos = try? Data(contentsOf: ruta) else { return }
        try? FileManager.default.removeItem(at: ruta)

        guard let contenido = try? JSONSerialization.jsonObject(with: datos) as? [String: Any] else { return }
        notifyListeners("anotarPendiente", data: contenido, retainUntilConsumed: true)
    }
}
