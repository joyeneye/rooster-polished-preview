import AVFoundation
import SwiftUI
import WebKit

/// Review Room audio is served whole, with no byte ranges (review-room.mts:267), so the app
/// downloads the file with the member's session and plays it from disk. Once a file is down the
/// player also knows its length and reads its real loudness for the waveform.
@MainActor
final class TrackPlayer: ObservableObject {
    @Published private(set) var playingID: String?
    @Published private(set) var loadingID: String?
    /// The track whose audio couldn't be fetched, so the card can say so.
    @Published private(set) var failedID: String?
    /// The track loaded into the player, and where it is.
    @Published private(set) var loadedID: String?
    @Published private(set) var elapsed: Double = 0
    @Published private(set) var duration: Double = 0
    /// Loudness per bar, 0...1, read from each downloaded file.
    @Published private(set) var peaks: [String: [Float]] = [:]

    static let bars = 72

    private var player: AVPlayer?
    private var files: [String: URL] = [:]
    private var ticker: Any?
    private var ending: NSObjectProtocol?

    var progress: Double { duration > 0 ? min(1, elapsed / duration) : 0 }

    /// Downloads and loads a track without playing it, so its length and waveform can show.
    @discardableResult
    func prepare(id: String, url: URL) async -> Bool {
        if loadedID == id { return true }
        guard let file = await download(id: id, url: url) else { return false }
        await load(id: id, file: file)
        return true
    }

    func toggle(id: String, url: URL) async {
        if playingID == id {
            player?.pause()
            playingID = nil
            return
        }
        guard await prepare(id: id, url: url), loadedID == id else { return }
        if duration > 0, elapsed >= duration - 0.25 { seek(id: id, to: 0) }
        player?.play()
        playingID = id
    }

    /// Jumps to a fraction of the loaded track.
    func seek(id: String, to fraction: Double) {
        guard loadedID == id, duration > 0, let player else { return }
        let seconds = max(0, min(duration, fraction * duration))
        elapsed = seconds
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    func stop() {
        player?.pause()
        playingID = nil
    }

    // MARK: Loading

    private func download(id: String, url: URL) async -> URL? {
        if let file = files[id] { return file }
        loadingID = id
        failedID = nil
        defer { loadingID = nil }
        #if DEBUG
        if url.scheme == "fixture",
           let file = await Task.detached(priority: .userInitiated, operation: { ReviewRoomFixtures.audioFile() }).value {
            files[id] = file
            return file
        }
        #endif
        var request = URLRequest(url: url, timeoutInterval: 60)
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
            .filter { $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) == url.host }
        for (field, value) in HTTPCookie.requestHeaderFields(with: cookies) { request.setValue(value, forHTTPHeaderField: field) }
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) == true else {
            failedID = id
            return nil
        }
        // The site sends the upload's own type (audio/mpeg or audio/wav); the decoder that
        // reads the waveform goes by the file's extension.
        let type = response.mimeType ?? ""
        let ext = type.contains("wav") ? "wav" : type.contains("mp4") || type.contains("m4a") || type.contains("aac") ? "m4a" : "mp3"
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("review-\(id).\(ext)")
        guard (try? data.write(to: file, options: .atomic)) != nil else {
            failedID = id
            return nil
        }
        files[id] = file
        return file
    }

    private func load(id: String, file: URL) async {
        player?.pause()
        if let ticker { player?.removeTimeObserver(ticker) }
        if let ending { NotificationCenter.default.removeObserver(ending) }
        playingID = nil

        let item = AVPlayerItem(url: file)
        let player = AVPlayer(playerItem: item)
        self.player = player
        loadedID = id
        elapsed = 0
        duration = (try? await item.asset.load(.duration)).map(CMTimeGetSeconds).flatMap { $0.isFinite ? $0 : nil } ?? 0

        ticker = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 10), queue: .main) { [weak self] time in
            MainActor.assumeIsolated {
                guard let self, self.loadedID == id else { return }
                self.elapsed = CMTimeGetSeconds(time)
            }
        }
        ending = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.loadedID == id else { return }
                self.playingID = nil
                self.elapsed = self.duration
            }
        }

        if peaks[id] == nil {
            let bars = Self.bars
            let levels = await Task.detached(priority: .utility) { Self.levels(of: file, bars: bars) }.value
            if let levels { peaks[id] = levels }
        }
    }

    /// The RMS loudness of `bars` equal slices of the file, scaled so the loudest is 1.
    nonisolated static func levels(of file: URL, bars: Int) -> [Float]? {
        guard let audio = try? AVAudioFile(forReading: file), audio.length > 0 else { return nil }
        let slice = AVAudioFrameCount(max(1, audio.length / AVAudioFramePosition(bars)))
        guard let buffer = AVAudioPCMBuffer(pcmFormat: audio.processingFormat, frameCapacity: slice) else { return nil }
        var levels: [Float] = []
        levels.reserveCapacity(bars)
        for _ in 0..<bars {
            guard (try? audio.read(into: buffer, frameCount: slice)) != nil, buffer.frameLength > 0,
                  let samples = buffer.floatChannelData?[0] else { break }
            let count = Int(buffer.frameLength)
            var sum: Float = 0
            var index = 0
            while index < count {
                sum += samples[index] * samples[index]
                index += 4
            }
            levels.append((sum / Float((count + 3) / 4)).squareRoot())
        }
        guard let loudest = levels.max(), loudest > 0 else { return nil }
        return levels.map { $0 / loudest }
    }
}
