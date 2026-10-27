import Foundation
import ImageIO
import Vision

struct RecognizedLine: Codable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct RecognizedPoster: Codable {
    let path: String
    let text: String
    let lines: [RecognizedLine]
    let error: String?
}

func recognize(path: String) -> RecognizedPoster {
    let url = URL(fileURLWithPath: path)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        return RecognizedPoster(path: path, text: "", lines: [], error: "unable to decode image")
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.minimumTextHeight = 0.005
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "ja-JP", "ko-KR", "en-US"]

    do {
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        try handler.perform([request])
    } catch {
        return RecognizedPoster(path: path, text: "", lines: [], error: error.localizedDescription)
    }

    let observations = request.results ?? []
    let lines = observations.compactMap { observation -> RecognizedLine? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return RecognizedLine(
            text: candidate.string,
            confidence: candidate.confidence,
            x: Double(box.origin.x),
            y: Double(box.origin.y),
            width: Double(box.size.width),
            height: Double(box.size.height)
        )
    }
    return RecognizedPoster(
        path: path,
        text: lines.map(\.text).joined(separator: "\n"),
        lines: lines,
        error: nil
    )
}

let paths = Array(CommandLine.arguments.dropFirst())
guard !paths.isEmpty else {
    FileHandle.standardError.write(Data("usage: ocr-posters.swift <image>...\n".utf8))
    exit(2)
}

let results = paths.map(recognize)
let data = try JSONEncoder().encode(results)
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
