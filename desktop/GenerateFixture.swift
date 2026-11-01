import AppKit
import Foundation
let image=NSImage(size:NSSize(width:780,height:1688))
image.lockFocus()
NSColor(calibratedWhite:0.96,alpha:1).setFill();NSRect(x:0,y:0,width:780,height:1688).fill()
func text(_ value:String,_ rect:NSRect,_ size:CGFloat=30) { (value as NSString).draw(in:rect,withAttributes:[.font:NSFont.systemFont(ofSize:size),.foregroundColor:NSColor.black]) }
func bubble(_ value:String,_ x:CGFloat,_ y:CGFloat,_ me:Bool=false) { (me ? NSColor(calibratedRed:0.78,green:0.89,blue:0.65,alpha:1):NSColor.white).setFill();NSBezierPath(roundedRect:NSRect(x:x,y:y,width:495,height:95),xRadius:15,yRadius:15).fill();text(value,NSRect(x:x+20,y:y+20,width:460,height:55)) }
text("聊天测试",NSRect(x:310,y:1540,width:300,height:70))
text("20:15",NSRect(x:345,y:1430,width:180,height:50),24)
bubble("今晚想和你一起吃饭。",125,1290)
bubble("临时要开会，晚一点到。",185,1120,true)
bubble("那我先等你一会儿。",125,950)
bubble("算了，你忙吧。",125,780)
image.unlockFocus()
try NSBitmapImageRep(data:image.tiffRepresentation!)!.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
