// Messi por favor — l'app du disque (« ▶ Messi por favor » à la racine du disque).
//
// Démarre le site (outils/node-… server.js), ouvre le navigateur quand il est prêt,
// et reste dans le Dock tant qu'il tourne. Quitter l'app arrête le site ; si le site
// s'arrête tout seul (page fermée), l'app se ferme aussi.
//
// C'est une vraie app (et pas un script) pour que macOS sache à qui demander
// l'autorisation de lire le disque : « Messi por favor souhaite accéder… ».
//
// Compilation : voir construire.sh, dans ce dossier.

import Cocoa

final class Lanceur: NSObject, NSApplicationDelegate {
    private let site = Bundle.main.bundleURL.deletingLastPathComponent()
        .appendingPathComponent("Messi por favor (site)")
    private var server: Process?
    private var pipe: Pipe?
    private var port: Int?
    private var pending = Data()
    private var lastLines: [String] = []
    private var journal: FileHandle?
    private var quitting = false
    private var failed = false

    // ── Démarrage ──
    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        let big = OperatingSystemVersion(majorVersion: 11, minorVersion: 0, patchVersion: 0)
        guard ProcessInfo.processInfo.isOperatingSystemAtLeast(big) else {
            return fail("Ce Mac est trop ancien pour Messi por favor : il faut macOS 11 (Big Sur) ou plus récent.\n\nLes films restent lisibles directement depuis le disque.")
        }
        let script = site.appendingPathComponent("server.js")
        guard FileManager.default.fileExists(atPath: script.path) else {
            return fail("Le dossier « Messi por favor (site) » est introuvable. Il doit rester sur le disque, à côté de ce bouton.")
        }
        #if arch(arm64)
        let arch = "arm64"
        #else
        let arch = "x64"
        #endif
        let env = ProcessInfo.processInfo.environment
        let node = env["MESSI_NODE"].map { URL(fileURLWithPath: $0) }
            ?? site.appendingPathComponent("outils/node-\(arch)")

        let logURL = site.appendingPathComponent("cache/journal.txt")
        try? FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if FileManager.default.createFile(atPath: logURL.path, contents: nil) {
            journal = try? FileHandle(forWritingTo: logURL)
        }

        let p = Process()
        p.executableURL = node
        p.arguments = [script.path]
        p.currentDirectoryURL = site
        var childEnv = env
        childEnv["MESSI_APP"] = "1"
        p.environment = childEnv
        let out = Pipe()
        p.standardOutput = out
        p.standardError = out
        p.standardInput = FileHandle.nullDevice
        out.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            DispatchQueue.main.async { self?.received(data) }
        }
        p.terminationHandler = { [weak self] proc in
            let status = proc.terminationStatus
            // Laisser arriver les dernières lignes avant de conclure
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self?.serverEnded(status) }
        }
        do {
            try p.run()
        } catch {
            return fail("Messi por favor n'a pas pu démarrer.\n\n\(error.localizedDescription)")
        }
        server = p
        pipe = out
    }

    // ── Ce que dit le site ──
    private func received(_ data: Data) {
        guard !data.isEmpty else { return }
        journal?.write(data)
        pending.append(data)
        while let nl = pending.firstIndex(of: 0x0A) {
            let line = String(decoding: pending[pending.startIndex..<nl], as: UTF8.self)
            pending.removeSubrange(pending.startIndex...nl)
            handle(line)
        }
    }

    private func handle(_ line: String) {
        let parts = line.split(separator: " ")
        if parts.count == 2, parts[0] == "MESSI_PRET" || parts[0] == "MESSI_DEJA", let p = Int(parts[1]) {
            port = p
            openSite()
            return
        }
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty {
            lastLines.append(trimmed)
            if lastLines.count > 8 { lastLines.removeFirst() }
        }
    }

    private func serverEnded(_ status: Int32) {
        pipe?.fileHandleForReading.readabilityHandler = nil
        if let rest = pipe?.fileHandleForReading.readDataToEndOfFile() { received(rest) }
        try? journal?.close()
        if quitting { NSApp.reply(toApplicationShouldTerminate: true); return }
        if port == nil && status != 0 && !failed {
            let text = lastLines.joined(separator: "\n")
            if text.range(of: "EPERM", options: .caseInsensitive) != nil
                || text.range(of: "not permitted", options: .caseInsensitive) != nil {
                return fail("macOS a refusé l'accès au disque.\n\nOuvre Réglages Système → Confidentialité et sécurité → Fichiers et dossiers, autorise « Messi por favor » à lire les volumes amovibles, puis double-clique à nouveau sur le bouton.")
            }
            return fail("Messi por favor n'a pas pu démarrer.\n\n" + lastLines.suffix(5).joined(separator: "\n"))
        }
        NSApp.terminate(nil)
    }

    // ── Ouvrir le site ──
    @objc func openSite() {
        guard let port = port, let url = URL(string: "http://localhost:\(port)/") else { return }
        if ProcessInfo.processInfo.environment["NO_OPEN"] != nil {
            print("(navigateur non ouvert) \(url)")
            return
        }
        NSWorkspace.shared.open(url)
    }

    // Double-clic sur l'app (ou clic dans le Dock) pendant qu'elle tourne : on rouvre la page
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openSite()
        return false
    }

    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()
        menu.addItem(withTitle: "Ouvrir le site", action: #selector(openSite), keyEquivalent: "")
        return menu
    }

    // ── Quitter : on arrête le site proprement (progression enregistrée) ──
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let s = server, s.isRunning else { return .terminateNow }
        quitting = true
        s.terminate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            if s.isRunning { kill(s.processIdentifier, SIGKILL) }
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    // ── Divers ──
    private func fail(_ message: String) {
        failed = true
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Messi por favor"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
        NSApp.terminate(nil)
    }

    private func buildMenu() {
        let main = NSMenu()
        let item = NSMenuItem()
        main.addItem(item)
        let menu = NSMenu()
        menu.addItem(withTitle: "Ouvrir le site", action: #selector(openSite), keyEquivalent: "o")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quitter Messi por favor", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = menu
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = Lanceur()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
