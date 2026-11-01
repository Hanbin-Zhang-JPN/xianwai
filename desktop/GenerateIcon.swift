import AppKit
import Foundation
let image = NSImage(size: NSSize(width: 512, height: 512))
image.lockFocus()
NSColor(calibratedRed: 0.22, green: 0.33, blue: 0.24, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: 512, height: 512), xRadius: 118, yRadius: 118).fill()
NSColor(calibratedRed: 0.93, green: 0.94, blue: 0.86, alpha: 1).setStroke()
let path = NSBezierPath();path.lineWidth = 16;path.lineJoinStyle = .round
path.move(to: NSPoint(x: 155, y: 140));path.line(to: NSPoint(x: 155, y: 327));path.curve(to: NSPoint(x: 205, y: 372), controlPoint1: NSPoint(x: 155, y: 355), controlPoint2: NSPoint(x: 170, y: 372));path.line(to: NSPoint(x: 326, y: 372));path.curve(to: NSPoint(x: 365, y: 328), controlPoint1: NSPoint(x: 350, y: 372), controlPoint2: NSPoint(x: 365, y: 360));path.line(to: NSPoint(x: 365, y: 222));path.curve(to: NSPoint(x: 326, y: 185), controlPoint1: NSPoint(x: 365, y: 197), controlPoint2: NSPoint(x: 350, y: 185));path.line(to: NSPoint(x: 220, y: 185));path.close();path.stroke()
let lines = NSBezierPath();lines.lineWidth = 14;lines.lineCapStyle = .round;lines.move(to: NSPoint(x: 210, y: 304));lines.line(to: NSPoint(x: 311, y: 304));lines.move(to: NSPoint(x: 210, y: 251));lines.line(to: NSPoint(x: 278, y: 251));lines.stroke()
image.unlockFocus()
let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
