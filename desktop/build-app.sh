#!/bin/zsh
set -euo pipefail
PROJECT_DIR="${0:A:h:h}"
APP_DIR="$PROJECT_DIR/output/弦外.app"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources/Runtime/desktop" "$APP_DIR/Contents/Resources/Runtime/lib"
mkdir -p "$PROJECT_DIR/output/cache/clang" "$PROJECT_DIR/output/cache/swift"
export CLANG_MODULE_CACHE_PATH="$PROJECT_DIR/output/cache/clang"
export SWIFT_MODULECACHE_PATH="$PROJECT_DIR/output/cache/swift"
SDK_PATH="$(xcrun --show-sdk-path)"
if [[ -d /Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk ]]; then SDK_PATH=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk; fi
swiftc -sdk "$SDK_PATH" -module-cache-path "$SWIFT_MODULECACHE_PATH" -target arm64-apple-macosx14.0 -O -parse-as-library "$PROJECT_DIR/desktop/XianwaiMac.swift" "$PROJECT_DIR/desktop/TunnelReadiness.swift" -o "$APP_DIR/Contents/MacOS/Xianwai" -framework SwiftUI -framework AppKit -framework CoreImage -framework Security
swiftc -sdk "$SDK_PATH" -module-cache-path "$SWIFT_MODULECACHE_PATH" -target arm64-apple-macosx14.0 -O "$PROJECT_DIR/desktop/OCR.swift" -o "$APP_DIR/Contents/Resources/xianwai-ocr" -framework AppKit -framework Vision -framework ImageIO
swift -sdk "$SDK_PATH" -module-cache-path "$SWIFT_MODULECACHE_PATH" "$PROJECT_DIR/desktop/GenerateIcon.swift" "$PROJECT_DIR/dist/app-icon.png"
cp "$PROJECT_DIR/dist/app-icon.png" "$APP_DIR/Contents/Resources/app-icon.png"
cp -R "$PROJECT_DIR/dist" "$APP_DIR/Contents/Resources/Runtime/"
cp "$PROJECT_DIR/lib/ai.mjs" "$PROJECT_DIR/lib/codex.mjs" "$PROJECT_DIR/lib/workspace-store.mjs" "$PROJECT_DIR/lib/process.mjs" "$PROJECT_DIR/lib/history-review.mjs" "$PROJECT_DIR/lib/jobs.mjs" "$PROJECT_DIR/lib/reply-verification.mjs" "$PROJECT_DIR/lib/reply-verification.schema.json" "$PROJECT_DIR/lib/history-chunk.schema.json" "$PROJECT_DIR/lib/history-report.schema.json" "$PROJECT_DIR/lib/analysis.schema.json" "$APP_DIR/Contents/Resources/Runtime/lib/"
cp "$PROJECT_DIR/desktop/runtime-server.mjs" "$APP_DIR/Contents/Resources/Runtime/desktop/"
printf '%s\n' '{"type":"module"}' > "$APP_DIR/Contents/Resources/Runtime/package.json"
cat > "$APP_DIR/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Xianwai</string>
<key>CFBundleIdentifier</key><string>local.hanbin.xianwai</string>
<key>CFBundleName</key><string>弦外</string>
<key>CFBundleDisplayName</key><string>弦外</string>
<key>CFBundleVersion</key><string>17</string>
<key>CFBundleShortVersionString</key><string>0.7.3</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>app-icon.png</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
PLIST
codesign --force --deep --sign - "$APP_DIR"
echo "$APP_DIR"
