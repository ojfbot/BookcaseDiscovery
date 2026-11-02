// Draws synthetic text images with CoreGraphics so no test needs a committed image (card P-1).
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

public enum Synthetic {
    /// Dark text on a light ground, `degrees` clockwise on screen, centred on a `canvas`-sized image.
    /// Returns the image and the four corners (top-left, top-right, bottom-right, bottom-left of the *text
    /// box before turning*, then turned with it) in stored-pixel coordinates, origin top-left.
    public static func textImage(
        _ text: String, fontSize: CGFloat = 64, degrees: Double = 0, canvas: CGSize = CGSize(width: 1200, height: 1200),
        margin: CGFloat = 24
    ) -> (image: CGImage, polygon: [[Double]]) {
        let font = CTFontCreateWithName("Helvetica-Bold" as CFString, fontSize, nil)
        let attrs: [CFString: Any] = [
            kCTFontAttributeName: font, kCTForegroundColorAttributeName: CGColor(gray: 0.08, alpha: 1),
        ]
        let line = CTLineCreateWithAttributedString(
            CFAttributedStringCreate(nil, text as CFString, attrs as CFDictionary))
        let bounds = CTLineGetBoundsWithOptions(line, [.useOpticalBounds])
        let boxW = bounds.width + 2 * margin, boxH = bounds.height + 2 * margin

        let ctx = CGContext(
            data: nil, width: Int(canvas.width), height: Int(canvas.height), bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.setFillColor(CGColor(gray: 0.93, alpha: 1))
        ctx.fill(CGRect(origin: .zero, size: canvas))

        // Work in a y-down frame centred on the canvas: CGContext is y-up, so flip once, then a clockwise
        // turn on screen is a positive rotation in this frame.
        ctx.translateBy(x: canvas.width / 2, y: canvas.height / 2)
        ctx.scaleBy(x: 1, y: -1)
        ctx.rotate(by: CGFloat(degrees * .pi / 180))
        // The box, then the glyphs. Text is drawn upright in the y-up font space, so flip back for the line.
        ctx.saveGState()
        ctx.scaleBy(x: 1, y: -1)
        ctx.textPosition = CGPoint(x: -bounds.width / 2 - bounds.minX, y: -bounds.height / 2 - bounds.minY)
        CTLineDraw(line, ctx)
        ctx.restoreGState()

        // Polygon: corners of the box in the turned y-down frame, mapped to stored pixels.
        let hw = Double(boxW) / 2, hh = Double(boxH) / 2
        let rad = degrees * .pi / 180
        let corners = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)].map { (x, y) -> [Double] in
            [
                Double(canvas.width) / 2 + x * cos(rad) - y * sin(rad),
                Double(canvas.height) / 2 + x * sin(rad) + y * cos(rad),
            ]
        }
        return (ctx.makeImage()!, corners)
    }

    /// Write as PNG, or as JPEG with an EXIF orientation tag (stored pixels are unchanged by the tag).
    public static func write(_ image: CGImage, to url: URL, exifOrientation: Int? = nil) throws {
        let jpeg = exifOrientation != nil
        let type = (jpeg ? UTType.jpeg : UTType.png).identifier as CFString
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, type, 1, nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        var props: [CFString: Any] = [:]
        if let o = exifOrientation {
            props[kCGImagePropertyOrientation] = o
            props[kCGImageDestinationLossyCompressionQuality] = 0.95
        }
        CGImageDestinationAddImage(dest, image, props as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { throw CocoaError(.fileWriteUnknown) }
    }
}
