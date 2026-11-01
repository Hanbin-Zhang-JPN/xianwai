import SwiftUI

@main
struct XianwaiApp: App {
    var body: some Scene {
        WindowGroup {
            XianwaiWebView()
                .background(Color(red: 0.97, green: 0.98, blue: 0.96))
                .preferredColorScheme(.light)
        }
    }
}
