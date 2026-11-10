import AppIntents
import UIKit

/**
 * Los Atajos de "Anotar en EOS": por voz (Siri) y en blanco (Back Tap).
 *
 * A diferencia de `CompartirRecibidoPlugin` o `DictadoPlugin`, esto NO es un
 * plugin de Capacitor y no se registra en `BridgeViewController`. Los App
 * Intents los descubre el sistema solo, por el framework `AppIntents` — basta
 * con que este archivo esté en el target de la app.
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
 * Los dos terminan en el mismo lugar: reabren la app con
 * `com.transtech.eos://rapido[?texto=…]`, el mismo enlace que ya entiende
 * `rapidoDesdeEnlaceApp` (`lib/app-nativa/plataforma.ts`) del lado web. Nada
 * nuevo del lado del servidor: es la misma ficha y el mismo
 * `/api/finanzas/rapido` que ya usa "Ingresos y gastos".
 *
 * Disponible desde iOS 16 (el framework `AppIntents` no existe antes). El
 * proyecto sigue en el piso 15.0 (`IPHONEOS_DEPLOYMENT_TARGET`): en un
 * teléfono con 15, estos atajos simplemente no aparecen, el resto de la app
 * sigue andando igual.
 */
@available(iOS 16.0, *)
private func abrirAnotarRapido(texto: String?) async {
    var componentes = URLComponents(string: "com.transtech.eos://rapido")
    if let texto, !texto.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        componentes?.queryItems = [URLQueryItem(name: "texto", value: texto)]
    }

    guard let url = componentes?.url else { return }

    await MainActor.run {
        UIApplication.shared.open(url)
    }
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

    @MainActor
    func perform() async throws -> some IntentResult {
        await abrirAnotarRapido(texto: texto)
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

    @MainActor
    func perform() async throws -> some IntentResult {
        await abrirAnotarRapido(texto: nil)
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
