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

    let key: String
    private let api: FeedAPI
    private let peers = LivePeers()
    /// One session per join, like the browser's (roster-live.js:77-82).
    private let session = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(24).description
    private var poll: Task<Void, Never>?
    private var outgoing: [OutgoingSignal] = []
    private var flush: Task<Void, Never>?
    private var myID = ""

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
        configureAudioSession()
        do {
            let state = try await api.post("/api/live/room", body: ["action": "join", "key": key, "session": session], as: LiveState.self)
            myID = state.memberId ?? state.you?.memberId ?? ""
            peers.configure(myID: myID, isVideoRoom: state.room.isVideo, iceServers: state.iceServers ?? [])
            apply(state)
            phase = .joined
            startPolling()
        } catch let error as FeedError {
            phase = .failed(error.message)
        } catch {
            phase = .failed("ROOSTER could not open that room.")
        }
    }

    func leave() {
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
