import UIKit

/**
 * "Compartir con EOS" en iOS. Hace lo mismo que `CompartirRecibidoPlugin.java`
 * en Android, pero una Share Extension corre en su propio proceso: Apple no
 * deja que abra ni avise directamente a la app contenedora
 * (https://developer.apple.com/forums/thread/824630). Por eso el camino es
 * distinto al de Android: guarda lo compartido en el contenedor del App
 * Group y termina. La próxima vez que la persona entra a EOS,
 * `CompartirRecibidoPlugin.swift` lo encuentra ahí y dispara `compartido`,
 * igual que en Android. Ver `docs/app-nativa/tiendas.md`.
 */
class ShareViewController: UIViewController {
    private let grupoApp = "group.com.transtech.eos"
    private let archivoCompartido = "compartido.json"
    /** Mismo límite que `TAMANO_MAXIMO` en `CompartirRecibidoPlugin.java`. */
    private let tamanoMaximo = 8 * 1024 * 1024

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        let etiqueta = UILabel()
        etiqueta.text = "Enviando a EOS…"
        etiqueta.textAlignment = .center
        etiqueta.font = .preferredFont(forTextStyle: .body)
        etiqueta.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(etiqueta)
        NSLayoutConstraint.activate([
            etiqueta.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            etiqueta.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        procesar()
    }

    private func procesar() {
        guard
            let item = extensionContext?.inputItems.first as? NSExtensionItem,
            let proveedor = item.attachments?.first
        else {
            terminar()
            return
        }

        if proveedor.hasItemConformingToTypeIdentifier("public.image") {
            proveedor.loadItem(forTypeIdentifier: "public.image", options: nil) { [weak self] dato, _ in
                self?.guardarImagen(dato)
            }
            return
        }

        if proveedor.hasItemConformingToTypeIdentifier("public.plain-text") {
            proveedor.loadItem(forTypeIdentifier: "public.plain-text", options: nil) { [weak self] dato, _ in
                self?.guardarTexto(dato as? String)
            }
            return
        }

        terminar()
    }

    private func guardarTexto(_ texto: String?) {
        guard let texto, !texto.isEmpty else {
            terminar()
            return
        }
        escribir(["texto": texto])
    }

    private func guardarImagen(_ dato: NSSecureCoding?) {
        guard let dato else {
            terminar()
            return
        }

        var mime = "image/jpeg"
        var datos: Data?

        switch dato {
        case let url as URL:
            datos = try? Data(contentsOf: url)
            if url.pathExtension.lowercased() == "png" { mime = "image/png" }
        case let imagen as UIImage:
            datos = imagen.jpegData(compressionQuality: 0.9)
        case let contenido as Data:
            datos = contenido
        default:
            datos = nil
        }

        guard let datos, datos.count <= tamanoMaximo else {
            terminar()
            return
        }

        escribir([
            "archivo": [
                "nombre": mime == "image/png" ? "compartido.png" : "compartido.jpg",
                "mime": mime,
                "base64": datos.base64EncodedString(),
            ] as [String: Any],
        ])
    }

    private func escribir(_ contenido: [String: Any]) {
        defer { terminar() }
        guard
            let carpeta = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: grupoApp),
            let json = try? JSONSerialization.data(withJSONObject: contenido)
        else { return }
        try? json.write(to: carpeta.appendingPathComponent(archivoCompartido), options: .atomic)
    }

    private func terminar() {
        DispatchQueue.main.async {
            self.extensionContext?.completeRequest(returningItems: nil)
        }
    }
}
