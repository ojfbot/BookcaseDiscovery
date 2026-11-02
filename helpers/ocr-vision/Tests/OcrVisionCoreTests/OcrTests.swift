import CoreGraphics
import Foundation
import OcrVisionCore
import OcrVisionSynthetic
import Testing

@Suite struct OcrTests {
    static let phrase = "SILVER LANTERN ATLAS"

    func run(_ image: CGImage, polygon: [[Double]], rotations: [Int], exif: Int? = nil) throws -> OcrResponse {
        let dir = tempDir()
        let url = dir.appendingPathComponent(exif == nil ? "t.png" : "t.jpg")
        try Synthetic.write(image, to: url, exifOrientation: exif)
        let engine = OcrEngine()
        return engine.handle(OcrRequest(id: "t1", image: url.path, polygon: polygon, rotations: rotations))
    }

    func variants(_ r: OcrResponse) throws -> [OcrVariant] {
        guard case let .success(_, variants, _) = r else {
            Issue.record("expected a success response, got \(r)")
            return []
        }
        return variants
    }

    /// Text drawn at a known clockwise angle needs the opposite turn to read upright: 0 -> 0, 90 -> 270, 270 -> 90.
    @Test(arguments: [(0.0, 0), (90.0, 270), (270.0, 90)])
    func readsTextAtKnownRotations(drawn: Double, needs: Int) throws {
        let (img, poly) = Synthetic.textImage(Self.phrase, degrees: drawn)
        let vs = try variants(run(img, polygon: poly, rotations: [0, 90, 270]))
        // Two tagged variants per rotation, in request order, correction off then on.
        #expect(vs.map { "\($0.rotation)/\($0.langCorrection)" } == ["0/false", "0/true", "90/false", "90/true", "270/false", "270/true"])
        for correction in [false, true] {
            let v = try #require(vs.first { $0.rotation == needs && $0.langCorrection == correction })
            #expect(squash(v.text) == squash(Self.phrase), "drawn \(drawn), rotation \(needs), correction \(correction): \(v.text)")
            #expect(v.confidence > 0.5)
        }
    }

    /// Not an assertion about Vision: records, in the test log, which wrong rotations it still reads on this OS.
    @Test func recordsWhetherVisionReadsWrongRotations() throws {
        let (img, poly) = Synthetic.textImage(Self.phrase, degrees: 90)
        let vs = try variants(run(img, polygon: poly, rotations: [0, 90, 180, 270]))
        for v in vs where !v.langCorrection {
            print("rotation-probe drawn=90cw rotation=\(v.rotation) matches=\(squash(v.text) == squash(Self.phrase)) confidence=\(v.confidence)")
        }
    }

    @Test func tiltedTextIsDeskewed() throws {
        let (img, poly) = Synthetic.textImage(Self.phrase, degrees: 10)
        let vs = try variants(run(img, polygon: poly, rotations: [0]))
        #expect(vs.allSatisfy { squash($0.text) == squash(Self.phrase) })
    }

    /// Pixel-frame rule: the polygon is in stored pixels. A JPEG tagged orientation 6 is read as stored.
    @Test func polygonIsInStoredPixelsNotDisplayPixels() throws {
        let (img, poly) = Synthetic.textImage(Self.phrase, degrees: 0)
        let vs = try variants(run(img, polygon: poly, rotations: [0], exif: 6))
        #expect(vs.allSatisfy { squash($0.text) == squash(Self.phrase) })
    }

    @Test func blankCropGivesEmptyTextAndZeroConfidence() throws {
        let (img, _) = Synthetic.textImage("", degrees: 0)
        let vs = try variants(run(img, polygon: [[100, 100], [500, 100], [500, 300], [100, 300]], rotations: [0]))
        #expect(vs.count == 2)
        #expect(vs.allSatisfy { $0.text.isEmpty && $0.confidence == 0 })
    }

    @Test func versionNamesHelperOsAndRevision() throws {
        let v = OcrEngine().version
        #expect(v.helper.hasPrefix("ocr-vision/"))
        #expect(v.os.hasPrefix("macOS "))
        #expect(v.requestRevision >= 1)
    }
}

@Suite struct ProtocolTests {
    let engine = OcrEngine()

    func respond(_ line: String, n: Int = 1) throws -> [String: Any] {
        let out = JSONLine.encode(engine.handle(line: Data(line.utf8), lineNumber: n))
        #expect(!out.contains("\n"), "one response is one line")
        return try #require(JSONSerialization.jsonObject(with: Data(out.utf8)) as? [String: Any])
    }

    func errorCode(_ r: [String: Any]) -> String? { (r["error"] as? [String: Any])?["code"] as? String }

    @Test func unreadableImageIsAnErrorForThatIdOnly() throws {
        let r = try respond(#"{"id":"a","image":"/no/such/file.png","polygon":[[0,0],[9,0],[9,9],[0,9]],"rotations":[0]}"#)
        #expect(r["id"] as? String == "a")
        #expect(errorCode(r) == ErrorCode.imageUnreadable)
        #expect(r["variants"] == nil)
    }

    @Test func malformedRequestsAreRefusedAndKeepTheirIdWhenReadable() throws {
        let cases: [(String, String)] = [
            (#"{"id":"b","image":"x","polygon":[[0,0],[9,0],[9,9],[0,9]],"rotations":[45]}"#, "b"),
            (#"{"id":"c","image":"x","polygon":[[0,0],[9,0],[9,9]],"rotations":[0]}"#, "c"),
            (#"{"id":"d","image":"x","polygon":[[0,0],[9,0],[9,9],[0,9]],"rotations":[]}"#, "d"),
            (#"{"id":"e","image":"x","polygon":[[0,0],[9,0],[9,9],[0,9]],"rotations":[0],"extra":1}"#, "e"),
            (#"{"id":"f","polygon":[[0,0],[9,0],[9,9],[0,9]],"rotations":[0]}"#, "f"),
            (#"not json"#, "line:1"),
            (#"[1,2]"#, "line:1"),
        ]
        for (line, id) in cases {
            let r = try respond(line)
            #expect(r["id"] as? String == id, "\(line)")
            #expect(errorCode(r) == ErrorCode.badRequest, "\(line)")
        }
    }

    @Test func responseKeysMatchTheContract() throws {
        let dir = tempDir()
        let url = dir.appendingPathComponent("t.png")
        let (img, poly) = Synthetic.textImage("ATLAS", degrees: 0)
        try Synthetic.write(img, to: url)
        let req = OcrRequest(id: "ok", image: url.path, polygon: poly, rotations: [0])
        let line = String(decoding: try JSONEncoder().encode(req), as: UTF8.self)
        let r = try respond(line)
        #expect(Set(r.keys) == ["id", "variants", "version"])
        let v = try #require((r["variants"] as? [[String: Any]])?.first)
        #expect(Set(v.keys) == ["rotation", "langCorrection", "text", "confidence"])
        let version = try #require(r["version"] as? [String: Any])
        #expect(Set(version.keys) == ["helper", "os", "requestRevision"])
    }
}
