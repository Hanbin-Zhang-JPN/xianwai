import UIKit
import Vision

enum ScreenshotRecognizer {
    /// All processing happens on the device. Speaker assignment is a provisional
    /// geometric estimate, not access to WeChat message metadata.
    static func recognize(_ image: UIImage) throws -> [[String: String]] {
        // Render once to normalize image orientation and limit decoded dimensions.
        let ratio = min(1, 2800 / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * ratio, height: image.size.height * ratio)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let normalized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let cgImage = normalized.cgImage else { return [] }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
        request.usesLanguageCorrection = true
        try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
        let observations = (request.results ?? []).sorted {
            let firstBand = Int(($0.boundingBox.midY * 100).rounded())
            let secondBand = Int(($1.boundingBox.midY * 100).rounded())
            if firstBand != secondBand { return firstBand > secondBand }
            return $0.boundingBox.minX < $1.boundingBox.minX
        }
        return observations.compactMap { item in
            guard let text = item.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
            // Keep all recognized lines so the review UI can remove navigation,
            // timestamps, OCR fragments and system labels rather than losing data.
            return ["role": item.boundingBox.midX > 0.58 ? "me" : "partner", "text": text]
        }
    }
}
