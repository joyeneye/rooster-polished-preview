import Foundation

/// What /api/live/room returns for join and sync (roster-live.mts:302-356).
struct LiveState: Decodable {
    struct Participant: Decodable, Hashable, Identifiable {
        let memberId: String
        let name: String
        let photoUrl: String?
        let role: String
        let handRaised: Bool?
        let muted: Bool?
        let isHost: Bool?
        let isYou: Bool?
        let isModerator: Bool?
        var id: String { memberId }
        var isListener: Bool { role == "listener" }
        var isSpeaker: Bool { role == "speaker" || role == "host" }
    }

    struct Message: Decodable, Hashable, Identifiable {
        let id: Int
        let memberId: String
        let name: String
        let photoUrl: String?
        let body: String
        let createdAt: String
        let isYou: Bool?
    }

    struct Signal: Decodable {
        let fromId: String
        let kind: String
        let payload: JSONValue
    }

    let room: LiveRooms.Room
    let you: Participant?
    let participants: [Participant]
    let messages: [Message]
    let signals: [Signal]?
    let memberId: String?
    let iceServers: [IceServer]?
}

/// The STUN and TURN servers the site hands out (roster-live.mts:629-640).
struct IceServer: Decodable, Hashable {
    let urls: [String]
    let username: String?
    let credential: String?

    private enum CodingKeys: String, CodingKey { case urls, username, credential }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let one = try? container.decode(String.self, forKey: .urls) {
            urls = [one]
        } else {
            urls = (try? container.decode([String].self, forKey: .urls)) ?? []
        }
        username = try? container.decodeIfPresent(String.self, forKey: .username)
        credential = try? container.decodeIfPresent(String.self, forKey: .credential)
    }
}

/// One signal to send: {to_id, kind, payload} (roster-live.mts:593-622).
struct OutgoingSignal {
    let toId: String
    let kind: String
    let payload: [String: Any]

    var body: [String: Any] { ["to_id": toId, "kind": kind, "payload": payload] }
}
