// One request line in, one response line out. The helper keeps running after a failed request.
import CoreImage
import Foundation

/// A request line that parsed, or the error response that answers one that did not.
public enum Parsed: Sendable {
    case request(OcrRequest)
    case rejected(OcrResponse)
}

public final class OcrEngine {
    public static let helperName = "ocr-vision/0.1.0"
    static let allowedRotations: Set<Int> = [0, 90, 180, 270]
    static let requestKeys: Set<String> = ["id", "image", "polygon", "rotations"]

    private let context = CIContext()
    private var cachedPath: String?
    private var cached: ImageLoader.Loaded?
    private let log: (String) -> Void

    public let version: OcrVersion

    /// `log` receives diagnostics for stderr; it never receives recognised text.
    public init(log: @escaping (String) -> Void = { _ in }) {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        version = OcrVersion(
            helper: Self.helperName,
            os: "macOS \(v.majorVersion).\(v.minorVersion).\(v.patchVersion)",
            requestRevision: Recognizer.requestRevision)
        self.log = log
    }

    /// Parse one JSON Lines record. `lineNumber` names a record whose `id` cannot be read.
    public func parse(line: Data, lineNumber: Int) -> Parsed {
        let object = try? JSONSerialization.jsonObject(with: line)
        guard let dict = object as? [String: Any] else {
            return .rejected(.failure(
                id: "line:\(lineNumber)",
                error: HelperError(code: ErrorCode.badRequest, message: "line is not a JSON object")))
        }
        let id = (dict["id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "line:\(lineNumber)"
        let extra = Set(dict.keys).subtracting(Self.requestKeys)
        guard extra.isEmpty else {
            return .rejected(.failure(
                id: id, error: HelperError(code: ErrorCode.badRequest, message: "unknown field(s): \(extra.sorted())")))
        }
        let request: OcrRequest
        do {
            request = try JSONDecoder().decode(OcrRequest.self, from: line)
        } catch {
            return .rejected(.failure(id: id, error: HelperError(code: ErrorCode.badRequest, message: "\(error)")))
        }
        if request.id.isEmpty || request.image.isEmpty || request.rotations.isEmpty
            || request.polygon.count != 4 || request.polygon.contains(where: { $0.count != 2 })
            || !request.rotations.allSatisfy(Self.allowedRotations.contains)
        {
            return .rejected(.failure(
                id: id,
                error: HelperError(
                    code: ErrorCode.badRequest,
                    message: "need non-empty id and image, a 4-point polygon, and rotations drawn from 0, 90, 180, 270")))
        }
        return .request(request)
    }

    public func handle(_ request: OcrRequest) -> OcrResponse {
        do {
            let loaded = try image(at: request.image)
            let crops = try Crop.render(
                image: loaded.image, polygon: request.polygon, rotations: request.rotations, context: context)
            var variants: [OcrVariant] = []
            for rotation in request.rotations {
                // `parse` guarantees every rotation was rendered.
                let crop = crops[rotation]!
                for correction in [false, true] {
                    let r = try Recognizer.recognize(crop, languageCorrection: correction)
                    variants.append(OcrVariant(
                        rotation: rotation, langCorrection: correction, text: r.text, confidence: r.confidence))
                }
            }
            return .success(id: request.id, variants: variants, version: version)
        } catch let e as HelperError {
            return .failure(id: request.id, error: e)
        } catch {
            return .failure(id: request.id, error: HelperError(code: ErrorCode.recognitionFailed, message: "\(error)"))
        }
    }

    public func handle(line: Data, lineNumber: Int) -> OcrResponse {
        switch parse(line: line, lineNumber: lineNumber) {
        case let .request(request): return handle(request)
        case let .rejected(response): return response
        }
    }

    /// Consecutive requests usually name the same working copy (many spines per photo); decode it once.
    private func image(at path: String) throws -> ImageLoader.Loaded {
        if path == cachedPath, let cached { return cached }
        let loaded = try ImageLoader.load(path: path)
        if loaded.storedOrientation != 1 {
            log("warning: an image has EXIF orientation \(loaded.storedOrientation); working copies should be orientation-normalised. Using stored pixels.")
        }
        cachedPath = path
        cached = loaded
        return loaded
    }
}

public enum JSONLine {
    public static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return e
    }()

    public static func encode(_ response: OcrResponse) -> String {
        // Encoding plain strings and numbers cannot fail; a failure here is a programming error.
        String(decoding: try! encoder.encode(response), as: UTF8.self)
    }
}
