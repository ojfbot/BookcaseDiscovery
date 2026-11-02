// Decode, perspective-crop and rotate. Pure CoreGraphics / CoreImage; no Vision here.
import CoreGraphics
import CoreImage
import Foundation
import ImageIO

/// Pixel-frame rule (conductor ruling, card P-1): a polygon is in the stored-pixel grid of the working
/// copy, origin top-left. The working copy is orientation-normalised upstream, so this code never applies
/// an EXIF orientation. What the Apple frameworks do by default, measured on macOS 27 (see
/// `OrientationTests`):
///   - `CGImageSourceCreateImageAtIndex`: stored pixels, EXIF orientation NOT applied. Used here.
///   - `CIImage(contentsOf:)`: EXIF orientation applied. Not used.
///   - `VNImageRequestHandler(cgImage:)`: orientation parameter, default `.up`. Passed explicitly.
public enum ImageLoader {
    public struct Loaded: @unchecked Sendable {
        public let image: CGImage
        /// EXIF orientation tag as stored (1 when absent). Anything other than 1 means the caller broke
        /// the "orientation-normalised working copy" rule; the helper warns on stderr but keeps stored pixels.
        public let storedOrientation: Int
    }

    public static func load(path: String) throws -> Loaded {
        let url = URL(fileURLWithPath: path)
        guard FileManager.default.isReadableFile(atPath: path),
              let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              CGImageSourceGetCount(source) > 0,
              let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCache: false] as CFDictionary)
        else {
            throw HelperError(code: ErrorCode.imageUnreadable, message: "cannot decode an image at the given path")
        }
        let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let orientation = (props?[kCGImagePropertyOrientation] as? Int) ?? 1
        return Loaded(image: image, storedOrientation: orientation)
    }
}

public enum Crop {
    /// Corners in image space (origin top-left, y down), ordered top-left, top-right, bottom-right,
    /// bottom-left. The input is "four corners in order around the box" with unspecified start and winding
    /// (contract), so: fix the winding to clockwise, then start at the corner nearest the image's top-left.
    /// For a quad turned beyond ~45° this start is a convention, not a truth; callers cover the ambiguity
    /// with the rotations they request.
    static func canonicalCorners(_ p: [CGPoint]) -> [CGPoint] {
        var q = p
        var area = 0.0
        for i in 0..<4 {
            let a = q[i], b = q[(i + 1) % 4]
            area += Double(a.x * b.y - b.x * a.y)
        }
        // In a y-down frame a positive shoelace sum is clockwise on screen.
        if area < 0 { q = [q[0], q[3], q[2], q[1]] }
        let start = (0..<4).min { q[$0].x + q[$0].y < q[$1].x + q[$1].y }!
        return (0..<4).map { q[(start + $0) % 4] }
    }

    static func dist(_ a: CGPoint, _ b: CGPoint) -> Double { Double(hypot(a.x - b.x, a.y - b.y)) }

    /// Perspective-correct `polygon` out of `image`, then rotate clockwise by `rotation` degrees.
    public static func render(image: CGImage, polygon: [[Double]], rotations: [Int], context: CIContext) throws
        -> [Int: CGImage]
    {
        let w = Double(image.width), h = Double(image.height)
        guard polygon.count == 4, polygon.allSatisfy({ $0.count == 2 && $0.allSatisfy(\.isFinite) }) else {
            throw HelperError(code: ErrorCode.badRequest, message: "polygon must be four finite [x, y] points")
        }
        // A detector's corner can sit a pixel or two outside the frame; more than that is a caller bug.
        let tol = 2.0
        var pts: [CGPoint] = []
        for pt in polygon {
            guard pt[0] >= -tol, pt[0] <= w + tol, pt[1] >= -tol, pt[1] <= h + tol else {
                throw HelperError(
                    code: ErrorCode.polygonOutOfBounds,
                    message: "polygon corner outside the \(image.width)x\(image.height) image")
            }
            pts.append(CGPoint(x: min(max(pt[0], 0), w), y: min(max(pt[1], 0), h)))
        }
        let c = canonicalCorners(pts)
        let width = (dist(c[0], c[1]) + dist(c[3], c[2])) / 2
        let height = (dist(c[0], c[3]) + dist(c[1], c[2])) / 2
        guard width >= 4, height >= 4 else {
            throw HelperError(code: ErrorCode.polygonDegenerate, message: "polygon is smaller than 4 px on a side")
        }

        // CoreImage is y-up: flip each corner's y against the image height.
        func ci(_ p: CGPoint) -> CIVector { CIVector(x: p.x, y: CGFloat(h) - p.y) }
        let source = CIImage(cgImage: image)
        guard let filter = CIFilter(name: "CIPerspectiveCorrection") else {
            throw HelperError(code: ErrorCode.cropFailed, message: "CIPerspectiveCorrection unavailable")
        }
        filter.setValue(source, forKey: kCIInputImageKey)
        filter.setValue(ci(c[0]), forKey: "inputTopLeft")
        filter.setValue(ci(c[1]), forKey: "inputTopRight")
        filter.setValue(ci(c[2]), forKey: "inputBottomRight")
        filter.setValue(ci(c[3]), forKey: "inputBottomLeft")
        guard let corrected = filter.outputImage, !corrected.extent.isInfinite, !corrected.extent.isEmpty else {
            throw HelperError(code: ErrorCode.cropFailed, message: "perspective correction produced no image")
        }

        var out: [Int: CGImage] = [:]
        for rotation in rotations where out[rotation] == nil {
            // Clockwise on screen is a negative angle in y-up space.
            let radians = -Double(rotation) * .pi / 180
            let turned = corrected.transformed(by: CGAffineTransform(rotationAngle: CGFloat(radians)))
            let origin = turned.extent.origin
            let placed = turned.transformed(by: CGAffineTransform(translationX: -origin.x, y: -origin.y))
            guard let cg = context.createCGImage(
                placed, from: placed.extent.integral, format: .RGBA8,
                colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
            else {
                throw HelperError(code: ErrorCode.cropFailed, message: "could not render the \(rotation) degree crop")
            }
            out[rotation] = cg
        }
        return out
    }
}
