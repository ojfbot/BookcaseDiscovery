// Test support: ocr-vision-fixture <out.png> <text> [degrees-clockwise]
// Writes a synthetic text image and prints one OCR request line (JSON) for it, rotations 0, 90, 270.
import Foundation
import OcrVisionSynthetic

let a = CommandLine.arguments
guard a.count >= 3 else {
    FileHandle.standardError.write(Data("usage: ocr-vision-fixture <out.png> <text> [degrees-clockwise]\n".utf8))
    exit(2)
}
let degrees = a.count > 3 ? Double(a[3]) ?? 0 : 0
let (image, polygon) = Synthetic.textImage(a[2], degrees: degrees)
try Synthetic.write(image, to: URL(fileURLWithPath: a[1]))
let request: [String: Any] = ["id": "fixture", "image": a[1], "polygon": polygon, "rotations": [0, 90, 270]]
let data = try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys, .withoutEscapingSlashes])
print(String(decoding: data, as: UTF8.self))
