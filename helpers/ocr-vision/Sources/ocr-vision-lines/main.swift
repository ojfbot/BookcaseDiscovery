// ocr-vision-lines (card SC-1): generic text detection on a photo's non-book regions, so the store's own signage can
// be read (shelf strips, section and end-cap signs, letter tabs, row labels). Not part of the ocr-request contract:
// a separate product, so `ocr-vision` and F-0's cached reads are untouched.
//
// stdin, one line per photo: {"id", "image", "books": [[[x, y] x4], ...], "tile", "overlap"}. Every kept book box in
// `books` is painted out (mid grey) first, so text on books is never read. The photo is cut into square tiles of
// `tile` px overlapping by `overlap`; each tile runs VNRecognizeTextRequest (.accurate, language correction off,
// en-US). A line found in two tiles is kept once (the more confident copy).
// stdout, one line per photo: {"id", "lines": [{"quad": [[x, y] x4], "text", "confidence"}], "tiles", "seconds"}
// in stored pixels, origin top-left, corners top-left, top-right, bottom-right, bottom-left; or {"id", "error"}.
// stderr carries progress only, never recognised text.
import CoreGraphics
import Foundation
import OcrVisionCore
import Vision

setvbuf(stdout, nil, _IOLBF, 0)

func warn(_ message: String) {
    FileHandle.standardError.write(Data("ocr-vision-lines: \(message)\n".utf8))
}

struct Request: Decodable {
    let id: String
    let image: String
    let books: [[[Double]]]
    let tile: Int
    let overlap: Int
}

struct Line: Encodable {
    let quad: [[Double]]
    let text: String
    let confidence: Double
}

func starts(_ n: Int, _ tile: Int, _ overlap: Int) -> [Int] {
    if n <= tile { return [0] }
    var out = Array(stride(from: 0, to: n - tile, by: tile - overlap))
    out.append(n - tile)
    return out
}

/// The photo with every book polygon filled grey, in a top-left-origin bitmap.
func paintedOut(_ image: CGImage, books: [[[Double]]]) -> CGImage? {
    let (w, h) = (image.width, image.height)
    guard let ctx = CGContext(
        data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { return nil }
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    // CoreGraphics' origin is bottom-left; polygons are top-left.
    ctx.setFillColor(CGColor(gray: 0.5, alpha: 1))
    for poly in books where poly.count >= 3 {
        ctx.beginPath()
        ctx.move(to: CGPoint(x: poly[0][0], y: Double(h) - poly[0][1]))
        for p in poly.dropFirst() { ctx.addLine(to: CGPoint(x: p[0], y: Double(h) - p[1])) }
        ctx.closePath()
        ctx.fillPath()
    }
    return ctx.makeImage()
}

func overlapShare(_ a: [[Double]], _ b: [[Double]]) -> Double {
    func bounds(_ q: [[Double]]) -> (Double, Double, Double, Double) {
        (q.map { $0[0] }.min()!, q.map { $0[1] }.min()!, q.map { $0[0] }.max()!, q.map { $0[1] }.max()!)
    }
    let (ax0, ay0, ax1, ay1) = bounds(a), (bx0, by0, bx1, by1) = bounds(b)
    let inter = max(0, min(ax1, bx1) - max(ax0, bx0)) * max(0, min(ay1, by1) - max(ay0, by0))
    let small = min((ax1 - ax0) * (ay1 - ay0), (bx1 - bx0) * (by1 - by0))
    return small > 0 ? inter / small : 0
}

func lines(in image: CGImage, tile: Int, overlap: Int) throws -> ([Line], Int) {
    var found: [Line] = []
    var tiles = 0
    let (W, H) = (image.width, image.height)
    for y0 in starts(H, tile, overlap) {
        for x0 in starts(W, tile, overlap) {
            tiles += 1
            let tw = min(tile, W - x0), th = min(tile, H - y0)
            guard let sub = image.cropping(to: CGRect(x: x0, y: y0, width: tw, height: th)) else { continue }
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = false
            request.recognitionLanguages = ["en-US"]
            try VNImageRequestHandler(cgImage: sub, orientation: .up, options: [:]).perform([request])
            for obs in request.results ?? [] {
                guard let top = obs.topCandidates(1).first, !top.string.trimmingCharacters(in: .whitespaces).isEmpty
                else { continue }
                // Vision's points are normalised with y up.
                let px = { (p: CGPoint) -> [Double] in
                    [Double(x0) + Double(p.x) * Double(tw), Double(y0) + (1 - Double(p.y)) * Double(th)]
                }
                found.append(Line(
                    quad: [px(obs.topLeft), px(obs.topRight), px(obs.bottomRight), px(obs.bottomLeft)],
                    text: top.string, confidence: Double(top.confidence)))
            }
        }
    }
    found.sort { $0.confidence > $1.confidence }
    var kept: [Line] = []
    for f in found where kept.allSatisfy({ overlapShare($0.quad, f.quad) < 0.6 }) { kept.append(f) }
    return (kept, tiles)
}

struct Out: Encodable {
    let id: String
    let lines: [Line]?
    let tiles: Int?
    let seconds: Double?
    let error: String?
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
while let raw = readLine(strippingNewline: true) {
    if raw.allSatisfy(\.isWhitespace) { continue }
    let t0 = Date()
    var out: Out
    do {
        let req = try JSONDecoder().decode(Request.self, from: Data(raw.utf8))
        do {
            let loaded = try ImageLoader.load(path: req.image)
            guard let painted = paintedOut(loaded.image, books: req.books) else {
                throw HelperError(code: ErrorCode.cropFailed, message: "paint-out failed")
            }
            let (ls, n) = try lines(in: painted, tile: req.tile, overlap: req.overlap)
            let s = (Date().timeIntervalSince(t0) * 100).rounded() / 100
            out = Out(id: req.id, lines: ls, tiles: n, seconds: s, error: nil)
            warn("photo done, \(n) tiles, \(ls.count) lines, \(Int(s)) s")
        } catch let e as HelperError {
            out = Out(id: req.id, lines: nil, tiles: nil, seconds: nil, error: e.code)
        } catch {
            out = Out(id: req.id, lines: nil, tiles: nil, seconds: nil, error: ErrorCode.recognitionFailed)
        }
    } catch {
        out = Out(id: "bad-request", lines: nil, tiles: nil, seconds: nil, error: ErrorCode.badRequest)
    }
    print(String(decoding: try! encoder.encode(out), as: UTF8.self))
}
