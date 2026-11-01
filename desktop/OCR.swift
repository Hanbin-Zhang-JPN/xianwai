import Foundation
import AppKit
import Vision
import ImageIO

struct Line {
    var role: String
    var text: String
    var rect: CGRect
}

do {
    guard CommandLine.arguments.count == 2 else { throw NSError(domain: "OCR", code: 1) }
    let url = URL(fileURLWithPath: CommandLine.arguments[1])
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 2800, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary) else {
        throw NSError(domain: "OCR", code: 2)
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US", "ja-JP"]
    request.automaticallyDetectsLanguage = true
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    let pixelWidth = 240, pixelHeight = max(1, min(4096, image.height * 240 / image.width))
    var pixels = [UInt8](repeating: 0, count: pixelWidth * pixelHeight * 4)
    _ = pixels.withUnsafeMutableBytes { bytes in
        guard let context = CGContext(data: bytes.baseAddress, width: pixelWidth, height: pixelHeight, bitsPerComponent: 8, bytesPerRow: pixelWidth * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
        context.draw(image, in: CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight))
    }
    func greenBubble(_ rect: CGRect) -> Bool {
        var green = 0
        for xFraction in [0.08, 0.32, 0.68, 0.92] {
            for yFraction in [0.12, 0.50, 0.88] {
                let x = min(pixelWidth - 1, max(0, Int((rect.minX + rect.width * xFraction) * Double(pixelWidth))))
                let y = min(pixelHeight - 1, max(0, Int((1 - rect.minY - rect.height * yFraction) * Double(pixelHeight))))
                let index = (y * pixelWidth + x) * 4
                let r = Double(pixels[index]) / 255, g = Double(pixels[index + 1]) / 255, b = Double(pixels[index + 2]) / 255
                if g > 0.35 && g > r * 1.10 && g > b * 1.12 { green += 1 }
            }
        }
        return green >= 3
    }
    let lines = (request.results ?? []).compactMap { item -> Line? in
        guard let text = item.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        let rect = item.boundingBox
        // WeChat portrait screenshot: remove status/navigation and bottom input.
        guard rect.midY > 0.095, rect.midY < 0.865, rect.midX > 0.10, rect.midX < 0.90 else { return nil }
        // Centered dates and system timestamps are not conversational turns.
        if abs(rect.midX - 0.5) < 0.12 && (text.range(of: "^(今天|昨天|星期[一二三四五六日天]|周[一二三四五六日天]|[0-9年/月日 :：.-]+)( [0-9:：]+)?$", options: .regularExpression) != nil) { return nil }
        return Line(role: greenBubble(rect) || rect.minX > 0.52 ? "me" : "partner", text: text, rect: rect)
    }.sorted { a, b in
        let ay = Int((a.rect.midY * 200).rounded()), by = Int((b.rect.midY * 200).rounded())
        return ay == by ? a.rect.minX < b.rect.minX : ay > by
    }
    var groups: [Line] = []
    for line in lines {
        if var last = groups.last, last.role == line.role,
           last.rect.minY - line.rect.maxY < 0.016,
           last.rect.minY - line.rect.maxY > -0.005,
           abs(last.rect.minX - line.rect.minX) < 0.055 {
            groups.removeLast()
            last.text += "\n" + line.text
            last.rect = last.rect.union(line.rect)
            groups.append(last)
        } else { groups.append(line) }
    }
    let output = groups.map { ["role": $0.role, "text": $0.text] }
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]))
} catch {
    let code = error as NSError
    FileHandle.standardError.write(Data("截图识别失败（\(code.domain) \(code.code)），请换一张清晰的微信聊天截图。".utf8))
    exit(1)
}
