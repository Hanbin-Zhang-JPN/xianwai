import SwiftUI
import AppKit
import CoreImage.CIFilterBuiltins
import Security

@MainActor
final class Bridge: ObservableObject {
    @Published var status = "正在启动聊天助手…"
    @Published var phoneURL: URL?
    @Published var localURL: URL?
    @Published var aiReady = false
    @Published var connectionDetail = ""
    @Published var failed = false
    private var server: Process?
    private var tunnel: Process?
    private var buffer = ""
    private var tunnelBuffer = ""
    private var readiness = TunnelReadiness()
    private var dnsReadyHost: String?
    private var activity: NSObjectProtocol?
    private var token = ""
    private var port = 0
    private var started = false
    private var generation = UUID()
    private var tunnelGeneration = UUID()
    private var tunnelAddress: String?
    private var tunnelConnected = false
    private var probeTask: Task<Void, Never>?
    private var startupTask: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    private var retries = 0

    func start() {
        guard !started else { return }
        started = true; generation = UUID(); let run = generation
        status = "正在启动本机服务…"; failed = false; aiReady = false
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { status = "无法生成配对凭证，请点击重新连接。"; failed = true; return }
        token = bytes.map { String(format: "%02x", $0) }.joined()
        guard let resources = Bundle.main.resourceURL else { failed = true; return }
        guard let node = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"].first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else { status = "找不到 Node.js，请安装后点击重新连接。"; failed = true; return }
        let codex = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [resources.appendingPathComponent("Runtime/desktop/runtime-server.mjs").path]
        process.currentDirectoryURL = resources.appendingPathComponent("Runtime")
        process.environment = ["HOME": NSHomeDirectory(), "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "XIANWAI_TOKEN": token, "XIANWAI_PORT": "0", "CODEX_BIN": codex, "XIANWAI_OCR": resources.appendingPathComponent("xianwai-ocr").path, "XIANWAI_DATA_DIR": NSHomeDirectory() + "/Library/Application Support/Xianwai"]
        let output = Pipe(), errors = Pipe()
        process.standardOutput = output; process.standardError = errors
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { handle.readabilityHandler = nil; return }
            let text = String(decoding: data, as: UTF8.self)
            Task { @MainActor in guard let self, self.generation == run else { return }; self.receive(text) }
        }
        errors.fileHandleForReading.readabilityHandler = { handle in if handle.availableData.isEmpty { handle.readabilityHandler = nil } }
        process.terminationHandler = { [weak self] _ in Task { @MainActor in
            guard let self, self.started, self.generation == run else { return }
            self.probeTask?.cancel(); self.startupTask?.cancel(); self.tunnel?.terminationHandler = nil; self.tunnel?.terminate()
            self.phoneURL = nil; self.localURL = nil; self.aiReady = false
            self.status = "本机服务已停止，点击“重新连接”即可恢复。"; self.failed = true
        } }
        do {
            try process.run(); server = process
            activity = ProcessInfo.processInfo.beginActivity(options: [.idleSystemSleepDisabled, .userInitiated], reason: "为 iPhone 提供弦外聊天分析")
            startupTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 25_000_000_000)
                guard !Task.isCancelled, let self, self.generation == run, self.localURL == nil else { return }
                self.status = "本机启动超时，点击重新连接。"; self.failed = true
            }
        } catch { status = "本机服务无法启动，请点击重新连接。"; failed = true }
    }

    private func receive(_ text: String) {
        buffer += text
        while let end = buffer.firstIndex(of: "\n") {
            let line = String(buffer[..<end]); buffer = String(buffer[buffer.index(after: end)...])
            guard let data = line.data(using: .utf8), let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any], value["event"] as? String == "ready", let number = value["port"] as? Int else { continue }
            startupTask?.cancel(); port = number; aiReady = value["ai"] as? Bool == true
            localURL = URL(string: "http://127.0.0.1:\(port)/#key=\(token)")
            startTunnel()
        }
    }

    func reconnect() {
        retries = 0
        if server?.isRunning == true, localURL != nil, aiReady { startTunnel() }
        else { stop(); start() }
    }

    func startTunnel() {
        guard started, port > 0, server?.isRunning == true else { reconnect(); return }
        probeTask?.cancel(); retryTask?.cancel(); tunnelGeneration = UUID(); let run = tunnelGeneration
        tunnel?.terminationHandler = nil; tunnel?.terminate(); phoneURL = nil; tunnelBuffer = ""; failed = false; tunnelAddress = nil; tunnelConnected = false; readiness = TunnelReadiness(); dnsReadyHost = nil
        status = "正在建立手机连接，验证通过后再显示二维码…"
        guard let executable = ["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"].first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else { status = "找不到 cloudflared，Mac 工作台仍可使用。安装后点击重新连接。"; failed = true; return }
        let process = Process(); process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = ["tunnel", "--config", "/dev/null", "--url", "http://127.0.0.1:\(port)", "--no-autoupdate", "--protocol", "http2", "--metrics", "127.0.0.1:0"]
        let output = Pipe(); process.standardOutput = output; process.standardError = output
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { handle.readabilityHandler = nil; return }
            let text = String(decoding: data, as: UTF8.self)
            Task { @MainActor in guard let self, self.tunnelGeneration == run else { return }; self.receiveTunnel(text) }
        }
        process.terminationHandler = { [weak self] _ in Task { @MainActor in
            guard let self, self.started, self.tunnelGeneration == run else { return }
            self.phoneURL = nil; self.probeTask?.cancel(); self.probeTask = nil
            self.retryTunnel("手机连接中断")
        } }
        do {
            try process.run(); tunnel = process
            startupTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                guard !Task.isCancelled, let self, self.tunnelGeneration == run, self.phoneURL == nil else { return }
                self.retryTunnel("手机链接验证超时")
            }
        } catch { retryTunnel("手机连接无法启动") }
    }

    private func receiveTunnel(_ text: String) {
        readiness.ingest(text)
        tunnelBuffer = String((tunnelBuffer + text).suffix(24000))
        tunnelAddress = readiness.address; tunnelConnected = readiness.registered
        if tunnelConnected, let address = tunnelAddress, probeTask == nil {
            let run = tunnelGeneration, key = token
            probeTask = Task { [weak self] in
                var failures = 0
                for attempt in 0..<15 {
                    guard !Task.isCancelled, let self, self.tunnelGeneration == run else { return }
                    self.status = "正在验证手机链接（\(attempt + 1)/15），请稍候…"
                    if let health = await self.checkPhone(address, key: key) {
                        guard !Task.isCancelled, self.tunnelGeneration == run else { return }
                        self.aiReady = health; self.phoneURL = URL(string: "\(address)/#key=\(key)")
                        self.failed = false; self.retries = 0; self.startupTask?.cancel()
                        self.status = health ? "手机链接已验证。用 iPhone 相机扫码，再用 Safari 打开。" : "手机链接已验证。Codex 待登录，截图与本地规则仍可使用。"
                        while !Task.isCancelled {
                            try? await Task.sleep(nanoseconds: 20_000_000_000)
                            guard !Task.isCancelled, self.tunnelGeneration == run else { return }
                            if let ready = await self.checkPhone(address, key: key) { failures = 0; self.aiReady = ready }
                            else { failures += 1 }
                            if failures >= 3 { self.phoneURL = nil; self.retryTunnel("手机链接连续三次不可达"); return }
                        }
                        return
                    }
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                }
                guard !Task.isCancelled, let self, self.tunnelGeneration == run else { return }
                self.retryTunnel("手机链接暂时无法访问")
            }
        } else if tunnelBuffer.contains("failed to request quick Tunnel") { retryTunnel("暂时连不上手机中转服务") }
    }

    private func checkPhone(_ address: String, key: String) async -> Bool? {
        guard let url = URL(string: address + "/api/health") else { return nil }
        // Query the DNS record before the first system lookup. A newly allocated
        // tunnel can otherwise seed the OS resolver with a cached NXDOMAIN.
        if dnsReadyHost != url.host {
            guard let host = url.host, await dnsPublished(host) else { connectionDetail = "DNS 记录正在发布，稍后自动重试。"; return nil }
            guard !Task.isCancelled else { return nil }; dnsReadyHost = host
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5)
        request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard code == 200 else { connectionDetail = "公网检查：HTTP \(code)"; return nil }
            guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any], value["provider"] as? String == "codex", let ready = value["ready"] as? Bool else { connectionDetail = "公网检查：未收到弦外服务响应"; return nil }
            connectionDetail = "公网接口 HTTP 200 · 配对凭证已验证"
            return ready
        } catch {
            let issue = error as NSError
            connectionDetail = "\(url.host ?? "") · \(issue.domain) \(issue.code) · \(issue.localizedDescription)"
            return nil
        }
    }

    private func dnsPublished(_ host: String) async -> Bool {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                let process = Process(), output = Pipe()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/dig")
                process.arguments = ["+short", "+time=1", "+tries=1", host, "A"]
                process.standardOutput = output; process.standardError = FileHandle.nullDevice
                do {
                    try process.run()
                    let data = output.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
                    continuation.resume(returning: process.terminationStatus == 0 && TunnelReadiness.hasIPv4Answer(String(decoding: data, as: UTF8.self)))
                } catch { continuation.resume(returning: false) }
            }
        }
    }

    private func retryTunnel(_ reason: String) {
        guard started else { return }
        probeTask?.cancel(); probeTask = nil; startupTask?.cancel()
        tunnelGeneration = UUID(); tunnel?.terminationHandler = nil; tunnel?.terminate(); phoneURL = nil
        retries += 1
        guard retries <= 3 else { status = reason + "。请确认 Mac 可联网，再点击重新连接。"; failed = true; return }
        status = reason + "，正在自动重试（\(retries)/3）…"
        retryTask?.cancel()
        retryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(2 * (self?.retries ?? 1)) * 1_000_000_000)
            guard !Task.isCancelled, let self, self.started else { return }; self.startTunnel()
        }
    }

    func stop() {
        started = false; generation = UUID(); tunnelGeneration = UUID()
        probeTask?.cancel(); probeTask = nil; startupTask?.cancel(); retryTask?.cancel()
        tunnel?.terminationHandler = nil; server?.terminationHandler = nil
        tunnel?.terminate(); server?.terminate(); tunnel = nil; server = nil
        phoneURL = nil; localURL = nil; aiReady = false; port = 0; buffer = ""
        if let activity { ProcessInfo.processInfo.endActivity(activity) }; activity = nil
    }

    func openWorkbench() { if let localURL { NSWorkspace.shared.open(localURL) } }
    func copyPhoneLink() { guard let phoneURL else { return }; NSPasteboard.general.clearContents(); NSPasteboard.general.setString(phoneURL.absoluteString, forType: .string) }
    func qrImage() -> NSImage? {
        guard let phoneURL else { return nil }
        let filter = CIFilter.qrCodeGenerator(); filter.message = Data(phoneURL.absoluteString.utf8); filter.correctionLevel = "M"
        guard let image = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 6, y: 6)), let cg = CIContext().createCGImage(image, from: image.extent) else { return nil }
        return NSImage(cgImage: cg, size: NSSize(width: 280, height: 280))
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    var bridge: Bridge?
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { sender.windows.first(where: { $0.canBecomeMain })?.makeKeyAndOrderFront(nil) }
        return true
    }
    func applicationWillTerminate(_ notification: Notification) { bridge?.stop() }
}

@main
struct XianwaiMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var bridge = Bridge()
    var body: some Scene {
        Window("弦外 · 你的聊天助手", id: "control") {
            VStack(spacing: 17) {
                HStack(spacing: 13) {
                    Image(systemName: "bubble.left.and.bubble.right.fill").font(.system(size: 29)).foregroundStyle(Color(red: 0.26, green: 0.37, blue: 0.27))
                    VStack(alignment: .leading, spacing: 4) {
                        Text("弦外").font(.system(size: 29, weight: .medium, design: .serif))
                    Text("0.7.2 · 粘贴一句就帮你回，关窗也能继续用。").font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Circle().fill(bridge.aiReady ? Color.green.opacity(0.65) : Color.gray).frame(width: 7, height: 7)
                    Text(bridge.aiReady ? "真实 AI 已就绪" : "正在准备").font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Divider()
                Text(bridge.status).font(.system(size: 13)).multilineTextAlignment(.center).frame(height: 38)
                if !bridge.connectionDetail.isEmpty { Text(bridge.connectionDetail).font(.system(size: 10)).foregroundStyle(.secondary).multilineTextAlignment(.center).lineLimit(3) }
                if let qr = bridge.qrImage() {
                    Image(nsImage: qr).interpolation(.none).resizable().frame(width: 238, height: 238).padding(17).background(.white).clipShape(RoundedRectangle(cornerRadius: 15))
                } else {
                    VStack(spacing: 18) { if !bridge.failed { ProgressView() }; Image(systemName: "iphone.and.arrow.forward").font(.system(size: 55)).foregroundStyle(.secondary); Text(bridge.failed ? "连接未就绪" : "正在验证手机连接").font(.system(size: 12)).foregroundStyle(.secondary) }.frame(width: 272, height: 272).background(Color.white.opacity(0.7)).clipShape(RoundedRectangle(cornerRadius: 15))
                }
                HStack(spacing: 12) {
                    Button("复制手机链接") { bridge.copyPhoneLink() }.disabled(bridge.phoneURL == nil)
                    Button("打开 Mac 工作台") { bridge.openWorkbench() }.buttonStyle(.borderedProminent).tint(Color(red: 0.26, green: 0.37, blue: 0.27)).disabled(bridge.localURL == nil)
                    Button("重新连接") { bridge.reconnect() }
                }
                VStack(alignment: .leading, spacing: 9) {
                    Text("1   用 iPhone 相机扫码 → Safari 打开，确认连接")
                    Text("2   日常：粘贴对方一句 → 帮我回 → 编辑复制")
                    Text("3   链接失效时重新扫码；也可复制手机链接手动打开")
                }.font(.system(size: 12)).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading).padding(16).background(Color.white.opacity(0.6)).clipShape(RoundedRectangle(cornerRadius: 10))
                Text("关闭窗口仍在后台运行，可从屏幕顶部菜单栏重新打开。\n只有从菜单退出、Mac 合盖或断网才会中断连接。\n截图通过 Cloudflare 到 Mac 识别，分析文字发送给 OpenAI；使用当前 Codex 额度。\n请勿转发二维码和配对链接。").font(.system(size: 10)).foregroundStyle(.secondary).lineSpacing(4).multilineTextAlignment(.center)
            }
            .padding(28).frame(width: 570).background(Color(red: 0.96, green: 0.97, blue: 0.94))
            .task { delegate.bridge = bridge; bridge.start() }
        }.windowResizability(.contentSize)
        MenuBarExtra("弦外", systemImage: "bubble.left.and.bubble.right") {
            BridgeMenu(bridge: bridge)
        }
    }
}

struct BridgeMenu: View {
    @ObservedObject var bridge: Bridge
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Button("显示二维码与连接状态") { openWindow(id: "control"); NSApp.activate(ignoringOtherApps: true) }
        Button("打开 Mac 工作台") { bridge.openWorkbench() }.disabled(bridge.localURL == nil)
        Button("复制手机链接") { bridge.copyPhoneLink() }.disabled(bridge.phoneURL == nil)
        Divider()
        Text(bridge.aiReady ? "Codex 已就绪 · 后台运行中" : "Codex 尚未就绪")
        Button("退出弦外并关闭连接") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}
