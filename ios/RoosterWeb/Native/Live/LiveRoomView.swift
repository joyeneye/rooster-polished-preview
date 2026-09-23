import SwiftUI
import WebRTC

/// A live room, native (design/world-class-concept/room.png): the header, a stage of speaker
/// tiles, who else is in the room, the comments with reactions drifting up beside them, and a
/// glass control bar above the app's tab bar.
struct LiveRoomView: View {
    let key: String
    let stack: ShellTab
    @StateObject private var model: LiveRoomModel
    @EnvironmentObject private var store: ShellStore
    @Environment(\.dismiss) private var dismiss
    @State private var comment = ""
    @State private var showsPeople = false
    @State private var showsReactions = false
    @State private var confirmsLeaving = false
    @State private var link: String?
    @FocusState private var writing: Bool

    init(key: String, stack: ShellTab, api: FeedAPI) {
        self.key = key
        self.stack = stack
        _model = StateObject(wrappedValue: LiveRoomModel(key: key, api: api))
    }

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            switch model.phase {
            case .joining:
                VStack(spacing: 14) {
                    ProgressView().controlSize(.large).tint(Theme.red)
                    Text("Joining the room…").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.muted)
                }
            case .failed(let message), .ended(let message):
                closed(message)
            case .joined:
                room
            }
        }
        .task {
            model.prepareToRejoin()
            await model.join()
            #if DEBUG
            if LiveRoomFixtures.opensTray { showsReactions = true }
            #endif
        }
        .onDisappear { model.leave() }
        .opensSiteLinks($link, in: stack)
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $showsPeople) {
            LivePeopleSheet(model: model) { id in
                showsPeople = false
                Task {
                    try? await Task.sleep(for: .milliseconds(350))
                    link = "/profile.html?id=\(id)"
                }
            }
        }
        .confirmationDialog("Leave this room?", isPresented: $confirmsLeaving, titleVisibility: .visible) {
            Button("End the room for everyone", role: .destructive) {
                Task { await model.host("end_room") }
            }
            Button("Leave the room") { leave() }
            Button("Stay", role: .cancel) {}
        } message: {
            Text("You're the host. Ending it closes the room for everyone in it.")
        }
    }

    private func closed(_ message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "dot.radiowaves.left.and.right")
                .font(.system(size: 30, weight: .semibold)).foregroundStyle(Theme.red)
                .frame(width: 68, height: 68).background(Theme.red.opacity(0.14), in: Circle())
            Text(message).font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
            Button("Back to Rooms") { dismiss() }
                .buttonStyle(.designPrimary)
                .frame(maxWidth: 240)
        }
        .padding(32)
    }

    // MARK: The room

    private var room: some View {
        VStack(spacing: 0) {
            header
                .padding(.bottom, 12)
            stage
            audience
                .padding(.top, 12)
            comments
            composer
                .padding(.bottom, 10)
            controls
        }
        .padding(.horizontal, Design.gutter)
        // The app's glass tab bar floats over the bottom of every screen.
        .padding(.bottom, Design.tabBarClearance - 10)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    Image("LaunchLogo").resizable().scaledToFit().frame(width: 24, height: 24)
                        .accessibilityHidden(true)
                    RoosterWordmark(size: 21, color: Theme.ink)
                }
                Spacer(minLength: 14)
                HStack(spacing: 12) {
                    LivePill()
                    Label(counts, systemImage: "person.fill")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.muted)
                        .labelStyle(TightLabelStyle())
                }
            }
            .frame(maxHeight: .infinity, alignment: .topLeading)

            Spacer(minLength: 4)

            VStack(alignment: .trailing, spacing: 6) {
                Button { leaveOrAsk() } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                        .frame(width: 36, height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Leave the room")
                Text(model.room?.title ?? "Room")
                    .font(.roosterDisplay(17, relativeTo: .headline))
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.leading)
                    .lineLimit(3)
                    .minimumScaleFactor(0.75)
                    .frame(maxWidth: 190, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
            }
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var counts: String {
        let people = model.participants.count
        return model.isVideoRoom ? "\(people) watching" : "\(people) listening"
    }

    // MARK: Stage

    private var stage: some View {
        let speakers = model.speakers
        let columns = speakers.count <= 1 ? 1 : speakers.count <= 4 ? 2 : 3
        let aspect: CGFloat = speakers.count <= 1 ? 1.7 : columns == 2 ? 1.26 : 0.95
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: columns), spacing: 10) {
            ForEach(speakers) { person in
                SpeakerTile(person: person,
                            video: video(for: person),
                            active: model.activeSpeakerID == person.memberId,
                            level: model.levels[person.memberId] ?? 0,
                            compact: columns == 3)
                    .aspectRatio(aspect, contentMode: .fit)
                    .onTapGesture { link = "/profile.html?id=\(person.memberId)" }
            }
        }
        .overlay {
            if speakers.isEmpty {
                Text("Nobody is on the mic yet.")
                    .font(.system(size: 14)).foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, minHeight: 120)
                    .designCard()
            }
        }
    }

    private func video(for person: LiveState.Participant) -> RTCVideoTrack? {
        guard model.isVideoRoom else { return nil }
        if person.isYou == true { return model.localVideo }
        return model.remoteVideo[person.memberId]
    }

    // MARK: Audience

    private var audience: some View {
        let people = model.listeners
        let hands = people.filter { $0.handRaised == true }.count
        return Button { showsPeople = true } label: {
            HStack(spacing: 10) {
                Label("In the room", systemImage: "person.2.fill")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.muted)
                    .labelStyle(TightLabelStyle())
                    .fixedSize()
                if hands > 0, model.you?.isHost == true {
                    Label("\(hands)", systemImage: "hand.raised.fill")
                        .labelStyle(TightLabelStyle())
                        .font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Theme.red, in: Capsule())
                        .accessibilityLabel("\(hands) hands up")
                }
                GeometryReader { proxy in
                    let size: CGFloat = 32, gap: CGFloat = 5, chip: CGFloat = 44
                    let fits = max(0, Int((proxy.size.width - chip - gap) / (size + gap)))
                    let shown = people.count <= fits + 1 ? people.count : fits
                    HStack(spacing: gap) {
                        ForEach(people.prefix(shown)) { person in
                            MemberAvatar(name: person.name, photoPath: person.photoUrl, size: size)
                                .overlay(Circle().stroke(Theme.line, lineWidth: 1))
                                .overlay(alignment: .topTrailing) {
                                    if person.handRaised == true {
                                        Image(systemName: "hand.raised.fill").font(.system(size: 8, weight: .bold))
                                            .foregroundStyle(.white)
                                            .frame(width: 16, height: 16).background(Theme.red, in: Circle())
                                            .offset(x: 3, y: -3)
                                    }
                                }
                        }
                        if people.count > shown {
                            Text("+\(people.count - shown)")
                                .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink)
                                .frame(width: chip, height: size)
                                .background(Theme.raised, in: Capsule())
                                .overlay(Capsule().stroke(Theme.line))
                        }
                        if people.isEmpty {
                            Text("Just the speakers so far").font(.system(size: 13)).foregroundStyle(Theme.muted)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
                }
                .frame(height: 34)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("In the room: \(people.count) listening. Show everyone")
    }

    // MARK: Comments

    private var comments: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if model.messages.isEmpty {
                        Text("No comments yet. Say something.")
                            .font(.system(size: 14)).foregroundStyle(Theme.muted)
                            .padding(.top, 8)
                    }
                    ForEach(model.messages) { message in
                        LiveCommentRow(message: message)
                            .id(message.id)
                    }
                }
                .padding(.top, 16)
                .padding(.bottom, 8)
                .padding(.trailing, 40)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.hidden)
            .defaultScrollAnchor(.bottom)
            .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.12),
                                         .init(color: .black, location: 1)], startPoint: .top, endPoint: .bottom))
            .overlay(alignment: .trailing) {
                ReactionLane(floaters: model.floaters).allowsHitTesting(false)
            }
            .onChange(of: model.messages.last?.id) { _, last in
                guard let last else { return }
                withAnimation(.snappy) { proxy.scrollTo(last, anchor: .bottom) }
            }
        }
        .frame(maxHeight: .infinity)
    }

    private var composer: some View {
        HStack(spacing: 8) {
            TextField("", text: $comment, prompt: Text("Say something…").foregroundStyle(Theme.muted))
                .textFieldStyle(.plain)
                .font(.system(size: 15))
                .focused($writing)
                .foregroundStyle(Theme.ink)
                .tint(Theme.red)
                .submitLabel(.send)
                .onSubmit(send)
            Button(action: send) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(canSend ? Theme.red : Theme.raised, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .accessibilityLabel("Send comment")
        }
        .padding(.leading, 16).padding(.trailing, 5)
        .frame(height: 40)
        .background(Theme.surface, in: Capsule())
        .overlay(Capsule().stroke(Theme.line))
    }

    private var canSend: Bool {
        !comment.trimmingCharacters(in: .whitespaces).isEmpty && !model.sending
    }

    // MARK: Controls

    private var controls: some View {
        let you = model.you
        let muted = you?.muted != false
        return HStack(spacing: 2) {
            control(model.canSpeak && !muted ? "mic.fill" : "mic.slash.fill",
                    model.canSpeak && muted ? "Unmute" : "Mic",
                    lit: model.canSpeak && !muted,
                    enabled: model.canSpeak,
                    hint: model.canSpeak ? nil : "Raise your hand to be brought on the mic") {
                Task { await model.setMuted(!muted) }
            }

            if you?.isHost == true {
                control("person.2", "People", lit: false) { showsPeople = true }
            } else {
                control(you?.handRaised == true ? "hand.raised.fill" : "hand.raised",
                        you?.handRaised == true ? "Hand Up" : "Raise Hand",
                        lit: you?.handRaised == true,
                        enabled: !model.canSpeak,
                        hint: model.canSpeak ? "You're already on the mic" : nil,
                        tint: you?.handRaised == true ? Theme.red : nil) {
                    Task { await model.raiseHand(you?.handRaised != true) }
                }
            }

            control("face.smiling", "Reactions", lit: showsReactions) {
                withAnimation(.snappy) { showsReactions.toggle() }
            }

            if let url = model.shareURL(base: store.baseURL) {
                ShareLink(item: url,
                          subject: Text(model.room?.title ?? "ROOSTER LIVE"),
                          message: Text(model.isVideoRoom ? "Join my ROOSTER LIVE broadcast." : "Join me in this ROOSTER audio room.")) {
                    controlLabel("square.and.arrow.up", "Share", lit: false)
                }
                .buttonStyle(.plain)
            }

            Button { leaveOrAsk() } label: {
                VStack(spacing: 5) {
                    Image(systemName: "rectangle.portrait.and.arrow.right").font(.system(size: 19, weight: .semibold))
                    Text("Leave").font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(.white)
                .frame(width: 80, height: 50)
                .background(Theme.red, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .shadow(color: Theme.red.opacity(0.4), radius: 10, y: 3)
            }
            .buttonStyle(PressableStyle())
            .padding(.leading, 4)
        }
        .padding(5)
        .designGlass(radius: 20)
        .overlay(alignment: .top) {
            if showsReactions { reactionTray.offset(y: -58) }
        }
    }

    private var reactionTray: some View {
        HStack(spacing: 4) {
            ForEach(LiveRoomModel.reactions, id: \.self) { emoji in
                Button {
                    Task { await model.react(emoji) }
                } label: {
                    ReactionGlyph(emoji: emoji, size: 22).frame(width: 46, height: 46)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("React \(ReactionGlyph.name(emoji))")
            }
        }
        .padding(.horizontal, 8)
        .designGlass(radius: 26)
        .transition(.scale(scale: 0.8, anchor: .bottom).combined(with: .opacity))
    }

    private func control(_ symbol: String, _ label: String, lit: Bool, enabled: Bool = true, hint: String? = nil,
                         tint: Color? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) { controlLabel(symbol, label, lit: lit, tint: tint) }
            .buttonStyle(.plain)
            .disabled(!enabled)
            .opacity(enabled ? 1 : 0.38)
            .accessibilityHint(hint ?? "")
    }

    private func controlLabel(_ symbol: String, _ label: String, lit: Bool, tint: Color? = nil) -> some View {
        VStack(spacing: 5) {
            Image(systemName: symbol).font(.system(size: 20, weight: .regular)).frame(height: 24)
            Text(label).font(.system(size: 11, weight: .medium)).lineLimit(1).minimumScaleFactor(0.8)
        }
        .foregroundStyle(tint ?? (lit ? Theme.ink : Theme.ink.opacity(0.72)))
        .frame(maxWidth: .infinity, minHeight: 50)
        .contentShape(Rectangle())
    }

    // MARK: Actions

    private func leaveOrAsk() {
        if model.you?.isHost == true { confirmsLeaving = true } else { leave() }
    }

    private func leave() {
        model.leave()
        dismiss()
    }

    private func send() {
        guard canSend else { return }
        let text = comment
        comment = ""
        Task { await model.say(text) }
    }
}

// MARK: - Pieces

/// One speaker on the stage: their camera in a video room, otherwise their photo, with their
/// name and part in the room. The loudest speaker gets the red ring and a level meter.
private struct SpeakerTile: View {
    let person: LiveState.Participant
    let video: RTCVideoTrack?
    let active: Bool
    let level: Double
    let compact: Bool
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        Color.clear
            .overlay { media }
            .overlay(alignment: .bottom) {
                LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom)
                    .frame(height: 70)
            }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(person.name).font(.system(size: compact ? 13 : 15, weight: .semibold)).foregroundStyle(.white)
                        .lineLimit(1)
                    Text(role).font(.system(size: compact ? 11 : 12)).foregroundStyle(.white.opacity(0.72)).lineLimit(1)
                }
                .padding(compact ? 8 : 12)
            }
            .overlay(alignment: .topTrailing) {
                Group {
                    if person.muted == true {
                        Image(systemName: "mic.slash.fill")
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                            .frame(width: 28, height: 28)
                            .background(.black.opacity(0.55), in: Circle())
                    } else if active {
                        LevelBadge(level: level)
                    }
                }
                .padding(8)
            }
            .clipShape(RoundedRectangle(cornerRadius: Design.tileRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Design.tileRadius, style: .continuous)
                .stroke(active ? Theme.red : Color.white.opacity(0.08), lineWidth: active ? 2 : 1))
            .shadow(color: active ? Theme.red.opacity(0.6) : .clear, radius: 12)
            .animation(.easeOut(duration: 0.25), value: active)
            .contentShape(Rectangle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel([person.name, role, person.muted == true ? "muted" : active ? "speaking" : nil]
                .compactMap { $0 }.joined(separator: ", "))
            .accessibilityAddTraits(.isButton)
            .accessibilityHint("Opens their profile")
    }

    private var role: String {
        if person.isYou == true { return person.isHost == true ? "Host · You" : "You" }
        if person.isHost == true { return "Host" }
        if person.isModerator == true { return "Moderator" }
        return "Speaker"
    }

    @ViewBuilder private var media: some View {
        if let video {
            VideoTrackView(track: video)
        } else {
            RemoteImage(url: person.photoUrl.flatMap { store.siteURL($0) }, size: 360) {
                ZStack {
                    LinearGradient(colors: [Theme.raised, Theme.surface], startPoint: .top, endPoint: .bottom)
                    Text(String(person.name.trimmingCharacters(in: .whitespaces).first ?? "R").uppercased())
                        .font(.roosterDisplay(compact ? 30 : 44))
                        .foregroundStyle(Theme.muted.opacity(0.6))
                }
            }
        }
    }
}

/// The red meter on the active speaker's tile, driven by their real audio level.
private struct LevelBadge: View {
    let level: Double
    private static let shape: [CGFloat] = [0.45, 0.8, 1, 0.7, 0.5]

    var body: some View {
        HStack(spacing: 2) {
            ForEach(Self.shape.indices, id: \.self) { index in
                Capsule().fill(Theme.red)
                    .frame(width: 2.5, height: 4 + 12 * Self.shape[index] * CGFloat(0.35 + 0.65 * min(1, level * 1.6)))
            }
        }
        .frame(width: 34, height: 34)
        .background(.black.opacity(0.55), in: Circle())
        .overlay(Circle().stroke(Theme.red, lineWidth: 1.5))
        .animation(.easeOut(duration: 0.3), value: level)
        .accessibilityHidden(true)
    }
}

private struct LiveCommentRow: View {
    let message: LiveState.Message

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            MemberAvatar(name: message.name, photoPath: message.photoUrl, size: 32)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(message.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink.opacity(0.8))
                        .lineLimit(1)
                    if let time = LiveCommentRow.time(message.createdAt) {
                        Text(time).font(.system(size: 11)).foregroundStyle(Theme.muted)
                    }
                }
                Text(message.body).font(.system(size: 14)).foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private static let parser: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    static func time(_ stamp: String) -> String? {
        guard let date = parser.date(from: stamp) ?? ISO8601DateFormatter().date(from: stamp) else { return nil }
        return date.formatted(date: .omitted, time: .shortened)
    }
}

/// Reactions rising up the right edge of the comments and fading as they go.
private struct ReactionLane: View {
    let floaters: [LiveRoomModel.Floater]

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .bottom) {
                ForEach(floaters) { floater in
                    FloatingReaction(floater: floater, travel: proxy.size.height * 0.9)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .bottom)
        }
        .frame(width: 40)
        .accessibilityHidden(true)
    }
}

private struct FloatingReaction: View {
    let floater: LiveRoomModel.Floater
    let travel: CGFloat
    @State private var risen = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        glyph
            .offset(x: CGFloat(floater.lane - 0.5) * 18 + (risen ? CGFloat(floater.lane - 0.5) * -10 : 0),
                    y: risen && !reduceMotion ? -travel : 0)
            .scaleEffect(risen ? 1 : 0.5)
            .opacity(risen ? 0 : 1)
            .onAppear {
                withAnimation(.easeOut(duration: 3)) { risen = true }
            }
    }

    private var glyph: some View {
        ReactionGlyph(emoji: floater.emoji, size: 15 + CGFloat(floater.lane) * 8)
    }
}

/// A reaction drawn in the app's own red symbols; anything without one shows as the emoji.
private struct ReactionGlyph: View {
    let emoji: String
    let size: CGFloat

    private static let symbols = ["❤️": "heart.fill", "🔥": "flame.fill", "👏": "hands.clap.fill",
                                  "💯": "checkmark.seal.fill", "🙌": "hands.and.sparkles.fill"]

    static func name(_ emoji: String) -> String {
        ["❤️": "love", "🔥": "fire", "👏": "applause", "💯": "hundred", "🙌": "praise"][emoji] ?? emoji
    }

    var body: some View {
        if let symbol = Self.symbols[emoji] {
            Image(systemName: symbol).font(.system(size: size)).foregroundStyle(Theme.red)
        } else {
            Text(emoji).font(.system(size: size + 4))
        }
    }
}

private struct TightLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 5) {
            configuration.icon.font(.system(size: 12))
            configuration.title
        }
    }
}

// MARK: - People

/// Everybody in the room. The host can bring people on, mute them, or move them back to
/// listening; anybody can open a profile.
private struct LivePeopleSheet: View {
    @ObservedObject var model: LiveRoomModel
    let open: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    private var isHost: Bool { model.you?.isHost == true }

    var body: some View {
        NavigationStack {
            List {
                let hands = model.listeners.filter { $0.handRaised == true }
                if !hands.isEmpty {
                    Section("Hands up") {
                        ForEach(hands) { row($0, action: "approve_speaker", label: "Bring on") }
                    }
                }
                Section("On the mic") {
                    ForEach(model.speakers) { person in
                        if person.isHost == true {
                            row(person, action: nil, label: "")
                        } else if person.muted != true {
                            row(person, action: "mute_speaker", label: "Mute",
                                second: ("step_down_speaker", "Move to listening"))
                        } else {
                            row(person, action: "step_down_speaker", label: "Move to listening")
                        }
                    }
                }
                Section("Listening") {
                    if model.listeners.isEmpty {
                        Text("Nobody else yet.").font(.system(size: 14)).foregroundStyle(Theme.muted)
                    }
                    ForEach(model.listeners) { row($0, action: "approve_speaker", label: "Bring on") }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .listRowBackground(Theme.surface)
            .navigationTitle("In the room")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() }.foregroundStyle(Theme.red) }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Theme.background)
    }

    private func row(_ person: LiveState.Participant, action: String?, label: String,
                     second: (String, String)? = nil) -> some View {
        HStack(spacing: 12) {
            Button { open(person.memberId) } label: {
                HStack(spacing: 12) {
                    MemberAvatar(name: person.name, photoPath: person.photoUrl, size: 40)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(person.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                        Text(person.isHost == true ? "Host" : person.isModerator == true ? "Moderator" : person.role.capitalized)
                            .font(.system(size: 12)).foregroundStyle(Theme.muted)
                    }
                }
            }
            .buttonStyle(.plain)
            Spacer()
            if isHost, let action {
                if let second {
                    Menu {
                        Button(label) { Task { await model.host(action, member: person.memberId) } }
                        Button(second.1) { Task { await model.host(second.0, member: person.memberId) } }
                    } label: {
                        Image(systemName: "ellipsis").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.ink)
                            .frame(width: 36, height: 32).background(Theme.raised, in: Capsule())
                    }
                    .accessibilityLabel("Actions for \(person.name)")
                } else {
                    Button(label) { Task { await model.host(action, member: person.memberId) } }
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.red)
                        .padding(.horizontal, 12).frame(height: 32)
                        .background(Theme.red.opacity(0.14), in: Capsule())
                        .buttonStyle(.plain)
                }
            }
        }
        .listRowBackground(Theme.surface)
    }
}

/// A member's camera, remote or this phone's own.
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
