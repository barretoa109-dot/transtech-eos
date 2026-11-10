import AppIntents
import Foundation

/**
 * Los Atajos de "Anotar en EOS": por voz (Siri) y en blanco (Back Tap).
 *
 * A diferencia de `CompartirRecibidoPlugin` o `DictadoPlugin`, los dos
 * `AppIntent` de acá NO son un plugin de Capacitor y no se registran en
 * `BridgeViewController`. Los descubre el sistema solo, por el framework
 * `AppIntents` — basta con que este archivo esté en el target de la app.
 *
 * Por qué son DOS intents y no uno con un parámetro opcional:
 *
 * - Por voz, Siri tiene que poder preguntar "¿qué anotaste?" cuando la
 *   persona solo dice "Oye Siri, anotá en EOS" sin decir qué. Eso exige que
 *   el parámetro sea obligatorio (`requestValue` sólo dispara si falta un
 *   valor que el intent exige).
 * - Tocar la parte de atrás del teléfono no tiene voz ni pantalla: solo
 *   puede *ejecutar* el atajo, nunca contestarle una pregunta. Si el mismo
 *   intent exigiera el texto, Back Tap tendría que usar un valor fijo
 *   configurado una vez en la app Atajos — exactamente lo contrario de "abrí
 *   la ficha en blanco para escribir o dictar ahí".
 *
 * ============================================================
 * POR QUÉ YA NO REABRE LA APP CON UN ENLACE PROPIO
 * ============================================================
 *
 * La primera versión hacía `UIApplication.shared.open("com.transtech.eos://rapido…")`
 * desde `perform()`, además de `openAppWhenRun = true`. Probado en un iPhone
 * real (10/11): Siri reconocía el Atajo y traía la app al frente, pero nunca
 * llegaba a la pantalla de anotar — el enlace se perdía. La causa más
 * probable es una carrera entre los dos mecanismos: el sistema ya está
 * trayendo la app al frente por `openAppWhenRun` cuando el propio proceso de
 * la app intenta reabrirse con su mismo esquema, y esa segunda apertura no
 * siempre se entrega al bridge de Capacitor a tiempo.
 *
 * Por eso ahora se usa el mismo mecanismo que ya existe y ya está probado
 * para "Compartir con EOS" en iOS (`ShareViewController.swift` +
 * `CompartirRecibidoPlugin.swift`): escribir en el contenedor del App Group
 * y dejar que la app lo lea cuando vuelve a primer plano, en vez de
 * depender de que un enlace se entregue en el momento justo.
 * `AnotarRapidoPlugin.swift` es el lado que lo lee.
 *
 * Disponible desde iOS 16 (el framework `AppIntents` no existe antes). El
 * proyecto sigue en el piso 15.0 (`IPHONEOS_DEPLOYMENT_TARGET`): en un
 * teléfono con 15, estos atajos simplemente no aparecen, el resto de la app
 * sigue andando igual.
 */
private let grupoApp = "group.com.transtech.eos"
private let archivoAnotarRapido = "anotar-rapido.json"

@available(iOS 16.0, *)
private func dejarPendiente(texto: String?) {
    guard let carpeta = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: grupoApp) else {
        return
    }

    let limpio = texto?.trimmingCharacters(in: .whitespacesAndNewlines)
    var contenido: [String: Any] = [:]
    if let limpio, !limpio.isEmpty { contenido["texto"] = limpio }

    guard let json = try? JSONSerialization.data(withJSONObject: contenido) else { return }
    try? json.write(to: carpeta.appendingPathComponent(archivoAnotarRapido), options: .atomic)
}

/** El de Siri: pregunta qué anotar si no se lo dijeron ya en la misma frase. */
@available(iOS 16.0, *)
struct AnotarEnEOSIntent: AppIntent {
    static var title: LocalizedStringResource = "Anotar en EOS"
    static var description = IntentDescription(
        "Anota un gasto o un ingreso en EOS hablando, sin abrir el chat."
    )

    static var openAppWhenRun: Bool = true

    @Parameter(title: "Qué anotaste")
    var texto: String

    func perform() async throws -> some IntentResult {
        dejarPendiente(texto: texto)
        return .result()
    }
}

/** El de Back Tap: abre la ficha vacía, sin preguntar nada. */
@available(iOS 16.0, *)
struct AbrirAnotarRapidoIntent: AppIntent {
    static var title: LocalizedStringResource = "Abrir anotar rápido en EOS"
    static var description = IntentDescription(
        "Abre la ficha de anotar un gasto o ingreso en EOS, en blanco."
    )

    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        dejarPendiente(texto: nil)
        return .result()
    }
}

/**
 * Lo que hace que "Anotar en EOS" aparezca solo en la app Atajos, en
 * Spotlight y como algo que Siri puede entender dicho en voz alta — sin que
 * la persona tenga que armar un Atajo a mano primero. Para Back Tap alcanza
 * con que el intent exista: se asigna desde Ajustes → Accesibilidad → Tocar
 * la parte de atrás, eligiendo "Abrir anotar rápido en EOS" de la lista de
 * Atajos disponibles, no desde acá.
 */
@available(iOS 16.0, *)
struct AtajosDeEOS: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AnotarEnEOSIntent(),
            phrases: [
                "Anotar en \(.applicationName)",
                "Anotá un gasto en \(.applicationName)",
                "Anotar un gasto en \(.applicationName)",
            ],
            shortTitle: "Anotar en EOS",
            systemImageName: "plus.circle"
        )
        AppShortcut(
            intent: AbrirAnotarRapidoIntent(),
            phrases: [
                "Abrir anotar rápido en \(.applicationName)",
            ],
            shortTitle: "Anotar rápido",
            systemImageName: "bolt"
        )
    }
}
