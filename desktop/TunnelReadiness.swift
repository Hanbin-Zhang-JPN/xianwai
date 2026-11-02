import Foundation

struct TunnelReadiness {
    private var buffer = ""
    private(set) var address: String?
    private(set) var registered = false
    mutating func ingest(_ chunk: String) {
        buffer = String((buffer + chunk).suffix(24000))
        if let regex = try? NSRegularExpression(pattern: "https://(?!api\\.)[a-z0-9-]+\\.trycloudflare\\.com"),
           let match = regex.matches(in: buffer, range: NSRange(buffer.startIndex..., in: buffer)).last,
           let range = Range(match.range, in: buffer) { address = String(buffer[range]) }
        if buffer.contains("Registered tunnel connection") { registered = true }
    }
    static func hasIPv4Answer(_ output: String) -> Bool {
        output.split(whereSeparator: \.isNewline).contains { line in
            let parts = line.split(separator: ".", omittingEmptySubsequences: false)
            return parts.count == 4 && parts.allSatisfy { part in
                !part.isEmpty && part.allSatisfy(\.isNumber) && (Int(part).map { (0...255).contains($0) } ?? false)
            }
        }
    }
}
