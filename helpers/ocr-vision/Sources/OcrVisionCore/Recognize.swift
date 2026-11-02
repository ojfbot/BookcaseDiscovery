// Apple Vision text recognition on one crop, one language-correction setting.
import CoreGraphics
import Foundation
import Vision

public enum Recognizer {
    /// Fixed, so a run is reproducible (INV-14). The contract has no language field.
    static let languages = ["en-US"]

    /// The request revision Vision will use on this OS. Reported in the response `version`.
    public static var requestRevision: Int {
        let r = VNRecognizeTextRequest()
        r.recognitionLevel = .accurate
        return r.revision
    }

    /// Text is the top candidate of each recognised line, top to bottom, joined with "\n" (empty when
    /// nothing is found). Confidence is the mean of those candidates' confidences; 0 when nothing is found.
    public static func recognize(_ image: CGImage, languageCorrection: Bool) throws -> (text: String, confidence: Double) {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = languageCorrection
        request.recognitionLanguages = languages
        // Orientation is explicit: the crop has already been turned to the rotation under test.
        let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
        do {
            try handler.perform([request])
        } catch {
            throw HelperError(code: ErrorCode.recognitionFailed, message: "\(error)")
        }
        let observations = (request.results ?? []).sorted {
            // Vision's boxes are normalised with y up: larger midY is higher on the page.
            let (a, b) = ($0.boundingBox, $1.boundingBox)
            return a.midY != b.midY ? a.midY > b.midY : a.minX < b.minX
        }
        let candidates = observations.compactMap { $0.topCandidates(1).first }
        guard !candidates.isEmpty else { return ("", 0) }
        let mean = candidates.map { Double($0.confidence) }.reduce(0, +) / Double(candidates.count)
        return (candidates.map(\.string).joined(separator: "\n"), mean)
    }
}
