#if DEBUG
import Foundation

/// A made-up Review Room for headless captures (`-RoosterFixtures -RoosterScreen review`), seen
/// as the room's admin so the scoring layout shows. Nothing here is compiled into a release build.
///
/// - `-RoosterReviewOpen 1` opens the first queue track with a draft started; `2`, `3` open the
///   others as they are; `yours` opens your reviewed submission.
/// - `-RoosterReviewScroll feedback` scrolls the open track down to its feedback.
/// - `-RoosterReviewSubmit 1` opens the submit sheet.
enum ReviewRoomFixtures {
    private static func flag(_ name: String) -> String? {
        NativeFixtures.enabled ? UserDefaults.standard.string(forKey: name) : nil
    }

    static var openRequest: String? { flag("RoosterReviewOpen") }
    static var opensFirstTrack: Bool { openRequest == "1" }
    static var scrollsToFeedback: Bool { flag("RoosterReviewScroll") == "feedback" }
    static var opensSubmit: Bool { flag("RoosterReviewSubmit") == "1" }

    static func track(to open: ReviewRoom) -> ReviewRoom.Track? {
        guard let request = openRequest else { return nil }
        if request == "yours" { return open.submissions.first }
        guard let index = Int(request), open.queue.indices.contains(index - 1) else { return nil }
        return open.queue[index - 1]
    }

    static func dashboard() -> ReviewRoom? {
        guard NativeFixtures.enabled else { return nil }
        return try? FeedAPI.decoder.decode(ReviewRoom.self, from: Data("""
        {"workspace": {"slug": "jwhite", "name": "J.White's Review Room", "bio": "Send a record. Get honest feedback."},
         "permissions": {"reviewer": true, "admin": true},
         "stats": {"waiting": 3, "reviewed": 12, "revenue_cents": 42500, "pending_cents": 2500},
         "tiers": [{"code": "free", "name": "Free lane", "description": "When there's room.", "price_cents": 0, "priority_weight": 1, "active": true},
                   {"code": "priority", "name": "Priority", "description": "Front of the queue this week.", "price_cents": 2500, "priority_weight": 5, "active": true}],
         "queue": [
           {"id": 21, "public_id": "fq1", "artist_name": "Nia Carter", "title": "Late Checkout", "genre": "R&B", "mood": "Late-night", "tags": ["Vocals"],
            "song_info": "The harmony stack in the second chorus is the part I'm proudest of.", "tier_code": "priority", "status": "waiting", "source_type": "upload",
            "audio_url": "fixture://late-checkout", "featured": true, "queue_status": "waiting", "queue_position": 1, "created_at": "2026-09-15T12:00:00Z"},
           {"id": 22, "public_id": "fq2", "artist_name": "Dre Wallace", "title": "No Hook Needed", "genre": "Hip-Hop", "mood": "Gritty", "tier_code": "free", "status": "waiting",
            "source_type": "link", "source_url": "https://open.spotify.com/track/1", "audio_url": "", "queue_status": "waiting", "queue_position": 2, "created_at": "2026-09-14T12:00:00Z"},
           {"id": 23, "public_id": "fq3", "artist_name": "Tasha Monroe", "title": "Southside Summer", "genre": "Pop", "mood": "Bright", "tier_code": "free", "status": "waiting",
            "source_type": "upload", "audio_url": "fixture://southside", "queue_status": "waiting", "queue_position": 3, "created_at": "2026-09-13T12:00:00Z"}],
         "submissions": [
           {"id": 13, "public_id": "s1", "room_name": "J.White's Review Room", "artist_name": "You", "title": "City Lights", "genre": "Hip-Hop", "mood": "Hungry", "tier_code": "free",
            "status": "reviewed", "source_type": "upload", "audio_url": "fixture://city-lights", "song_info": "Listen to the second verse.", "created_at": "2026-09-02T12:00:00Z",
            "review": {"overall_score": 8, "scores": {"songwriting": 8, "production": 7, "originality": 9, "replay": 8},
                       "feedback": "The verse writing is the strongest part. Tighten the mix on the low end and this is ready.",
                       "visibility": "private", "decision": "approved", "published_at": "2026-09-06T12:00:00Z"}}]}
        """.utf8))
    }

    /// The draft a capture opens with.
    static let draft = (scores: [8, 9, 7, 8],
                        feedback: "Really strong vocal and a great late-night feel. The mix is clean; the drums and keys sit well together. Push the hook harder in the last chorus.")

    /// A synthesised 2:52 WAV standing in for an upload: quiet intro, verses, loud choruses, fade.
    /// Written once to the temporary folder.
    static func audioFile() -> URL? {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("review-fixture.wav")
        if FileManager.default.fileExists(atPath: file.path) { return file }
        let rate = 8000, seconds = 172
        let count = rate * seconds
        var samples = [Int16](repeating: 0, count: count)
        let sections: [(until: Double, level: Double)] = [(12, 0.25), (50, 0.55), (78, 0.95), (108, 0.6), (140, 1), (158, 0.5), (172, 0.15)]
        for index in 0..<count {
            let t = Double(index) / Double(rate)
            let level = sections.first { t < $0.until }?.level ?? 0.1
            let beat = t.truncatingRemainder(dividingBy: 0.5)
            let kick = sin(2 * .pi * 55 * beat) * exp(-beat * 18)
            let pad = 0.35 * sin(2 * .pi * 220 * t) + 0.25 * sin(2 * .pi * 277 * t) + 0.2 * sin(2 * .pi * 330 * t)
            let swell = 0.75 + 0.25 * sin(2 * .pi * t / 7)
            samples[index] = Int16(max(-1, min(1, level * swell * (0.6 * kick + 0.4 * pad))) * 30000)
        }
        var data = Data()
        func append<T: FixedWidthInteger>(_ value: T) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
        data.append(contentsOf: Array("RIFF".utf8)); append(UInt32(36 + count * 2))
        data.append(contentsOf: Array("WAVEfmt ".utf8)); append(UInt32(16)); append(UInt16(1)); append(UInt16(1))
        append(UInt32(rate)); append(UInt32(rate * 2)); append(UInt16(2)); append(UInt16(16))
        data.append(contentsOf: Array("data".utf8)); append(UInt32(count * 2))
        samples.withUnsafeBytes { data.append(contentsOf: $0) }
        return (try? data.write(to: file, options: .atomic)) != nil ? file : nil
    }
}
#endif
