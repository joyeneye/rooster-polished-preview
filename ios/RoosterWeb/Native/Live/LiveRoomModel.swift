import AVFoundation
import SwiftUI
import WebRTC

/// A live room the app is in: the state from /api/live/room, and the peer connections that carry
/// the audio and video.
@MainActor
final class LiveRoomModel: ObservableObject {
    enum Phase: Equatable {
        case joining
        case joined
        case ended(String)
        case failed(String)
    }

    @Published private(set) var phase: Phase = .joining
    @Published private(set) var room: LiveRooms.Room?
    @Published private(set) var you: LiveState.Participant?
    @Published private(set) var participants: [LiveState.Participant] = []
    @Published private(set) var messages: [LiveState.Message] = []
    @Published private(set) var remoteVideo: [String: RTCVideoTrack] = [:]
    @Published private(set) var micAllowed = false
    @Published var sending = false
    /// How loud each member is, 0...1, smoothed; read from the connections every 400ms.
    @Published private(set) var levels: [String: Double] = [:]
    /// The loudest unmuted speaker right now, if anybody is talking.
    @Published private(set) var activeSpeakerID: String?
    /// Reactions drifting up the right edge: yours as you send them, other people's as their
    /// emoji-only comments arrive.
    @Published private(set) var floaters: [Floater] = []

    struct Floater: Identifiable, Equatable {
        let id = UUID()
        let emoji: String
        /// 0...1, where across the lane it starts, so a burst doesn't stack in one column.
        let lane: Double
    }

    /// The reactions offered from the control bar. There is no reactions endpoint; a reaction is
    /// an emoji-only comment, which is what a browser member sends by typing one.
    static let reactions = ["❤️", "🔥", "👏", "💯", "🙌"]

    let key: String
    private let api: FeedAPI
    private let peers = LivePeers()
    /// One session per join, like the browser's (roster-live.js:77-82).
    private let session = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(24).description
    private var poll: Task<Void, Never>?
    private var outgoing: [OutgoingSignal] = []
    private var flush: Task<Void, Never>?
    private var myID = ""
    private var meter: Task<Void, Never>?
    private var seenMessages: Set<Int> = []
    private var left = false
    #if DEBUG
    private var isFixture = false
    #endif

    init(key: String, api: FeedAPI) {
        self.key = key
        self.api = api
        peers.onSignal = { [weak self] signal in self?.queue(signal) }
        peers.onRemoteVideo = { [weak self] id, track in
            guard let self else { return }
            if let track { remoteVideo[id] = track } else { remoteVideo[id] = nil }
        }
    }

    var speakers: [LiveState.Participant] { participants.filter(\.isSpeaker) }
    var listeners: [LiveState.Participant] { participants.filter(\.isListener) }
    var isVideoRoom: Bool { room?.isVideo == true }
    var canSpeak: Bool { you?.isSpeaker == true }

    // MARK: Joining

    func join() async {
        guard phase == .joining else { return }
        #if DEBUG
        if let fixture = LiveRoomFixtures.state(for: key) {
            isFixture = true
            room = fixture.room
            you = fixture.you
            participants = fixture.participants
            messages = fixture.messages
            seenMessages = Set(fixture.messages.map(\.id))
            levels = LiveRoomFixtures.levels
            activeSpeakerID = LiveRoomFixtures.levels.max { $0.value < $1.value }?.key
            phase = .joined
            meter = Task { [weak self] in
                // Stand-in for other members' reactions arriving, so a capture shows the lane.
                while !Task.isCancelled {
                    self?.float("❤️")
                    try? await Task.sleep(for: .milliseconds(420))
                }
            }
            return
        }
        #endif
        configureAudioSession()
        do {
            let state = try await api.post("/api/live/room", body: ["action": "join", "key": key, "session": session], as: LiveState.self)
            myID = state.memberId ?? state.you?.memberId ?? ""
            peers.configure(myID: myID, isVideoRoom: state.room.isVideo, iceServers: state.iceServers ?? [])
            seenMessages = Set(state.messages.map(\.id))
            apply(state)
            phase = .joined
            left = false
            startPolling()
            startMetering()
        } catch let error as FeedError {
            phase = .failed(error.message)
        } catch {
            phase = .failed("ROOSTER could not open that room.")
        }
    }

    func leave() {
        left = true
        meter?.cancel()
        meter = nil
        #if DEBUG
        if isFixture { return }
        #endif
        poll?.cancel()
        poll = nil
        flush?.cancel()
        peers.closeAll()
        remoteVideo = [:]
        let api = api, key = key, session = session
        Task.detached {
            struct Ignored: Decodable {}
            _ = try? await api.post("/api/live/room", body: ["action": "leave", "key": key, "session": session], as: Ignored.self)
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// Leaving happens when the room goes off screen, and that includes a profile pushed on top
    /// of it. Coming back to a room we left while it was open joins it again.
    func prepareToRejoin() {
        guard left, phase == .joined else { return }
        #if DEBUG
        if isFixture { return }
        #endif
        left = false
        levels = [:]
        activeSpeakerID = nil
        phase = .joining
    }

    /// Reads everybody's audio level a few times a second for the speaking ring.
    private func startMetering() {
        meter = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(400))
                guard let self, !Task.isCancelled else { return }
                let fresh = await peers.audioLevels()
                var smoothed: [String: Double] = [:]
                for id in Set(fresh.keys).union(levels.keys) {
                    // Rise at once, fall away slowly, so the ring doesn't flicker between words.
                    let level = max(fresh[id] ?? 0, (levels[id] ?? 0) * 0.55)
                    if level > 0.005 { smoothed[id] = level }
                }
                levels = smoothed
                let talking = speakers.filter { $0.muted != true }
                    .compactMap { person in smoothed[person.memberId].map { (person.memberId, $0) } }
                    .filter { $0.1 > 0.04 }
                    .max { $0.1 < $1.1 }
                activeSpeakerID = talking?.0
            }
        }
    }

    /// The room is a 2.5s poll: a heartbeat, the room state and any signals waiting for us
    /// (roster-live.js:33, 920-948).
    private func startPolling() {
        poll = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(2500))
                guard let self, !Task.isCancelled else { return }
                await sync()
            }
        }
    }

    private func sync() async {
        do {
            let state = try await api.post("/api/live/room", body: ["action": "sync", "key": key, "session": session], as: LiveState.self)
            apply(state)
        } catch let error as FeedError {
            // 404, 409 and 403 mean the room ended, somebody else took this seat, or we were removed.
            if case .locked(let message) = error {
                phase = .ended(message)
                leave()
            } else if error.message.localizedCaseInsensitiveContains("room") {
                phase = .ended(error.message)
                leave()
            }
        } catch {}
    }

    private func apply(_ state: LiveState) {
        room = state.room
        you = state.you
        participants = state.participants
        messages = state.messages
        for message in state.messages where !seenMessages.contains(message.id) {
            seenMessages.insert(message.id)
            if message.isYou != true, let emoji = Self.reaction(in: message.body) { float(emoji) }
        }
        if state.you?.isSpeaker == true {
            peers.startMicrophone()
            peers.setMicrophone(enabled: state.you?.muted != true)
            if state.room.isVideo { peers.startCamera() }
        } else {
            peers.setMicrophone(enabled: false)
        }
        peers.reconcile(participants: state.participants, meIsListener: state.you?.isListener ?? true)
        for signal in state.signals ?? [] {
            Task { await peers.receive(signal) }
        }
    }

    // MARK: Actions

    func raiseHand(_ raised: Bool) async {
        await act(["action": "hand", "key": key, "raised": raised])
        if raised { await requestMicrophone() }
    }

    func setMuted(_ muted: Bool) async {
        await act(["action": "mute", "key": key, "muted": muted])
        peers.setMicrophone(enabled: !muted)
    }

    /// Sends a reaction as a comment and floats it straight away.
    func react(_ emoji: String) async {
        float(emoji)
        await say(emoji)
    }

    private func float(_ emoji: String) {
        let floater = Floater(emoji: emoji, lane: Double.random(in: 0...1))
        floaters.append(floater)
        if floaters.count > 24 { floaters.removeFirst(floaters.count - 24) }
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(3.2))
            self?.floaters.removeAll { $0.id == floater.id }
        }
    }

    /// A comment that is nothing but one to three emoji counts as a reaction.
    static func reaction(in body: String) -> String? {
        let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 3,
              text.allSatisfy({ $0.unicodeScalars.first?.properties.isEmojiPresentation == true
                  || $0.unicodeScalars.count > 1 && $0.unicodeScalars.first?.properties.isEmoji == true }) else { return nil }
        return String(text.first!)
    }

    /// The room's public link, the same one the site's invite button shares (roster-live.js:1235).
    func shareURL(base: URL) -> URL? {
        guard var parts = URLComponents(url: base.appendingPathComponent("live.html"), resolvingAgainstBaseURL: false) else { return nil }
        var query = [URLQueryItem(name: "room", value: key)]
        if room?.isVideo != true { query.append(URLQueryItem(name: "medium", value: "audio")) }
        parts.queryItems = query
        return parts.url
    }

    func say(_ body: String) async {
        let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        sending = true
        defer { sending = false }
        await act(["action": "say", "key": key, "body": String(text.prefix(400))])
    }

    /// Host tools: approve a speaker, mute one, move somebody back to listening, end the room.
    func host(_ action: String, member: String? = nil, message: Int? = nil) async {
        var body: [String: Any] = ["action": "host", "key": key, "host_action": action]
        if let member { body["member_id"] = member }
        if let message { body["message_id"] = message }
        await act(body)
    }

    private func act(_ body: [String: Any]) async {
        #if DEBUG
        if isFixture { return }
        #endif
        guard let state = try? await api.post("/api/live/room", body: body, as: LiveState.self) else { return }
        apply(state)
    }

    // MARK: Signals

    /// Outgoing offers, answers and candidates, batched like the browser (≤20, 220ms).
    private func queue(_ signal: OutgoingSignal) {
        outgoing.append(signal)
        guard flush == nil else { return }
        flush = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(220))
            await self?.send()
        }
    }

    private func send() async {
        flush = nil
        while !outgoing.isEmpty {
            let batch = Array(outgoing.prefix(20))
            outgoing.removeFirst(batch.count)
            struct Ignored: Decodable {}
            _ = try? await api.post("/api/live/signal",
                                    body: ["key": key, "session": session, "signals": batch.map(\.body)],
                                    as: Ignored.self)
        }
    }

    // MARK: Audio

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try? session.setActive(true)
    }

    func requestMicrophone() async {
        micAllowed = await AVAudioApplication.requestRecordPermission()
        if micAllowed { peers.startMicrophone() }
    }

    var localVideo: RTCVideoTrack? { peers.localVideo }
}
