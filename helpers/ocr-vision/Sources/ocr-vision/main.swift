// ocr-vision: read JSON Lines OCR requests on stdin, write one JSON Lines response per request on stdout.
// Contract: contracts/helpers/ocr-request.schema.json and ocr-response.schema.json.
// stderr carries diagnostics only; it never carries recognised text.
import Foundation
import OcrVisionCore

setvbuf(stdout, nil, _IOLBF, 0)

func warn(_ message: String) {
    FileHandle.standardError.write(Data("ocr-vision: \(message)\n".utf8))
}

if CommandLine.arguments.dropFirst().contains(where: { $0 == "--version" }) {
    let engine = OcrEngine()
    print("\(engine.version.helper) \(engine.version.os) VNRecognizeTextRequest revision \(engine.version.requestRevision)")
    exit(0)
}
if CommandLine.arguments.count > 1 {
    warn("usage: ocr-vision < requests.jsonl > responses.jsonl   (or --version)")
    exit(2)
}

let engine = OcrEngine(log: warn)
var lineNumber = 0
while let line = readLine(strippingNewline: true) {
    lineNumber += 1
    if line.allSatisfy(\.isWhitespace) { continue }
    let response = engine.handle(line: Data(line.utf8), lineNumber: lineNumber)
    print(JSONLine.encode(response))
}
