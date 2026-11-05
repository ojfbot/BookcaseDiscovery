// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "ocr-vision",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "ocr-vision", targets: ["ocr-vision"]),
        .executable(name: "ocr-vision-fixture", targets: ["ocr-vision-fixture"]),
        .executable(name: "ocr-vision-lines", targets: ["ocr-vision-lines"]),
    ],
    targets: [
        // Everything testable: decode, perspective crop, rotate, recognise, JSON Lines records.
        .target(name: "OcrVisionCore"),
        // The helper itself: stdin JSON Lines in, stdout JSON Lines out.
        .executableTarget(name: "ocr-vision", dependencies: ["OcrVisionCore"]),
        // SC-1: text lines with their quads over a photo's non-book regions (book boxes painted out), not the contract.
        .executableTarget(name: "ocr-vision-lines", dependencies: ["OcrVisionCore"]),
        // Test support, not part of the pipeline: OcrVisionSynthetic draws text images (CoreGraphics) so tests
        // need no committed image; ocr-vision-fixture lets the TypeScript contract test use it.
        .executableTarget(name: "ocr-vision-fixture", dependencies: ["OcrVisionSynthetic"]),
        .target(name: "OcrVisionSynthetic"),
        .testTarget(name: "OcrVisionCoreTests", dependencies: ["OcrVisionCore", "OcrVisionSynthetic"]),
    ]
)
