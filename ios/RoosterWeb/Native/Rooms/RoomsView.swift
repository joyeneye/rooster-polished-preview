import SwiftUI

/// The Rooms tab, native: who is live right now (/api/live/rooms), a way to go live yourself, and
/// the Review Room and Chat Room.
struct RoomsView: View {
    enum Filter: String, CaseIterable, Identifiable {
        case all, video, audio
        var id: String { rawValue }
        var title: String { self == .all ? "All" : self == .video ? "Video" : "Audio" }
    }

    @EnvironmentObject private var store: ShellStore
    @EnvironmentObject private var session: SessionModel
    @StateObject private var rooms: Loadable<LiveRooms>
    @State private var filter: Filter = .all
    @State private var notice: String?
    @State private var goingLive = false
    @State private var link: String?

    init(api: FeedAPI) {
        _rooms = StateObject(wrappedValue: Loadable {
            #if DEBUG
            if let fixture = NativeFixtures.rooms() { return fixture }
            #endif
            return try await api.get("/api/live/rooms", as: LiveRooms.self)
        })
    }

    var body: some View {
        NavigationStack(path: store.path(for: .rooms)) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    goLiveCard
                        .padding(.horizontal, Design.gutter)
                        .padding(.top, 18)
                    liveSection.padding(.top, 28)
                    shortcuts.padding(.top, 28)
                }
                .padding(.top, 8)
                .padding(.bottom, Design.tabBarClearance)
            }
            .debugScrollToBottom()
            .background(Theme.background)
            .refreshable { await rooms.load() }
            .onAppear(perform: rooms.startIfNeeded)
            .statusBarScrim()
            .toolbar(.hidden, for: .navigationBar)
            .notice($notice)
            .onChange(of: store.goingLive, initial: true) { _, wanted in
                if wanted { goingLive = true; store.goingLive = false }
            }
            .sheet(isPresented: $goingLive) {
                GoLiveSheet(api: FeedAPI(base: store.baseURL)) { key in
                    Task {
                        await rooms.load()
                        store.push(.native(.liveRoom(key: key)), in: .rooms)
                    }
                }
            }
            .opensSiteLinks($link, in: .rooms)
            .navigationDestination(for: AppRoute.self) { route in
                AppRouteView(route: route, stack: .rooms)
            }
            #if DEBUG
            .task { openDebugPush() }
            #endif
        }
    }

    // MARK: Sections

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            RoosterWordmark(size: 18)
            ScreenTitle(text: "Rooms")
            Text("Good company. Great conversations.")
                .font(.system(size: 15))
                .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, Design.gutter)
    }

    /// Go Live, in the screen as well as in the + menu.
    private var goLiveCard: some View {
        HStack(spacing: 14) {
            Image(systemName: "dot.radiowaves.left.and.right")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Theme.red)
                .frame(width: 46, height: 46)
                .background(Theme.red.opacity(0.14), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text("Start a room")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                Text("Voice or video. Anyone on the roster can pull up.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Button { goingLive = true } label: {
                Text("Go live")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .frame(height: 38)
                    .background(Theme.red, in: Capsule())
                    .shadow(color: Theme.red.opacity(0.35), radius: 10, y: 4)
            }
            .buttonStyle(PressableStyle())
        }
        .designCard(padding: 14)
    }

    @ViewBuilder private var liveSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                DesignSectionHeader(title: "Live now", dot: true)
                if let count = rooms.value?.rooms.count, count > 0 {
                    Text(count == 1 ? "1 room" : "\(count) rooms")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.muted)
                        .fixedSize()
                }
            }
            .padding(.horizontal, Design.gutter)

            HStack(spacing: 8) {
                ForEach(Filter.allCases) { option in
                    RosterFilterChip(title: option.title, selected: filter == option) {
                        withAnimation(.snappy) { filter = option }
                    }
                }
            }
            .padding(.horizontal, Design.gutter)

            Group {
                if let value = rooms.value {
                    let shown = value.rooms.filter { filter == .all || ($0.isVideo == (filter == .video)) }
                    if shown.isEmpty {
                        emptyRooms
                    } else {
                        VStack(spacing: 12) {
                            ForEach(shown) { room in
                                LiveRoomCard(room: room, openHost: { link = "/profile.html?id=\(room.hostId)" }) {
                                    store.push(.native(.liveRoom(key: room.key)), in: .rooms)
                                }
                            }
                        }
                    }
                } else if let failure = rooms.failure {
                    ErrorState(message: failure.message) {
                        if case .locked = failure { session.revalidate() }
                        Task { await rooms.load() }
                    }
                        .designCard(padding: 0)
                } else {
                    ProgressView()
                        .tint(Theme.red)
                        .frame(maxWidth: .infinity, minHeight: 140)
                        .designCard(padding: 0)
                }
            }
            .padding(.horizontal, Design.gutter)
        }
    }

    private var emptyRooms: some View {
        VStack(spacing: 10) {
            Image(systemName: "waveform")
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(Theme.muted)
            Text(filter == .all ? "Nobody is live right now" : "No \(filter.title.lowercased()) rooms right now")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.ink)
            Text("When someone goes live, their room shows up here.")
                .font(.system(size: 14))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .designCard(padding: 20)
    }

    private var shortcuts: some View {
        VStack(alignment: .leading, spacing: 14) {
            DesignSectionHeader(title: "More ways to connect")
                .padding(.horizontal, Design.gutter)
            VStack(spacing: 12) {
                RoomShortcut(title: "Review Room", symbol: "star.bubble.fill",
                             subtitle: "Play a record. Get real feedback.", waveform: true) { link = "/review-room.html" }
                RoomShortcut(title: "Chat Room", symbol: "bubble.left.and.bubble.right.fill",
                             subtitle: "Keep the conversation going.", waveform: false) { link = "/members.html#member-chat" }
            }
            .padding(.horizontal, Design.gutter)
        }
    }

    #if DEBUG
    /// `-RoosterScreen rooms -RoosterPush chat|golive` (fixtures only) opens a screen reached from
    /// Rooms, so it can be captured headless.
    private func openDebugPush() {
        guard NativeFixtures.enabled, store.path(for: .rooms).wrappedValue.isEmpty else { return }
        let defaults = UserDefaults.standard
        switch defaults.string(forKey: "RoosterPush") ?? defaults.string(forKey: "RoosterScreen") {
        case "chat": store.push(.native(.chatRoom), in: .rooms)
        case "golive": goingLive = true
        default: break
        }
    }
    #endif
}

/// A live room, drawn like the concept's LIVE NOW card: the host's photo behind the right side,
/// the pill, the title, who is hosting and how many are in.
private struct LiveRoomCard: View {
    let room: LiveRooms.Room
    let openHost: () -> Void
    let join: () -> Void
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        ZStack(alignment: .leading) {
            backdrop
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    LivePill(text: "LIVE NOW", filled: false)
                    Label(medium, systemImage: room.isVideo ? "video.fill" : "mic.fill")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Theme.muted)
                        .padding(.horizontal, 9).padding(.vertical, 5)
                        .background(Theme.raised.opacity(0.9), in: Capsule())
                }
                Text(room.title)
                    .font(.roosterDisplay(17, relativeTo: .headline))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 250, alignment: .leading)
                if let description = room.description, !description.isEmpty {
                    Text(description)
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.ink.opacity(0.75))
                        .lineLimit(2)
                        .frame(maxWidth: 250, alignment: .leading)
                }
                HStack(spacing: 10) {
                    Button(action: openHost) {
                        HStack(spacing: 8) {
                            AvatarStack(people: [(name: room.hostName, photo: room.hostPhotoUrl)], size: 28)
                            Text(room.hostName)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.ink)
                                .lineLimit(1)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(room.hostName)'s profile")
                    Label(counts, systemImage: room.isVideo ? "eye" : "person.2")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Button(action: join) {
                        Text(room.isVideo ? "Watch" : "Join")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 18)
                            .frame(height: 36)
                            .background(Theme.red, in: Capsule())
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityLabel(room.isVideo ? "Watch \(room.title)" : "Join \(room.title)")
                }
            }
            .padding(16)
        }
        .frame(maxWidth: .infinity, minHeight: 168, alignment: .leading)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous).stroke(Theme.line))
        .contentShape(RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous))
        .onTapGesture(perform: join)
    }

    /// The host's photo fills the right of the card and fades into it, as in the concept.
    private var backdrop: some View {
        GeometryReader { proxy in
            HStack(spacing: 0) {
                Spacer(minLength: 0)
                RemoteImage(url: room.hostPhotoUrl.flatMap { store.siteURL($0) }, size: 320) { Color.clear }
                    .frame(width: proxy.size.width * 0.6, height: proxy.size.height)
                    .clipped()
                    .overlay(
                        LinearGradient(stops: [.init(color: Theme.surface, location: 0),
                                               .init(color: Theme.surface.opacity(0.55), location: 0.45),
                                               .init(color: Theme.surface.opacity(0.15), location: 1)],
                                       startPoint: .leading, endPoint: .trailing)
                    )
            }
        }
        .accessibilityHidden(true)
    }

    private var medium: String {
        if room.isVideo { return "Video" }
        if let speakers = room.speakerCount, speakers > 0 { return "\(speakers) on the mic" }
        return "Audio"
    }

    private var counts: String {
        let people = room.participantCount ?? 0
        if room.isVideo { return "\(people) watching" }
        return "\(room.listenerCount ?? people) listening"
    }
}

private struct RoomShortcut: View {
    let title: String
    let symbol: String
    let subtitle: String
    let waveform: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: symbol)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Theme.red)
                    .frame(width: 50, height: 50)
                    .background(Theme.red.opacity(0.14), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                VStack(alignment: .leading, spacing: 5) {
                    Text(title.uppercased())
                        .font(.roosterDisplay(14, relativeTo: .headline))
                        .tracking(0.8)
                        .foregroundStyle(Theme.ink)
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                if waveform {
                    WaveformBars(seed: 11, progress: 0.4, bars: 14, height: 26)
                        .frame(width: 58)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .designCard(padding: 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
    }
}
