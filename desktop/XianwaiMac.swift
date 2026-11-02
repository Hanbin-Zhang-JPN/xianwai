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
    @Published var failed = false
    private var server: Process?
    private var tunnel: Process?
    private var buffer = ""
    private var tunnelBuffer = ""
    private var activity: NSObjectProtocol?
    private var token = ""
    private var port = 0
    private var started = false
    private var tunnelAddress: String?
    private var tunnelConnected = false

    func start() {
        guard !started else { return }; started = true
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { status = "无法生成配对凭证，请重新打开。"; failed = true; return }
        token = bytes.map { String(format: "%02x", $0) }.joined()
        guard let resources = Bundle.main.resourceURL else { return }
        let node = "/opt/homebrew/bin/node"
        let codex = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"
        for path in [node, codex, "/opt/homebrew/bin/cloudflared"] {
            if !FileManager.default.isExecutableFile(atPath: path) { status = "找不到运行组件：\(URL(fileURLWithPath: path).lastPathComponent)"; failed = true; return }
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [resources.appendingPathComponent("Runtime/desktop/runtime-server.mjs").path]
        process.currentDirectoryURL = resources.appendingPathComponent("Runtime")
        process.environment = ["HOME": NSHomeDirectory(), "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "XIANWAI_TOKEN": token, "XIANWAI_PORT": "0", "CODEX_BIN": codex, "XIANWAI_OCR": resources.appendingPathComponent("xianwai-ocr").path, "XIANWAI_DATA_DIR": NSHomeDirectory() + "/Library/Application Support/Xianwai"]
        let output = Pipe(), errors = Pipe()
        process.standardOutput = output; process.standardError = errors
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            Task { @MainActor in self?.receive(text) }
        }
        errors.fileHandleForReading.readabilityHandler = { handle in _ = handle.availableData }
        process.terminationHandler = { [weak self] _ in Task { @MainActor in if self?.started == true { self?.status = "本机服务已停止，请退出后重新打开。"; self?.failed = true } } }
        do { try process.run(); server = process; activity = ProcessInfo.processInfo.beginActivity(options: [.idleSystemSleepDisabled, .userInitiated], reason: "为 iPhone 提供弦外聊天分析") }
        catch { status = "本机服务无法启动：\(error.localizedDescription)"; failed = true }
    }

    private func receive(_ text: String) {
        buffer += text
        while let end = buffer.firstIndex(of: "\n") {
            let line = String(buffer[..<end]); buffer = String(buffer[buffer.index(after: end)...])
            guard let data = line.data(using: .utf8), let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any], value["event"] as? String == "ready", let number = value["port"] as? Int else { continue }
            port = number; aiReady = value["ai"] as? Bool == true
            localURL = URL(string: "http://127.0.0.1:\(port)/#key=\(token)")
            if !aiReady { status = "请先在 ChatGPT 应用登录 Codex，然后重新打开弦外。"; failed = true; return }
            startTunnel()
        }
    }

    func startTunnel() {
        guard port > 0 else { return }
        tunnel?.terminationHandler = nil; tunnel?.terminate(); phoneURL = nil; tunnelBuffer = ""; failed = false; tunnelAddress = nil; tunnelConnected = false
        status = "真实 AI 已就绪，正在建立手机连接…"
        let process = Process(); process.executableURL = URL(fileURLWithPath: "/opt/homebrew/bin/cloudflared")
        process.arguments = ["tunnel", "--config", "/dev/null", "--url", "http://127.0.0.1:\(port)", "--no-autoupdate", "--protocol", "http2", "--metrics", "127.0.0.1:0"]
        let output = Pipe(); process.standardOutput = output; process.standardError = output
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            Task { @MainActor in self?.receiveTunnel(text) }
        }
        process.terminationHandler = { [weak self] _ in Task { @MainActor in if self?.started == true { self?.status = "手机连接中断，点击“重新连接”。Mac 工作台仍可使用。"; self?.phoneURL = nil; self?.failed = true } } }
        do { try process.run(); tunnel = process }
        catch { status = "手机连接无法启动，可先打开 Mac 工作台。"; failed = true }
    }

    private func receiveTunnel(_ text: String) {
        tunnelBuffer = String((tunnelBuffer + text).suffix(12000))
        if let range = tunnelBuffer.range(of: "https://[a-z0-9-]+\\.trycloudflare\\.com", options: .regularExpression) {
            tunnelAddress = String(tunnelBuffer[range])
        }
        if text.contains("Registered tunnel connection") { tunnelConnected = true }
        if tunnelConnected, let address = tunnelAddress {
            phoneURL = URL(string: "\(address)/#key=\(token)")
            status = "已就绪。用 iPhone 相机扫描下方二维码。"
        } else if tunnelBuffer.contains("failed to request quick Tunnel") { status = "暂时连不上手机中转服务，可点击重新连接。"; failed = true }
    }

    func stop() {
        started = false; tunnel?.terminationHandler = nil; server?.terminationHandler = nil
        tunnel?.terminate(); server?.terminate()
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
                    Text("粘贴一句就帮你回，关窗也能继续用。").font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Circle().fill(bridge.aiReady ? Color.green.opacity(0.65) : Color.gray).frame(width: 7, height: 7)
                    Text(bridge.aiReady ? "真实 AI 已就绪" : "正在准备").font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Divider()
                Text(bridge.status).font(.system(size: 13)).multilineTextAlignment(.center).frame(height: 38)
                if let qr = bridge.qrImage() {
                    Image(nsImage: qr).interpolation(.none).resizable().frame(width: 238, height: 238).padding(17).background(.white).clipShape(RoundedRectangle(cornerRadius: 15))
                } else {
                    VStack(spacing: 18) { if !bridge.failed { ProgressView() }; Image(systemName: "iphone.and.arrow.forward").font(.system(size: 55)).foregroundStyle(.secondary); Text("手机连接准备中").font(.system(size: 12)).foregroundStyle(.secondary) }.frame(width: 272, height: 272).background(Color.white.opacity(0.7)).clipShape(RoundedRectangle(cornerRadius: 15))
                }
                HStack(spacing: 12) {
                    Button("复制手机链接") { bridge.copyPhoneLink() }.disabled(bridge.phoneURL == nil)
                    Button("打开 Mac 工作台") { bridge.openWorkbench() }.buttonStyle(.borderedProminent).tint(Color(red: 0.26, green: 0.37, blue: 0.27)).disabled(bridge.localURL == nil)
                    Button("重新连接") { bridge.startTunnel() }.disabled(bridge.localURL == nil)
                }
                VStack(alignment: .leading, spacing: 9) {
                    Text("1   iPhone 扫码 → 用 Safari 打开，确认连接 Mac")
                    Text("2   日常：粘贴对方一句 → 帮我回 → 编辑复制")
                    Text("3   Safari 分享 → 添加到主屏幕，下次像 App 一样打开")
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
