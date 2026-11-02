import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import OcrVisionCore
import OcrVisionSynthetic
import Testing

@Suite struct CropTests {
    let ctx = CIContext()

    /// Which colour sits near each corner of a crop: [top-left, top-right, bottom-right, bottom-left].
    func corners(_ image: CGImage) -> [Colour] {
        let p = pixels(image)
        let d = 12
        return [(d, d), (p.w - d, d), (p.w - d, p.h - d), (d, p.h - d)].map { colour(p, x: $0.0, y: $0.1) }
    }

    @Test func rotationZeroKeepsTheBoxUpright() throws {
        let (img, poly) = markerImage(boxW: 200, boxH: 500, degrees: 0)
        let crops = try Crop.render(image: img, polygon: poly, rotations: [0], context: ctx)
        let c = try #require(crops[0])
        #expect(abs(c.width - 200) <= 2 && abs(c.height - 500) <= 2)
        #expect(corners(c) == [.red, .green, .blue, .other])
    }

    @Test func rotationsTurnClockwise() throws {
        let (img, poly) = markerImage(boxW: 200, boxH: 500, degrees: 0)
        let crops = try Crop.render(image: img, polygon: poly, rotations: [0, 90, 180, 270], context: ctx)
        // 90 clockwise: the top-left corner moves to top-right, and the crop becomes wide.
        let r90 = try #require(crops[90])
        #expect(abs(r90.width - 500) <= 2 && abs(r90.height - 200) <= 2)
        #expect(corners(r90) == [.other, .red, .green, .blue])
        let r180 = try #require(crops[180])
        #expect(abs(r180.width - 200) <= 2 && abs(r180.height - 500) <= 2)
        #expect(corners(r180) == [.blue, .other, .red, .green])
        let r270 = try #require(crops[270])
        #expect(abs(r270.width - 500) <= 2 && abs(r270.height - 200) <= 2)
        #expect(corners(r270) == [.green, .blue, .other, .red])
    }

    @Test func tiltedQuadIsPerspectiveCorrectedToAnUprightBox() throws {
        for degrees in [-12.0, 7.0, 20.0] {
            let (img, poly) = markerImage(boxW: 200, boxH: 500, degrees: degrees)
            let crops = try Crop.render(image: img, polygon: poly, rotations: [0], context: ctx)
            let c = try #require(crops[0])
            #expect(abs(c.width - 200) <= 3 && abs(c.height - 500) <= 3, "tilt \(degrees)")
            #expect(corners(c) == [.red, .green, .blue, .other], "tilt \(degrees)")
        }
    }

    @Test func cornerOrderAndWindingDoNotMatter() throws {
        let (img, poly) = markerImage(boxW: 200, boxH: 500, degrees: 10)
        let orders = [[0, 1, 2, 3], [1, 2, 3, 0], [3, 2, 1, 0], [2, 1, 0, 3]]
        for order in orders {
            let crops = try Crop.render(image: img, polygon: order.map { poly[$0] }, rotations: [0], context: ctx)
            #expect(corners(try #require(crops[0])) == [.red, .green, .blue, .other], "order \(order)")
        }
    }

    @Test func badPolygonsAreRefusedWithACode() throws {
        let (img, _) = markerImage(boxW: 200, boxH: 500, degrees: 0)
        func code(_ poly: [[Double]]) -> String? {
            do { _ = try Crop.render(image: img, polygon: poly, rotations: [0], context: ctx); return nil }
            catch let e as HelperError { return e.code }
            catch { return "other" }
        }
        #expect(code([[0, 0], [10, 0], [10, 2000], [0, 2000]]) == ErrorCode.polygonOutOfBounds)
        #expect(code([[100, 100], [101, 100], [101, 400], [100, 400]]) == ErrorCode.polygonDegenerate)
        #expect(code([[100, 100], [200, 100], [200, 400]]) == ErrorCode.badRequest)
    }
}

/// Pins what the Apple frameworks do with an EXIF orientation tag, which the pixel-frame rule depends on.
@Suite struct OrientationTests {
    @Test func loaderUsesStoredPixelsWhateverTheTagSays() throws {
        let dir = tempDir()
        let url = dir.appendingPathComponent("tagged.jpg")
        // 400 wide, 200 tall stored; tag 6 says "display rotated 90 clockwise" (so 200 x 400 when displayed).
        let (img, _) = markerImage(boxW: 100, boxH: 100, degrees: 0, canvas: 400)
        let wide = CGContext(
            data: nil, width: 400, height: 200, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        wide.draw(img, in: CGRect(x: 0, y: 0, width: 400, height: 400))
        try Synthetic.write(wide.makeImage()!, to: url, exifOrientation: 6)

        let loaded = try ImageLoader.load(path: url.path)
        #expect(loaded.image.width == 400 && loaded.image.height == 200)
        #expect(loaded.storedOrientation == 6)

        // CoreImage's loader, measured on macOS 27: it ignores the tag unless asked. Recorded so a change in
        // either default shows up here; the helper does not rely on it.
        let plain = try #require(CIImage(contentsOf: url))
        #expect(plain.extent.width == 400 && plain.extent.height == 200)
        let applied = try #require(CIImage(contentsOf: url, options: [.applyOrientationProperty: true]))
        #expect(applied.extent.width == 200 && applied.extent.height == 400)
    }
}
