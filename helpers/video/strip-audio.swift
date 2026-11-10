// NS-K video helper (AVFoundation, no re-encode; ffmpeg is not used).
//
//   swift helpers/video/strip-audio.swift probe <clip>
//       JSON on stdout: the clip's tracks (media type, codec, sample count, duration) read by AVFoundation.
//   swift helpers/video/strip-audio.swift strip <clip> <out.mov>
//       Writes <out.mov> with every track except the audio tracks: AVAssetReader passthrough (nil outputSettings)
//       into AVAssetWriter (nil outputSettings, the source format as the hint). Video and timed-metadata samples are
//       copied byte for byte; nothing is re-encoded. JSON on stdout: the samples copied per track.
//
// Paths are taken as arguments and never printed. Exit 2 on a usage error, 1 on any failure.
import AVFoundation
import Foundation

struct Fail: Error { let message: String }

func emit(_ value: Any) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func fourcc(_ code: FourCharCode) -> String {
  let bytes = [24, 16, 8, 0].map { UInt8((code >> $0) & 0xff) }
  return String(bytes: bytes, encoding: .macOSRoman) ?? "\(code)"
}

func codecs(_ track: AVAssetTrack) async throws -> [String] {
  let descriptions = try await track.load(.formatDescriptions)
  return descriptions.map { fourcc(CMFormatDescriptionGetMediaSubType($0)) }
}

/// Count a track's samples by reading it once, passthrough.
func sampleCount(asset: AVAsset, track: AVAssetTrack) throws -> Int {
  let reader = try AVAssetReader(asset: asset)
  let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
  output.alwaysCopiesSampleData = false
  guard reader.canAdd(output) else { throw Fail(message: "reader cannot add a track output") }
  reader.add(output)
  guard reader.startReading() else { throw Fail(message: "reader did not start: \(reader.error?.localizedDescription ?? "unknown")") }
  var n = 0
  while let buffer = output.copyNextSampleBuffer() { n += CMSampleBufferGetNumSamples(buffer) }
  if reader.status == .failed { throw Fail(message: "read failed: \(reader.error?.localizedDescription ?? "unknown")") }
  return n
}

func probe(_ path: String) async throws {
  let asset = AVURLAsset(url: URL(fileURLWithPath: path))
  let tracks = try await asset.load(.tracks)
  let duration = try await asset.load(.duration)
  var rows: [[String: Any]] = []
  for track in tracks {
    let range = try await track.load(.timeRange)
    var row: [String: Any] = [
      "trackId": Int(track.trackID),
      "mediaType": track.mediaType.rawValue,
      "codecs": try await codecs(track),
      "durationSeconds": CMTimeGetSeconds(range.duration),
      "samples": try sampleCount(asset: asset, track: track),
    ]
    if track.mediaType == .video {
      let size = try await track.load(.naturalSize)
      let fps = try await track.load(.nominalFrameRate)
      row["width"] = Int(size.width)
      row["height"] = Int(size.height)
      row["nominalFrameRate"] = Double(fps)
    }
    rows.append(row)
  }
  emit(["durationSeconds": CMTimeGetSeconds(duration), "tracks": rows])
}

func strip(_ input: String, _ outputPath: String) async throws {
  let outURL = URL(fileURLWithPath: outputPath)
  if FileManager.default.fileExists(atPath: outputPath) { throw Fail(message: "the output exists; it is never overwritten") }
  let asset = AVURLAsset(url: URL(fileURLWithPath: input))
  let tracks = try await asset.load(.tracks)
  let kept = tracks.filter { $0.mediaType != .audio }
  guard kept.contains(where: { $0.mediaType == .video }) else { throw Fail(message: "the clip has no video track") }

  let reader = try AVAssetReader(asset: asset)
  let writer = try AVAssetWriter(outputURL: outURL, fileType: .mov)
  writer.shouldOptimizeForNetworkUse = false
  writer.metadata = try await asset.load(.metadata)

  var pairs: [(AVAssetTrack, AVAssetReaderTrackOutput, AVAssetWriterInput)] = []
  var inputByTrack: [CMPersistentTrackID: AVAssetWriterInput] = [:]
  for track in kept {
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else { throw Fail(message: "reader cannot add track \(track.trackID)") }
    reader.add(output)
    let hint = try await track.load(.formatDescriptions).first
    let input = AVAssetWriterInput(mediaType: track.mediaType, outputSettings: nil, sourceFormatHint: hint)
    input.expectsMediaDataInRealTime = false
    input.transform = try await track.load(.preferredTransform)
    input.metadata = try await track.load(.metadata)
    input.languageCode = try await track.load(.languageCode)
    guard writer.canAdd(input) else { throw Fail(message: "writer cannot add a \(track.mediaType.rawValue) track") }
    writer.add(input)
    pairs.append((track, output, input))
    inputByTrack[track.trackID] = input
  }
  // Keep the metadata tracks' links to the track they describe (`cdsc`), when the writer allows it.
  var associations = 0
  for (track, _, input) in pairs where track.mediaType == .metadata {
    for type in try await track.load(.availableTrackAssociationTypes) {
      for target in try await track.loadAssociatedTracks(ofType: type) {
        if let targetInput = inputByTrack[target.trackID], input.canAddTrackAssociation(withTrackOf: targetInput, type: type.rawValue) {
          input.addTrackAssociation(withTrackOf: targetInput, type: type.rawValue)
          associations += 1
        }
      }
    }
  }

  guard reader.startReading() else { throw Fail(message: "reader did not start: \(reader.error?.localizedDescription ?? "unknown")") }
  guard writer.startWriting() else { throw Fail(message: "writer did not start: \(writer.error?.localizedDescription ?? "unknown")") }
  writer.startSession(atSourceTime: .zero)

  let queue = DispatchQueue(label: "strip-audio")
  let group = DispatchGroup()
  final class Counter: @unchecked Sendable { var samples = 0 }
  var counts: [(AVAssetTrack, Counter)] = []
  for (track, output, input) in pairs {
    let counter = Counter()
    counts.append((track, counter))
    group.enter()
    input.requestMediaDataWhenReady(on: queue) {
      while input.isReadyForMoreMediaData {
        guard let buffer = output.copyNextSampleBuffer() else {
          input.markAsFinished()
          group.leave()
          return
        }
        counter.samples += CMSampleBufferGetNumSamples(buffer)
        if !input.append(buffer) {
          reader.cancelReading()
          input.markAsFinished()
          group.leave()
          return
        }
      }
    }
  }
  await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in group.notify(queue: queue) { c.resume() } }
  if reader.status == .failed { throw Fail(message: "read failed: \(reader.error?.localizedDescription ?? "unknown")") }
  await writer.finishWriting()
  if writer.status != .completed { throw Fail(message: "write failed: \(writer.error?.localizedDescription ?? "unknown")") }
  emit([
    "dropped": tracks.filter { $0.mediaType == .audio }.map { Int($0.trackID) },
    "associations": associations,
    "copied": counts.map { ["trackId": Int($0.0.trackID), "mediaType": $0.0.mediaType.rawValue, "samples": $0.1.samples] as [String: Any] },
  ])
}

let args = CommandLine.arguments
do {
  switch (args.count, args.count > 1 ? args[1] : "") {
  case (3, "probe"): try await probe(args[2])
  case (4, "strip"): try await strip(args[2], args[3])
  default:
    FileHandle.standardError.write("usage: strip-audio.swift probe <clip> | strip <clip> <out.mov>\n".data(using: .utf8)!)
    exit(2)
  }
} catch let e as Fail {
  FileHandle.standardError.write("strip-audio: \(e.message)\n".data(using: .utf8)!)
  exit(1)
} catch {
  FileHandle.standardError.write("strip-audio: \(error.localizedDescription)\n".data(using: .utf8)!)
  exit(1)
}
