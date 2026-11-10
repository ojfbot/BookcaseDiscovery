// Test helper (NS-K): a tiny synthetic clip, `swift make-clip.swift <out.mov> <frames> <fps> <sharp,frame,list> [audio]`.
// H.264 video, 128x96; every frame is flat grey except the listed ones, which are a fine checkerboard (the sharpest
// frames). With `audio`, an AAC track of silence is added. No camera metadata; the test writes it with exiftool.
import AVFoundation
import CoreVideo
import Foundation

let a = CommandLine.arguments
let out = URL(fileURLWithPath: a[1])
let frames = Int(a[2])!
let fps = Int32(a[3])!
let sharp = Set(a[4].split(separator: ",").compactMap { Int($0) })
let withAudio = a.count > 5 && a[5] == "audio"
let (w, h) = (128, 96)

let writer = try! AVAssetWriter(outputURL: out, fileType: .mov)
let video = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: w, AVVideoHeightKey: h])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: video, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: w, kCVPixelBufferHeightKey as String: h])
video.expectsMediaDataInRealTime = true
writer.add(video)
let rate = 44_100.0
let audio = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: rate, AVNumberOfChannelsKey: 1])
audio.expectsMediaDataInRealTime = true
if withAudio { writer.add(audio) }
writer.startWriting()
writer.startSession(atSourceTime: .zero)

var asbd = AudioStreamBasicDescription(mSampleRate: rate, mFormatID: kAudioFormatLinearPCM, mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked, mBytesPerPacket: 2, mFramesPerPacket: 1, mBytesPerFrame: 2, mChannelsPerFrame: 1, mBitsPerChannel: 16, mReserved: 0)
var format: CMAudioFormatDescription?
CMAudioFormatDescriptionCreate(allocator: nil, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &format)

/// Wait (bounded) until an input takes more data: the writer interleaves, so video and audio go in turn.
func ready(_ input: AVAssetWriterInput) {
  var waited = 0
  while !input.isReadyForMoreMediaData {
    usleep(1000)
    waited += 1
    if writer.status == .failed { FileHandle.standardError.write("make-clip: \(writer.error?.localizedDescription ?? "failed")\n".data(using: .utf8)!); exit(1) }
    if waited > 10_000 { FileHandle.standardError.write("make-clip: writer stalled\n".data(using: .utf8)!); exit(1) }
  }
}

/// Silence for the audio samples [from, to).
func appendSilence(_ from: Int, _ to: Int) {
  guard to > from else { return }
  let n = to - from
  var block: CMBlockBuffer?
  CMBlockBufferCreateWithMemoryBlock(allocator: nil, memoryBlock: nil, blockLength: n * 2, blockAllocator: nil, customBlockSource: nil, offsetToData: 0, dataLength: n * 2, flags: kCMBlockBufferAssureMemoryNowFlag, blockBufferOut: &block)
  CMBlockBufferFillDataBytes(with: 0, blockBuffer: block!, offsetIntoDestination: 0, dataLength: n * 2)
  var sample: CMSampleBuffer?
  CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: nil, dataBuffer: block!, formatDescription: format!, sampleCount: n, presentationTimeStamp: CMTime(value: CMTimeValue(from), timescale: CMTimeScale(rate)), packetDescriptions: nil, sampleBufferOut: &sample)
  ready(audio)
  if !audio.append(sample!) { FileHandle.standardError.write("make-clip: audio append: \(writer.error?.localizedDescription ?? "refused")\n".data(using: .utf8)!); exit(1) }
}

let perFrame = Int(rate) / Int(fps)
for i in 0..<frames {
  ready(video)
  var pb: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pb)
  let buf = pb!
  CVPixelBufferLockBaseAddress(buf, [])
  let base = CVPixelBufferGetBaseAddress(buf)!.assumingMemoryBound(to: UInt8.self)
  let row = CVPixelBufferGetBytesPerRow(buf)
  for y in 0..<h {
    for x in 0..<w {
      let v: UInt8 = sharp.contains(i) ? (((x / 2) + (y / 2)) % 2 == 0 ? 255 : 0) : 128
      let p = base + y * row + x * 4
      p[0] = v; p[1] = v; p[2] = v; p[3] = 255
    }
  }
  CVPixelBufferUnlockBaseAddress(buf, [])
  adaptor.append(buf, withPresentationTime: CMTime(value: CMTimeValue(i), timescale: fps))
  if withAudio { appendSilence(i * perFrame, (i + 1) * perFrame) }
}
video.markAsFinished()
if withAudio { audio.markAsFinished() }

let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
if writer.status != .completed { FileHandle.standardError.write("make-clip: \(writer.error?.localizedDescription ?? "failed")\n".data(using: .utf8)!); exit(1) }
