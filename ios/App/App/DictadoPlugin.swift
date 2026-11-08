import Capacitor
import Speech
import AVFoundation

/**
 * El dictado por voz con `Speech` nativo de iOS, para cuando la app corre
 * instalada: WKWebView no implementa `SpeechRecognition` del navegador, así
 * que `app/eos/components/useDictado.ts` no tenía con qué dictar ahí (y por
 * eso Configuración nunca mostraba "Micrófono" para la app, aunque
 * `Info.plist` ya pedía el permiso). Mismo contrato de eventos que
 * `DictadoPlugin.java` en Android: ver `lib/app-nativa/cliente.ts`.
 *
 * `empezar()` **nunca rechaza**: resuelve `{}` con el micrófono abierto de
 * verdad, o `{ error: <código> }` con uno de los códigos que entiende
 * `mensajeDeErrorDeVoz` (`lib/eos/dictado.ts`). Así el lado JavaScript no
 * depende de cómo cada plataforma cruza un rechazo de promesa por el puente
 * de Capacitor, y el error se traduce una sola vez, acá.
 *
 * ============================================================
 * `parar()` NO ES `cancelar()`
 * ============================================================
 *
 * `SFSpeechRecognitionTask` solo entrega un resultado con `isFinal == true`
 * cuando el pedido de audio termina solo (silencio) o alguien llama
 * `endAudio()`. `cancel()` corta la tarea sin avisar ese final: todo lo
 * dicho quedaba solo en los resultados provisorios (`onresult` con
 * `provisorio`, nunca `definitivo`) y se perdía apenas se soltaba el botón
 * —reportado el 07/11/2026 desde un iPhone: "se habla y no se guarda nada".
 * `parar()` llama `endAudio()`, deja el reconocedor terminar solo y recién
 * ahí sale el `definitivo` por el mismo camino de siempre.
 *
 * ============================================================
 * LA SESIÓN, NO SOLO LA TAREA
 * ============================================================
 *
 * `useDictado.ts` ya resuelve este mismo problema del lado web (ver su
 * comentario "LOS EVENTOS TARDÍOS NO PISAN LA SESIÓN NUEVA") y acá hace falta
 * lo mismo: cancelar la tarea de reconocimiento no impide que su clausura
 * todavía se dispare después, de forma asíncrona. Sin un número de sesión,
 * esa clausura tardía notificaría sobre el intento siguiente.
 */
@objc(DictadoPlugin)
public class DictadoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DictadoPlugin"
    public let jsName = "Dictado"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "empezar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "parar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelar", returnType: CAPPluginReturnPromise),
    ]

    private let motor = AVAudioEngine()
    private var tarea: SFSpeechRecognitionTask?
    private var pedido: SFSpeechAudioBufferRecognitionRequest?
    private var sesion = 0

    @objc func empezar(_ call: CAPPluginCall) {
        apagar()
        let idioma = call.getString("idioma") ?? "es-PY"

        SFSpeechRecognizer.requestAuthorization { [weak self] estado in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard estado == .authorized else {
                    call.resolve(["error": "not-allowed"])
                    return
                }
                self.pedirMicrofono(call: call, idioma: idioma)
            }
        }
    }

    /**
     * Termina prolijo: deja de mandar audio y espera el resultado final (ver
     * nota de arriba).
     *
     * El motor se frena ANTES de terminar el pedido, no después. Si se sigue
     * llamando `pedido.append(buffer)` desde el *tap* una vez que
     * `endAudio()` ya se llamó —lo que pasa si no se saca el tap primero—,
     * el reconocedor nunca termina de cerrar: por eso el primer intento de
     * este arreglo (07/11/2026) seguía sin guardar nada, aunque ya no
     * cancelaba de golpe.
     */
    @objc func parar(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                call.resolve()
                return
            }

            if self.motor.isRunning {
                self.motor.stop()
                self.motor.inputNode.removeTap(onBus: 0)
            }
            self.pedido?.endAudio()
            call.resolve()
        }
    }

    @objc func cancelar(_ call: CAPPluginCall) {
        apagar()
        call.resolve()
    }

    private func pedirMicrofono(call: CAPPluginCall, idioma: String) {
        let continuar: (Bool) -> Void = { [weak self] concedido in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard concedido else {
                    call.resolve(["error": "not-allowed"])
                    return
                }
                self.arrancar(call: call, idioma: idioma)
            }
        }

        if #available(iOS 17.0, *) {
            AVAudioApplication.requestRecordPermission(completionHandler: continuar)
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission(continuar)
        }
    }

    private func arrancar(call: CAPPluginCall, idioma: String) {
        guard let reconocedor = SFSpeechRecognizer(locale: Locale(identifier: idioma)), reconocedor.isAvailable else {
            call.resolve(["error": "network"])
            return
        }

        let audioDeLaApp = AVAudioSession.sharedInstance()
        do {
            try audioDeLaApp.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioDeLaApp.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            call.resolve(["error": "audio-capture"])
            return
        }

        let pedido = SFSpeechAudioBufferRecognitionRequest()
        pedido.shouldReportPartialResults = true
        self.pedido = pedido

        let nodoEntrada = motor.inputNode
        let formato = nodoEntrada.outputFormat(forBus: 0)
        nodoEntrada.removeTap(onBus: 0)
        nodoEntrada.installTap(onBus: 0, bufferSize: 1024, format: formato) { buffer, _ in
            pedido.append(buffer)
        }

        motor.prepare()
        do {
            try motor.start()
        } catch {
            apagar()
            call.resolve(["error": "audio-capture"])
            return
        }

        sesion += 1
        let miSesion = sesion

        call.resolve([:])

        tarea = reconocedor.recognitionTask(with: pedido) { [weak self] resultado, error in
            guard let self = self else { return }
            DispatchQueue.main.async {
                // Una sesión vieja (cancelada, o ya terminada): la clausura
                // llegó tarde y no le queda nadie a quien avisarle.
                guard self.sesion == miSesion else { return }

                if let resultado = resultado {
                    let texto = resultado.bestTranscription.formattedString
                    if resultado.isFinal {
                        self.notifyListeners("resultado", data: ["definitivo": texto, "provisorio": ""])
                    } else {
                        self.notifyListeners("resultado", data: ["definitivo": "", "provisorio": texto])
                    }
                }

                guard error != nil || resultado?.isFinal == true else { return }

                self.apagar()

                if error != nil {
                    // El framework de `Speech` no documenta códigos estables
                    // por versión de iOS; lo que pasa en la práctica es que
                    // corta por silencio, que es justo lo que "no-speech" le
                    // dice a la persona (`mensajeDeErrorDeVoz`).
                    self.notifyListeners("error", data: ["codigo": "no-speech"])
                } else {
                    self.notifyListeners("fin", data: [:])
                }
            }
        }
    }

    /** Suelta el micrófono, pase lo que pase: `empezar` lo llama antes de arrancar de nuevo, `cancelar` directo, y el propio reconocedor cuando termina solo. */
    private func apagar() {
        sesion += 1
        tarea?.cancel()
        tarea = nil
        pedido = nil
        if motor.isRunning {
            motor.stop()
            motor.inputNode.removeTap(onBus: 0)
        }
    }
}
