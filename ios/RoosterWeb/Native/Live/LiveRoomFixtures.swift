#if DEBUG
import Foundation

/// A made-up live room for headless captures (`-RoosterFixtures -RoosterScreen live`). The model
/// shows it without joining, polling, signalling or opening a microphone.
enum LiveRoomFixtures {
    static let key = "fixture-room"
    private static let host = "fixture-host"

    /// The host is mid-sentence; nobody else is audible.
    static let levels: [String: Double] = [host: 0.62]

    /// `-RoosterLiveAs host` shows the room as its host would see it.
    static var asHost: Bool { UserDefaults.standard.string(forKey: "RoosterLiveAs") == "host" }
    /// `-RoosterLiveTray 1` opens the reactions tray.
    static var opensTray: Bool { NativeFixtures.enabled && UserDefaults.standard.string(forKey: "RoosterLiveTray") == "1" }

    static func state(for key: String) -> LiveState? {
        guard NativeFixtures.enabled, key == Self.key else { return nil }
        let isHost = asHost
        let hostYou = #"{"member_id": "fixture-host", "name": "Nia Carter", "photo_url": "/assets/slots-ads/hair-v1.jpg", "role": "host", "hand_raised": false, "muted": false, "is_host": true, "is_you": true, "is_moderator": false}"#
        let listenerYou = #"{"member_id": "fixture-l13", "name": "Ivy Stone", "photo_url": null, "role": "listener", "hand_raised": false, "muted": true, "is_host": false, "is_you": true, "is_moderator": false}"#
        let now = Date()
        func stamp(_ minutesAgo: Double) -> String {
            ISO8601DateFormatter().string(from: now.addingTimeInterval(-minutesAgo * 60))
        }
        let listeners = [
            ("Kev Beats", "/assets/slots-ads/fashion-v1.jpg"), ("Luna Grant", "/assets/slots-ads/podcast-v1.jpg"),
            ("Jules Park", nil), ("Dariush Vale", "/assets/slots-ads/sports-v1.jpg"), ("Soul Kid", nil),
            ("Tee Monroe", "/assets/slots-ads/hair-v1.jpg"), ("Ari Lane", nil), ("Bo Carter", "/assets/slots-ads/barber-v1.jpg"),
            ("Cee Wallace", nil), ("Dee Knox", nil), ("Eli Brooks", nil), ("Fay Moss", nil), ("Gus Hale", nil), ("Ivy Stone", nil),
        ]
        let listenerJSON = listeners.enumerated().map { index, person in
            let photo = person.1.map { "\"\($0)\"" } ?? "null"
            let hand = index == 2 ? "true" : "false"
            return """
            {"member_id": "fixture-l\(index)", "name": "\(person.0)", "photo_url": \(photo), "role": "listener", "hand_raised": \(hand), "muted": true, "is_host": false, "is_you": \(!isHost && index == 13), "is_moderator": false}
            """
        }.joined(separator: ",\n")
        let json = """
        {"room": {"key": "\(Self.key)", "title": "Late-night session: finishing the hook", "description": "", "medium": "audio",
                  "host_id": "\(host)", "host_name": "Nia Carter", "host_photo_url": "/assets/slots-ads/hair-v1.jpg",
                  "listener_count": \(listeners.count), "speaker_count": 4, "participant_count": \(listeners.count + 4)},
         "you": \(isHost ? hostYou : listenerYou),
         "participants": [
          {"member_id": "\(host)", "name": "Nia Carter", "photo_url": "/assets/slots-ads/hair-v1.jpg", "role": "host", "hand_raised": false, "muted": false, "is_host": true, "is_you": \(isHost), "is_moderator": false},
          {"member_id": "fixture-s1", "name": "Tasha Monroe", "photo_url": "/assets/slots-ads/podcast-v1.jpg", "role": "speaker", "hand_raised": false, "muted": true, "is_host": false, "is_you": false, "is_moderator": true},
          {"member_id": "fixture-s2", "name": "Dre Wallace", "photo_url": "/assets/slots-ads/barber-v1.jpg", "role": "speaker", "hand_raised": false, "muted": true, "is_host": false, "is_you": false, "is_moderator": false},
          {"member_id": "fixture-s3", "name": "Marcus Lane", "photo_url": "/photos/always-the-music.jpg", "role": "speaker", "hand_raised": false, "muted": true, "is_host": false, "is_you": false, "is_moderator": false},
          \(listenerJSON)],
         "messages": [
          {"id": 1, "member_id": "fixture-l0", "name": "Kev Beats", "photo_url": "/assets/slots-ads/fashion-v1.jpg", "body": "This is crazy. Nia always brings the energy", "created_at": "\(stamp(6))", "is_you": false},
          {"id": 2, "member_id": "fixture-l1", "name": "Luna Grant", "photo_url": "/assets/slots-ads/podcast-v1.jpg", "body": "That vocal chain is so clean. What are you using?", "created_at": "\(stamp(5))", "is_you": false},
          {"id": 3, "member_id": "fixture-l2", "name": "Jules Park", "photo_url": null, "body": "Love this room. Real talk, real feedback.", "created_at": "\(stamp(4))", "is_you": false},
          {"id": 4, "member_id": "fixture-l3", "name": "Dariush Vale", "photo_url": "/assets/slots-ads/sports-v1.jpg", "body": "The new one you played at the end. Run it back", "created_at": "\(stamp(2))", "is_you": false},
          {"id": 5, "member_id": "fixture-l4", "name": "Soul Kid", "photo_url": null, "body": "A legend in the making.", "created_at": "\(stamp(1))", "is_you": false}],
         "signals": [], "member_id": "\(isHost ? "fixture-host" : "fixture-l13")", "ice_servers": []}
        """
        return try? FeedAPI.decoder.decode(LiveState.self, from: Data(json.utf8))
    }
}
#endif
