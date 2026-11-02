// Codable mirrors of contracts/helpers/ocr-request.schema.json and ocr-response.schema.json (card L-1).
// The JSON Schemas are the source of truth; src/ledger/helper-contracts.ts validates the same shapes in TS.
import Foundation

public struct OcrRequest: Codable, Equatable, Sendable {
    public var id: String
    /// Path to the GPS-stripped, orientation-normalised working copy.
    public var image: String
    /// Four corners `[x, y]` in the stored-pixel grid of `image`, origin top-left.
    public var polygon: [[Double]]
    /// Clockwise degrees applied to the crop before recognition: 0, 90, 180 or 270.
    public var rotations: [Int]

    public init(id: String, image: String, polygon: [[Double]], rotations: [Int]) {
        self.id = id
        self.image = image
        self.polygon = polygon
        self.rotations = rotations
    }
}

public struct OcrVariant: Codable, Equatable, Sendable {
    public var rotation: Int
    public var langCorrection: Bool
    public var text: String
    public var confidence: Double

    public init(rotation: Int, langCorrection: Bool, text: String, confidence: Double) {
        self.rotation = rotation
        self.langCorrection = langCorrection
        self.text = text
        self.confidence = confidence
    }
}

public struct OcrVersion: Codable, Equatable, Sendable {
    public var helper: String
    public var os: String
    public var requestRevision: Int

    public init(helper: String, os: String, requestRevision: Int) {
        self.helper = helper
        self.os = os
        self.requestRevision = requestRevision
    }
}

public struct HelperError: Codable, Equatable, Sendable, Error {
    public var code: String
    public var message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
}

/// One response line: exactly the success shape or the error shape.
public enum OcrResponse: Equatable, Sendable {
    case success(id: String, variants: [OcrVariant], version: OcrVersion)
    case failure(id: String, error: HelperError)
}

extension OcrResponse: Encodable {
    private enum Keys: String, CodingKey { case id, variants, version, error }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case let .success(id, variants, version):
            try c.encode(id, forKey: .id)
            try c.encode(variants, forKey: .variants)
            try c.encode(version, forKey: .version)
        case let .failure(id, error):
            try c.encode(id, forKey: .id)
            try c.encode(error, forKey: .error)
        }
    }
}

/// Error codes a caller can switch on. The contract only says `code` is a non-empty string.
public enum ErrorCode {
    public static let badRequest = "bad-request"
    public static let imageUnreadable = "image-unreadable"
    public static let polygonOutOfBounds = "polygon-out-of-bounds"
    public static let polygonDegenerate = "polygon-degenerate"
    public static let cropFailed = "crop-failed"
    public static let recognitionFailed = "recognition-failed"
}
