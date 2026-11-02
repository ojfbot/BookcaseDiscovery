import CoreGraphics
import CoreImage
import Foundation
import OcrVisionCore
import OcrVisionSynthetic

/// A fresh temp directory per test run; removed by the OS. Nothing here is committed.
func tempDir() -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("ocr-vision-tests-\(UUID().uuidString)")
    try! FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

/// RGBA8 pixels of an image, row 0 at the top.
func pixels(_ image: CGImage) -> (w: Int, h: Int, rgba: [UInt8]) {
    let w = image.width, h = image.height
    var data = [UInt8](repeating: 0, count: w * h * 4)
    let ctx = CGContext(
        data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    return (w, h, data)
}

enum Colour { case red, green, blue, other }

func colour(_ p: (w: Int, h: Int, rgba: [UInt8]), x: Int, y: Int) -> Colour {
    let i = (y * p.w + x) * 4
    let (r, g, b) = (Int(p.rgba[i]), Int(p.rgba[i + 1]), Int(p.rgba[i + 2]))
    if r > 200, g < 80, b < 80 { return .red }
    if g > 200, r < 80, b < 80 { return .green }
    if b > 200, r < 80, g < 80 { return .blue }
    return .other
}

/// A grey canvas with a marker inside a box: red top-left, green top-right, blue bottom-right, so any
/// turn or flip of a crop of that box is visible in which corner holds which colour. `degrees` turns the
/// whole box clockwise about the canvas centre. Returns the image and the box's four corners.
func markerImage(boxW: Double, boxH: Double, degrees: Double, canvas: Double = 1000)
    -> (image: CGImage, polygon: [[Double]])
{
    let ctx = CGContext(
        data: nil, width: Int(canvas), height: Int(canvas), bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setFillColor(CGColor(gray: 0.5, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: canvas, height: canvas))
    ctx.translateBy(x: canvas / 2, y: canvas / 2)
    ctx.scaleBy(x: 1, y: -1)  // y-down, so a positive angle is clockwise on screen
    let rad = degrees * .pi / 180
    ctx.rotate(by: CGFloat(rad))
    let hw = boxW / 2, hh = boxH / 2, m = 24.0
    ctx.setFillColor(CGColor(gray: 0.5, alpha: 1))
    ctx.fill(CGRect(x: -hw, y: -hh, width: boxW, height: boxH))
    func block(_ r: Double, _ g: Double, _ b: Double, _ x: Double, _ y: Double) {
        ctx.setFillColor(CGColor(srgbRed: r, green: g, blue: b, alpha: 1))
        ctx.fill(CGRect(x: x, y: y, width: m, height: m))
    }
    block(1, 0, 0, -hw, -hh)         // top-left
    block(0, 1, 0, hw - m, -hh)      // top-right
    block(0, 0, 1, hw - m, hh - m)   // bottom-right
    let corners = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)].map { (x, y) -> [Double] in
        [canvas / 2 + x * cos(rad) - y * sin(rad), canvas / 2 + x * sin(rad) + y * cos(rad)]
    }
    return (ctx.makeImage()!, corners)
}

/// Lower-case, letters and digits only, so "Silver Lantern" and "SILVER\nLANTERN" compare equal.
func squash(_ s: String) -> String {
    String(s.lowercased().unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) })
}
