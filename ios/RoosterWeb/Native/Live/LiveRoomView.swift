import SwiftUI
import WebRTC

/// A live room, native: the stage, who is in it, the comments and the controls.
struct LiveRoomView: View {
    let key: String
    let stack: ShellTab
    @StateObject private var model: LiveRoomModel
    @Environment(\.dismiss) private var dismiss
    @State private var comment = ""
    @State private var showsPeople = false
    @State private var link: String?
    @FocusState private var writing: Bool

    init(key: String, stack: ShellTab, api: FeedAPI) {
        self.key = key
        self.stack = stack
        _model = StateObject(wrappedValue: LiveRoomModel(key: key, api: api))
    }

    var body: some View {
        ZStack {
            Color(hex: 0x120B0E).ignoresSafeArea()
            switch model.phase {
            case .joining:
                VStack(spacing: 12) {
                    ProgressView().controlSize(.large).tint(.white)
                    Text("Joining the room…").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white.opacity(0.8))
                }
            case .failed(let message), .ended(let message):
                VStack(spacing: 14) {
                    Image(systemName: "dot.radiowaves.left.and.right").font(.system(size: 34)).foregroundStyle(.white.opacity(0.6))
                    Text(message).font(.system(size: 16, weight: .semibold)).foregroundStyle(.white).multilineTextAlignment(.center)
                    Button("Back to Rooms") { dismiss() }
                        .font(.system(size: 15, weight: .bold))
                        .buttonStyle(.borderedProminent).tint(Theme.red)
                }
                .padding(32)
            case .joined:
                room
            }
        }
        .task { await model.join() }
        .onDisappear { model.leave() }
        .opensSiteLinks($link, in: stack)
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .statusBarHidden(false)
    }

    private var room: some View {
        VStack(spacing: 0) {
            header
            stage
            Divider().overlay(.white.opacity(0.1))
            comments
            controls
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            MemberAvatar(name: model.room?.hostName ?? "", photoPath: model.room?.hostPhotoUrl, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text("● LIVE").font(.roosterMono(10)).foregroundStyle(Theme.red)
                    Text(model.isVideoRoom ? "VIDEO" : "AUDIO ROOM").font(.roosterMono(10)).foregroundStyle(.white.opacity(0.6))
                }
                Text(model.room?.title ?? "Room").font(.system(size: 16, weight: .bold)).foregroundStyle(.white).lineLimit(1)
                Text(counts).font(.system(size: 12)).foregroundStyle(.white.opacity(0.65))
            }
            Spacer()
            Button { model.leave(); dismiss() } label: {
                Text("Leave").font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                    .padding(.horizontal, 14).frame(height: 34)
                    .background(.white.opacity(0.16), in: Capsule())
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private var counts: String {
        let people = model.participants.count
        if model.isVideoRoom { return "\(people) watching" }
        return "\(people) in the room · \(model.speakers.count) on the mic"
    }

    @ViewBuilder private var stage: some View {
        if model.isVideoRoom {
            ZStack {
                if let track = model.remoteVideo.values.first {
                    VideoTrackView(track: track)
                } else {
                    VStack(spacing: 10) {
                        ProgressView().tint(.white)
                        Text("Waiting for the camera…").font(.system(size: 14)).foregroundStyle(.white.opacity(0.7))
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.black)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    speakerGrid
                    if !model.listeners.isEmpty {
                        Text("LISTENING").font(.roosterMono(10)).tracking(1.2).foregroundStyle(.white.opacity(0.5))
                            .padding(.horizontal, 20)
                        listenerGrid
                    }
                }
                .padding(.vertical, 16)
            }
            .frame(maxHeight: .infinity)
        }
    }

    private var speakerGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 3), spacing: 16) {
            ForEach(model.speakers) { person in
                VStack(spacing: 6) {
                    MemberAvatar(name: person.name, photoPath: person.photoUrl, size: 76)
                        .overlay(Circle().stroke(person.muted == true ? .clear : Theme.red, lineWidth: 3).padding(-4))
                        .overlay(alignment: .bottomTrailing) {
                            if person.muted == true {
                                Image(systemName: "mic.slash.fill").font(.system(size: 11)).foregroundStyle(.white)
                                    .frame(width: 26, height: 26).background(Color(hex: 0x3A2A2F), in: Circle())
                            }
                        }
                    Text(person.name).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                    if person.isHost == true {
                        Text("HOST").font(.roosterMono(8)).tracking(0.6).foregroundStyle(Theme.gold)
                    }
                }
                .onTapGesture { link = "/profile.html?id=\(person.memberId)" }
            }
        }
        .padding(.horizontal, 16)
    }

    private var listenerGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 5), spacing: 12) {
            ForEach(model.listeners) { person in
                VStack(spacing: 4) {
                    MemberAvatar(name: person.name, photoPath: person.photoUrl, size: 46)
                        .overlay(alignment: .topTrailing) {
                            if person.handRaised == true {
                                Text("✋").font(.system(size: 12))
                                    .frame(width: 20, height: 20).background(.white, in: Circle())
                            }
                        }
                    Text(person.name.split(separator: " ").first.map(String.init) ?? person.name)
                        .font(.system(size: 10)).foregroundStyle(.white.opacity(0.75)).lineLimit(1)
                }
                .onTapGesture { link = "/profile.html?id=\(person.memberId)" }
            }
        }
        .padding(.horizontal, 16)
    }

    private var comments: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(model.messages) { message in
                        HStack(alignment: .top, spacing: 8) {
                            Text(message.name).font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.gold)
                            Text(message.body).font(.system(size: 14)).foregroundStyle(.white.opacity(0.92))
                            Spacer(minLength: 0)
                        }
                        .id(message.id)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            .frame(height: 160)
            .onChange(of: model.messages.last?.id) { _, last in
                guard let last else { return }
                withAnimation(.snappy) { proxy.scrollTo(last, anchor: .bottom) }
            }
        }
    }

    private var controls: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                TextField("Say something…", text: $comment)
                    .textFieldStyle(.plain)
                    .focused($writing)
                    .foregroundStyle(.white)
                    .tint(Theme.red)
                    .padding(.horizontal, 16)
                    .frame(height: 44)
                    .background(.white.opacity(0.12), in: Capsule())
                    .submitLabel(.send)
                    .onSubmit(send)
                Button(action: send) {
                    Image(systemName: "arrow.up").font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .background(comment.trimmingCharacters(in: .whitespaces).isEmpty ? .white.opacity(0.12) : Theme.red, in: Circle())
                }
                .disabled(comment.trimmingCharacters(in: .whitespaces).isEmpty || model.sending)
            }

            HStack(spacing: 12) {
                if model.canSpeak {
                    control(model.you?.muted == true ? "mic.slash.fill" : "mic.fill",
                            model.you?.muted == true ? "Unmute" : "Mute",
                            active: model.you?.muted != true) {
                        Task { await model.setMuted(model.you?.muted != true) }
                    }
                } else {
                    control(model.you?.handRaised == true ? "hand.raised.fill" : "hand.raised",
                            model.you?.handRaised == true ? "Hand up" : "Raise hand",
                            active: model.you?.handRaised == true) {
                        Task { await model.raiseHand(model.you?.handRaised != true) }
                    }
                }
                if model.you?.isHost == true {
                    control("person.badge.plus", "People", active: false) { showsPeople = true }
                    control("stop.circle.fill", "End", active: false, tint: Theme.red) {
                        Task { await model.host("end_room") }
                    }
                }
                Spacer()
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 14)
        .background(Color(hex: 0x1A1115))
        .sheet(isPresented: $showsPeople) { PeopleSheet(model: model) }
    }

    private func control(_ symbol: String, _ label: String, active: Bool, tint: Color = .white, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: symbol).font(.system(size: 17, weight: .semibold))
                Text(label).font(.system(size: 10, weight: .semibold))
            }
            .foregroundStyle(active ? Theme.red : tint)
            .frame(width: 62, height: 50)
            .background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    private func send() {
        let text = comment
        comment = ""
        Task { await model.say(text) }
    }
}

/// The host's tools: who is in the room, and what they can do about it.
private struct PeopleSheet: View {
    @ObservedObject var model: LiveRoomModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if !model.listeners.filter({ $0.handRaised == true }).isEmpty {
                    Section("Hands up") {
                        ForEach(model.listeners.filter { $0.handRaised == true }) { person in
                            row(person, action: "approve_speaker", label: "Bring on")
                        }
                    }
                }
                Section("On the mic") {
                    ForEach(model.speakers) { person in
                        row(person, action: person.isHost == true ? nil : "step_down_speaker", label: "Move to listening")
                    }
                }
                Section("Listening") {
                    ForEach(model.listeners) { person in
                        row(person, action: "approve_speaker", label: "Bring on")
                    }
                }
            }
            .navigationTitle("In the room")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
        }
    }

    private func row(_ person: LiveState.Participant, action: String?, label: String) -> some View {
        HStack(spacing: 12) {
            MemberAvatar(name: person.name, photoPath: person.photoUrl, size: 40)
            VStack(alignment: .leading, spacing: 1) {
                Text(person.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                Text(person.isHost == true ? "Host" : person.role.capitalized).font(.system(size: 12)).foregroundStyle(Theme.muted)
            }
            Spacer()
            if let action {
                Button(label) { Task { await model.host(action, member: person.memberId) } }
                    .font(.system(size: 13, weight: .bold))
                    .buttonStyle(.bordered)
                    .tint(Theme.red)
            }
        }
    }
}

/// A remote member's camera.
struct VideoTrackView: UIViewRepresentable {
    let track: RTCVideoTrack

    func makeUIView(context: Context) -> RTCMTLVideoView {
        let view = RTCMTLVideoView()
        view.videoContentMode = .scaleAspectFill
        track.add(view)
        context.coordinator.track = track
        context.coordinator.view = view
        return view
    }

    func updateUIView(_ view: RTCMTLVideoView, context: Context) {
        guard context.coordinator.track !== track else { return }
        context.coordinator.track?.remove(view)
        track.add(view)
        context.coordinator.track = track
    }

    static func dismantleUIView(_ view: RTCMTLVideoView, coordinator: Coordinator) {
        coordinator.track?.remove(view)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var track: RTCVideoTrack?
        weak var view: RTCMTLVideoView?
    }
}
