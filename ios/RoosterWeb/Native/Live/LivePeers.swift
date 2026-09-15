import AVFoundation
import Foundation
import WebRTC

/// The WebRTC side of a live room.
///
/// ROOSTER rooms are a full mesh with no media server: every member connects straight to every
/// other one (roster-live.js:112-115, roster-live.mts:1-6). This mirrors the browser's rules so a
/// phone and a browser can be in the same room:
///
/// - a connection is made unless both sides are listeners;
/// - "perfect negotiation": the polite side is whoever's member id sorts higher, and only the
///   impolite side makes the first offer (roster-live.js:105-107, 881-891);
/// - audio is always negotiated; video only in a video room;
/// - candidates that arrive before the remote description are held until it is set.
@MainActor
final class LivePeers {
    /// Signals to send, handed back to the room to batch (≤20 per request, roster-live.js:816-838).
    var onSignal: (OutgoingSignal) -> Void = { _ in }
    /// A remote member's video track appeared or went away.
    var onRemoteVideo: (String, RTCVideoTrack?) -> Void = { _, _ in }

    private let factory: RTCPeerConnectionFactory
    private var peers: [String: Peer] = [:]
    private var iceServers: [RTCIceServer] = []
    private var myID = ""
    private var isVideoRoom = false

    private var audioTrack: RTCAudioTrack?
    private var videoTrack: RTCVideoTrack?
    private var capturer: RTCCameraVideoCapturer?
    private var localStreamID = "rooster-\(UUID().uuidString.prefix(8))"

    private final class Peer {
        let connection: RTCPeerConnection
        let delegate: PeerDelegate
        var polite: Bool
        var makingOffer = false
        var settingRemote = false
        var pendingCandidates: [RTCIceCandidate] = []
        var audio: RTCRtpTransceiver?
        var video: RTCRtpTransceiver?

        init(connection: RTCPeerConnection, delegate: PeerDelegate, polite: Bool) {
            self.connection = connection
            self.delegate = delegate
            self.polite = polite
        }
    }

    init() {
        RTCInitializeSSL()
        factory = RTCPeerConnectionFactory(encoderFactory: RTCDefaultVideoEncoderFactory(),
                                           decoderFactory: RTCDefaultVideoDecoderFactory())
    }

    deinit { RTCCleanupSSL() }

    // MARK: Room lifecycle

    func configure(myID: String, isVideoRoom: Bool, iceServers servers: [IceServer]) {
        self.myID = myID
        self.isVideoRoom = isVideoRoom
        iceServers = servers.map { server in
            if let username = server.username, let credential = server.credential {
                return RTCIceServer(urlStrings: server.urls, username: username, credential: credential)
            }
            return RTCIceServer(urlStrings: server.urls)
        }
    }

    /// Microphone audio, once this member may speak. Listeners never publish.
    func startMicrophone() {
        guard audioTrack == nil else { return }
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: [
            "googEchoCancellation": "true", "googNoiseSuppression": "true", "googAutoGainControl": "true",
        ])
        let source = factory.audioSource(with: constraints)
        let track = factory.audioTrack(with: source, trackId: "rooster-audio")
        track.isEnabled = false
        audioTrack = track
        for peer in peers.values { attachLocalTracks(to: peer) }
    }

    func setMicrophone(enabled: Bool) {
        audioTrack?.isEnabled = enabled
    }

    /// The camera, for a member on video in a video room.
    func startCamera(front: Bool = true) {
        guard isVideoRoom, videoTrack == nil else { return }
        let source = factory.videoSource()
        let capturer = RTCCameraVideoCapturer(delegate: source)
        self.capturer = capturer
        let track = factory.videoTrack(with: source, trackId: "rooster-video")
        videoTrack = track
        start(capturer, front: front)
        for peer in peers.values { attachLocalTracks(to: peer) }
    }

    func stopCamera() {
        capturer?.stopCapture()
        capturer = nil
        videoTrack = nil
    }

    var localVideo: RTCVideoTrack? { videoTrack }

    private func start(_ capturer: RTCCameraVideoCapturer, front: Bool) {
        let position: AVCaptureDevice.Position = front ? .front : .back
        guard let device = RTCCameraVideoCapturer.captureDevices().first(where: { $0.position == position }),
              let format = RTCCameraVideoCapturer.supportedFormats(for: device)
                  .filter({ CMVideoFormatDescriptionGetDimensions($0.formatDescription).width <= 1280 })
                  .max(by: { CMVideoFormatDescriptionGetDimensions($0.formatDescription).width < CMVideoFormatDescriptionGetDimensions($1.formatDescription).width }),
              let fps = format.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() else { return }
        capturer.startCapture(with: device, format: format, fps: Int(min(fps, 30)))
    }

    // MARK: Peers

    /// Called after every sync: open connections to the people who should hear us, close the rest.
    func reconcile(participants: [LiveState.Participant], meIsListener: Bool) {
        let others = participants.filter { $0.memberId != myID }
        let wanted = Set(others.filter { !(meIsListener && $0.isListener) }.map(\.memberId))
        for id in peers.keys where !wanted.contains(id) { close(id) }
        for id in wanted where peers[id] == nil { open(id) }
    }

    func closeAll() {
        for id in peers.keys { close(id) }
        stopCamera()
        audioTrack = nil
    }

    private func close(_ id: String) {
        peers[id]?.connection.close()
        peers[id] = nil
        onRemoteVideo(id, nil)
    }

    @discardableResult
    private func open(_ id: String) -> Peer? {
        let configuration = RTCConfiguration()
        configuration.iceServers = iceServers
        configuration.sdpSemantics = .unifiedPlan
        configuration.continualGatheringPolicy = .gatherContinually
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let delegate = PeerDelegate(id: id)
        guard let connection = factory.peerConnection(with: configuration, constraints: constraints, delegate: delegate) else { return nil }
        // politeSide = myId > theirId, as strings (roster-live.js:105-107).
        let peer = Peer(connection: connection, delegate: delegate, polite: myID > id)
        peers[id] = peer
        delegate.owner = self
        attachLocalTracks(to: peer)
        // The impolite side offers first.
        if !peer.polite { Task { await negotiate(with: id) } }
        return peer
    }

    /// Audio always, video only in a video room; send when we have a track, else receive only
    /// (roster-live.js:532-571).
    private func attachLocalTracks(to peer: Peer) {
        if peer.audio == nil {
            let direction: RTCRtpTransceiverDirection = audioTrack == nil ? .recvOnly : .sendRecv
            let initializer = RTCRtpTransceiverInit()
            initializer.direction = direction
            initializer.streamIds = [localStreamID]
            peer.audio = audioTrack.map { peer.connection.addTransceiver(with: $0, init: initializer) }
                ?? peer.connection.addTransceiver(of: .audio, init: initializer)
        } else if let audioTrack, peer.audio?.sender.track == nil {
            peer.audio?.sender.track = audioTrack
            peer.audio?.setDirection(.sendRecv, error: nil)
        }
        guard isVideoRoom else { return }
        if peer.video == nil {
            let initializer = RTCRtpTransceiverInit()
            initializer.direction = videoTrack == nil ? .recvOnly : .sendRecv
            initializer.streamIds = [localStreamID]
            peer.video = videoTrack.map { peer.connection.addTransceiver(with: $0, init: initializer) }
                ?? peer.connection.addTransceiver(of: .video, init: initializer)
        } else if let videoTrack, peer.video?.sender.track == nil {
            peer.video?.sender.track = videoTrack
            peer.video?.setDirection(.sendRecv, error: nil)
        }
    }

    // MARK: Negotiation

    fileprivate func negotiate(with id: String) async {
        guard let peer = peers[id], !peer.makingOffer else { return }
        peer.makingOffer = true
        defer { peer.makingOffer = false }
        do {
            let offer = try await peer.connection.offer(for: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil))
            try await peer.connection.setLocalDescription(offer)
            onSignal(OutgoingSignal(toId: id, kind: "offer", payload: ["type": "offer", "sdp": offer.sdp]))
        } catch {}
    }

    func receive(_ signal: LiveState.Signal) async {
        let id = signal.fromId
        let peer = peers[id] ?? open(id)
        guard let peer else { return }
        switch signal.kind {
        case "offer", "answer":
            guard let payload = signal.payload.object, let sdp = payload["sdp"]?.text else { return }
            let type: RTCSdpType = signal.kind == "offer" ? .offer : .answer
            // Offer collision: the polite side gives way, the impolite side ignores the offer.
            let collision = type == .offer && (peer.makingOffer || peer.connection.signalingState != .stable)
            if collision && !peer.polite { return }
            do {
                peer.settingRemote = true
                try await peer.connection.setRemoteDescription(RTCSessionDescription(type: type, sdp: sdp))
                peer.settingRemote = false
                for candidate in peer.pendingCandidates { try? await peer.connection.add(candidate) }
                peer.pendingCandidates = []
                if type == .offer {
                    attachLocalTracks(to: peer)
                    let answer = try await peer.connection.answer(for: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil))
                    try await peer.connection.setLocalDescription(answer)
                    onSignal(OutgoingSignal(toId: id, kind: "answer", payload: ["type": "answer", "sdp": answer.sdp]))
                }
            } catch {
                peer.settingRemote = false
            }
        case "ice":
            guard let payload = signal.payload.object,
                  let candidate = payload["candidate"]?.object,
                  let sdp = candidate["candidate"]?.text else { return }
            let ice = RTCIceCandidate(sdp: sdp,
                                      sdpMLineIndex: Int32(candidate["sdpMLineIndex"]?.int ?? 0),
                                      sdpMid: candidate["sdpMid"]?.text)
            if peer.connection.remoteDescription == nil || peer.settingRemote {
                peer.pendingCandidates.append(ice)
            } else {
                try? await peer.connection.add(ice)
            }
        case "bye":
            close(id)
        default:
            break
        }
    }

    fileprivate func candidate(_ candidate: RTCIceCandidate, from id: String) {
        var payload: [String: Any] = ["candidate": candidate.sdp, "sdpMLineIndex": candidate.sdpMLineIndex]
        if let mid = candidate.sdpMid { payload["sdpMid"] = mid }
        onSignal(OutgoingSignal(toId: id, kind: "ice", payload: ["candidate": payload]))
    }

    fileprivate func renegotiate(_ id: String) {
        guard let peer = peers[id], !peer.polite else { return }
        Task { await negotiate(with: id) }
    }

    fileprivate func remoteTrack(_ track: RTCMediaStreamTrack?, from id: String) {
        onRemoteVideo(id, track as? RTCVideoTrack)
    }

    fileprivate func restart(_ id: String, after seconds: Double) {
        Task {
            try? await Task.sleep(for: .seconds(seconds))
            guard peers[id] != nil else { return }
            close(id)
            open(id)
        }
    }
}

/// Peer connection callbacks; WebRTC calls these off the main actor.
final class PeerDelegate: NSObject, RTCPeerConnectionDelegate {
    let id: String
    weak var owner: LivePeers?

    init(id: String) {
        self.id = id
    }

    func peerConnection(_ connection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        Task { @MainActor in owner?.candidate(candidate, from: id) }
    }

    func peerConnectionShouldNegotiate(_ connection: RTCPeerConnection) {
        Task { @MainActor in owner?.renegotiate(id) }
    }

    func peerConnection(_ connection: RTCPeerConnection, didAdd receiver: RTCRtpReceiver, streams: [RTCMediaStream]) {
        Task { @MainActor in owner?.remoteTrack(receiver.track, from: id) }
    }

    func peerConnection(_ connection: RTCPeerConnection, didChange state: RTCIceConnectionState) {
        // Rebuild a dead connection, the way the site does (roster-live.js:623-632).
        switch state {
        case .failed: Task { @MainActor in owner?.restart(id, after: 0.15) }
        case .disconnected: Task { @MainActor in owner?.restart(id, after: 1.8) }
        default: break
        }
    }

    func peerConnection(_ connection: RTCPeerConnection, didChange state: RTCSignalingState) {}
    func peerConnection(_ connection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ connection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnection(_ connection: RTCPeerConnection, didChange state: RTCIceGatheringState) {}
    func peerConnection(_ connection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ connection: RTCPeerConnection, didOpen channel: RTCDataChannel) {}
}
