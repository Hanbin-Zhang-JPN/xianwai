import SwiftUI
import WebKit
import PhotosUI

struct XianwaiWebView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> XianwaiController { XianwaiController() }
    func updateUIViewController(_ controller: XianwaiController, context: Context) {}
    static func dismantleUIViewController(_ controller: XianwaiController, coordinator: ()) {
        controller.tearDown()
    }
}

@MainActor
final class XianwaiController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, PHPickerViewControllerDelegate {
    private var webView: WKWebView!
    private var readingImage = false
    private var screenshotRequestId: String?
    private let fileRoot = Bundle.main.url(forResource: "Web", withExtension: nil)!

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "xianwai")
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.97, green: 0.98, blue: 0.96, alpha: 1)
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        view = webView
        webView.loadFileURL(fileRoot.appendingPathComponent("index.html"), allowingReadAccessTo: fileRoot)
    }

    func tearDown() { screenshotRequestId = nil; webView?.configuration.userContentController.removeScriptMessageHandler(forName: "xianwai") }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let url = webView.url, url.isFileURL,
              url.standardizedFileURL.path.hasPrefix(fileRoot.standardizedFileURL.path + "/"),
              let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        switch action {
        case "pickScreenshot":
            guard let requestId = body["requestId"] as? String, !readingImage, presentedViewController == nil else { return }
            screenshotRequestId = requestId
            var configuration = PHPickerConfiguration(photoLibrary: .shared())
            configuration.filter = .images
            configuration.selectionLimit = 1
            let picker = PHPickerViewController(configuration: configuration)
            picker.delegate = self
            present(picker, animated: true)
        case "copy":
            if let text = body["text"] as? String, text.count <= 80_000 {
                UIPasteboard.general.setItems([["public.utf8-plain-text": text]], options: [.localOnly: true])
            }
        case "export":
            guard let text = body["text"] as? String, text.count <= 400_000 else { return }
            let file = FileManager.default.temporaryDirectory.appendingPathComponent("Xianwai-\(UUID().uuidString).json")
            do { try text.write(to: file, atomically: true, encoding: .utf8) }
            catch { notify("无法生成导出文件，请稍后再试。"); return }
            let activity = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            activity.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: file) }
            activity.popoverPresentationController?.sourceView = view
            activity.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            present(activity, animated: true)
        default: break
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.isFileURL && url.standardizedFileURL.path.hasPrefix(fileRoot.standardizedFileURL.path + "/") {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
        }
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let requestId = screenshotRequestId else { return }
        guard let provider = results.first?.itemProvider else { cancelScreenshot(requestId); return }
        guard provider.canLoadObject(ofClass: UIImage.self) else { cancelScreenshot(requestId); notify("这张图片暂时无法读取，请尝试 PNG 或 JPG 截图。"); return }
        readingImage = true
        provider.loadObject(ofClass: UIImage.self) { [weak self] object, _ in
            guard let image = object as? UIImage else {
                Task { @MainActor in self?.readingImage = false; self?.cancelScreenshot(requestId); self?.notify("无法读取截图，请重新选择。") }
                return
            }
            do {
                let rows = try ScreenshotRecognizer.recognize(image)
                Task { @MainActor in
                    guard let self, self.screenshotRequestId == requestId else { return }
                    self.readingImage = false
                    if rows.isEmpty { self.cancelScreenshot(requestId); self.notify("没有识别到聊天文字，请选择更清晰的截图。"); return }
                    self.screenshotRequestId = nil
                    self.webView.callAsyncJavaScript("window.xianwaiReceiveOCR(rows, requestId)", arguments: ["rows": rows, "requestId": requestId], in: nil, contentWorld: .page, completionHandler: nil)
                }
            } catch {
                Task { @MainActor in self?.readingImage = false; self?.cancelScreenshot(requestId); self?.notify("截图识别失败。可以稍后重试，或粘贴聊天文字。") }
            }
        }
    }

    private func cancelScreenshot(_ requestId: String) {
        guard screenshotRequestId == requestId else { return }
        screenshotRequestId = nil
        webView.callAsyncJavaScript("window.xianwaiOCRCancelled(requestId)", arguments: ["requestId": requestId], in: nil, contentWorld: .page, completionHandler: nil)
    }

    private func notify(_ text: String) {
        webView.callAsyncJavaScript("window.xianwaiError(message)", arguments: ["message": text], in: nil, contentWorld: .page, completionHandler: nil)
    }
}
