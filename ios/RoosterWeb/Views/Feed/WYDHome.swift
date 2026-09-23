import SwiftUI

/// The one site colour other screens still borrow (the create sheets' red).
enum SiteColor {
    static let slotsRed = Color(hex: 0xED1739)
}

/// Home's measurements, taken from design/world-class-concept/home.png at 402pt. Everything else
/// comes from `Design` and `Theme`.
enum HomeLayout {
    /// Media cards are a little taller than wide, so one post and the LIVE NOW card below it
    /// share the first screen above the tab bar, as in the concept.
    static let mediaAspect: CGFloat = 1.06
    static let wordmark: CGFloat = 19
    static let title: CGFloat = 28
    static let feedSpacing: CGFloat = 12
    static let circleAvatar: CGFloat = 48
    static let circleColumn: CGFloat = 64
    static let barIcon: CGFloat = 22
    static let orb: CGFloat = 26
}

// MARK: - Top bar

/// ROOSTER on the left; Search, MONA and the inbox on the right.
struct HomeTopBar: View {
    @ObservedObject var unread: UnreadCounter
    let search: () -> Void
    let mona: () -> Void
    let inbox: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            RoosterWordmark(size: HomeLayout.wordmark)
            Spacer(minLength: 8)
            iconButton("magnifyingglass", label: "Search ROOSTER", action: search)
            Button(action: mona) {
                MonaOrb(size: HomeLayout.orb)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("MONA, your studio assistant")
            Button(action: inbox) {
                Image(systemName: "envelope")
                    .font(.system(size: HomeLayout.barIcon, weight: .medium))
                    .foregroundStyle(Theme.ink)
                    .frame(width: 44, height: 44)
                    .overlay(alignment: .topTrailing) {
                        if unread.count > 0 {
                            Text(unread.count > 99 ? "99+" : "\(unread.count)")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 5)
                                .frame(minWidth: 19, minHeight: 19)
                                .background(Theme.red, in: Capsule())
                                .overlay(Capsule().stroke(Theme.background, lineWidth: 2))
                                .offset(x: 1, y: 3)
                        }
                    }
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel(unread.count > 0 ? "Inbox, \(unread.count) unread" : "Inbox")
        }
        .padding(.leading, Design.gutter)
        .padding(.trailing, Design.gutter - 10)
        .frame(height: 44)
    }

    private func iconButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: HomeLayout.barIcon - 2, weight: .medium))
                .foregroundStyle(Theme.ink)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
    }
}

// MARK: - Title

/// "WYD", its tagline, and which feed you are reading (Following · For You · Live rooms).
struct HomeIntro: View {
    @ObservedObject var model: FeedModel
    let live: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .center) {
                ScreenTitle(text: "WYD", size: HomeLayout.title)
                Spacer(minLength: 8)
                laneMenu
            }
            Text("Real people. Real music. No gatekeepers.")
                .font(.system(size: 13))
                .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, Design.gutter)
    }

    private var laneMenu: some View {
        Menu {
            Picker("Show", selection: Binding(get: { model.lane }, set: { lane in
                withAnimation(.snappy(duration: 0.25)) { model.select(lane) }
            })) {
                ForEach(FeedModel.Lane.allCases) { lane in
                    Text(lane.title).tag(lane)
                }
            }
            Button(action: live) {
                Label("Live rooms", systemImage: "dot.radiowaves.left.and.right")
            }
        } label: {
            HStack(spacing: 5) {
                Text(model.lane.title)
                Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold))
            }
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 12)
            .frame(minHeight: 34)
            .background(Theme.raised, in: Capsule())
            .overlay(Capsule().stroke(Theme.line))
            .contentShape(Capsule())
        }
        .accessibilityLabel("Feed: \(model.lane.title)")
        .accessibilityHint("Choose Following, For You or live rooms")
    }
}

// MARK: - Top 8 (your inner circle)

@MainActor
final class TopEightModel: ObservableObject, Identifiable {
    @Published private(set) var value: TopEight?
    @Published private(set) var loading = false
    @Published private(set) var failure: String?
    let actions: SiteActions

    init(api: FeedAPI) { actions = SiteActions(api: api) }

    func load() async {
        #if DEBUG
        if let fixture = HomeFixtures.topEight() ?? NativeFixtures.myTopEight() { value = fixture; return }
        #endif
        loading = true
        defer { loading = false }
        do {
            value = try await actions.topEight()
            failure = nil
        } catch FeedError.locked {
            failure = "Log in to see your Top 8 Roster."
        } catch {
            failure = value == nil ? "Your Top 8 didn't load." : nil
        }
    }

    func save(_ order: [String]) async -> FeedError? {
        switch await actions.saveTopEight(order) {
        case .success(let saved):
            value = saved
            return nil
        case .failure(let error):
            return error
        }
    }

    /// Under the row: "Community picks" until you arrange it yourself (top-eight-roster.js).
    var status: String? {
        if loading && value == nil { return "Opening your Top 8…" }
        if let failure { return failure }
        guard let value else { return nil }
        if value.members.isEmpty {
            return value.editable == true ? "Choose people with Edit Top 8." : "No Top 8 picks yet."
        }
        return value.mode == "community" ? "Community picks · Make it yours with Edit Top 8." : nil
    }
}

/// Who is live right now (/api/live/rooms): the LIVE NOW card and the LIVE tabs on the circle.
@MainActor
final class LiveNowModel: ObservableObject {
    @Published private(set) var rooms: [LiveRooms.Room] = []
    private let api: FeedAPI

    init(api: FeedAPI) { self.api = api }

    func load() async {
        #if DEBUG
        if let fixture = NativeFixtures.rooms() { rooms = fixture.rooms; return }
        #endif
        // A failed read leaves the last list; nobody is shown live on a guess.
        if let fresh = try? await api.get("/api/live/rooms", as: LiveRooms.self) {
            rooms = fresh.rooms
        }
    }

    /// The busiest room leads the feed.
    var featured: LiveRooms.Room? {
        rooms.max { ($0.participantCount ?? 0) < ($1.participantCount ?? 0) }
    }

    func room(hostedBy memberID: String) -> LiveRooms.Room? {
        rooms.first { $0.hostId == memberID }
    }
}

/// "• INNER CIRCLE  See all ›" over a row of ringed faces; the ones hosting a room wear LIVE.
struct InnerCircleRow: View {
    @ObservedObject var model: TopEightModel
    @ObservedObject var live: LiveNowModel
    let open: (String) -> Void
    let openRoom: (LiveRooms.Room) -> Void
    let seeAll: () -> Void
    let edit: () -> Void

    private var members: [TopEight.Card] { Array((model.value?.members ?? []).prefix(8)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            InnerCircleHeader(seeAll: seeAll)
                .padding(.horizontal, Design.gutter)

            if !members.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 0) {
                        ForEach(Array(members.enumerated()), id: \.element.id) { index, person in
                            face(person, rank: index + 1)
                        }
                    }
                    .padding(.horizontal, Design.gutter - (HomeLayout.circleColumn - HomeLayout.circleAvatar - 6) / 2)
                }
                .scrollClipDisabled()
            }

            if let status = model.status {
                Text(status)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, Design.gutter)
            }
        }
    }

    private func face(_ person: TopEight.Card, rank: Int) -> some View {
        let room = live.room(hostedBy: person.id)
        let profile = person.profileUrl ?? "/profile.html?id=\(person.id)"
        return Button {
            if let room { openRoom(room) } else { open(profile) }
        } label: {
            // The LIVE tab hangs 6pt under the ring, so the name starts just below it.
            VStack(spacing: 8) {
                RingAvatar(name: person.name, photoPath: person.photoUrl, size: HomeLayout.circleAvatar,
                           ring: room != nil, live: room != nil)
                // The whole name when it fits, else the first name, as the concept shows them.
                ViewThatFits(in: .horizontal) {
                    Text(person.name)
                    Text(person.name.split(separator: " ").first.map(String.init) ?? person.name)
                    Text(person.name).truncationMode(.tail)
                }
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .frame(width: HomeLayout.circleColumn - 2)
            }
            .frame(width: HomeLayout.circleColumn)
            .padding(.top, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(room != nil ? "\(rank). \(person.name), live now" : "\(rank). \(person.name)")
        .accessibilityHint(room != nil ? "Joins their room" : "Opens their profile")
        .contextMenu {
            Button { open(profile) } label: { Label("Open profile", systemImage: "person.crop.circle") }
            if let room {
                Button { openRoom(room) } label: { Label("Join their room", systemImage: "dot.radiowaves.left.and.right") }
            }
            if model.value?.editable == true {
                Button(action: edit) { Label("Edit Top 8", systemImage: "list.number") }
            }
        }
    }
}

/// The concept's small section label: a red dot, INNER CIRCLE, and See all on the right. Smaller
/// than DesignSectionHeader, which is sized for the other screens' section titles.
private struct InnerCircleHeader: View {
    let seeAll: () -> Void

    var body: some View {
        HStack(alignment: .center) {
            HStack(spacing: 7) {
                Circle().fill(Theme.red).frame(width: 6, height: 6)
                Text("INNER CIRCLE")
                    .font(.roosterDisplay(11, relativeTo: .caption))
                    .tracking(1.2)
                    .foregroundStyle(Theme.ink.opacity(0.78))
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Inner circle")
            .accessibilityAddTraits(.isHeader)
            Spacer()
            Button(action: seeAll) {
                HStack(spacing: 3) {
                    Text("See all")
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
                }
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.muted)
                .frame(minHeight: 32)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("See all of your inner circle")
        }
    }
}

/// See all: the whole Top 8 in order, with Edit Top 8 when it is yours.
struct InnerCircleSheet: View {
    @ObservedObject var model: TopEightModel
    @ObservedObject var live: LiveNowModel
    let open: (String) -> Void
    let openRoom: (LiveRooms.Room) -> Void
    let edit: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    if let status = model.status {
                        Text(status).font(.system(size: 14)).foregroundStyle(Theme.muted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    ForEach(Array((model.value?.members ?? []).enumerated()), id: \.element.id) { index, person in
                        row(person, rank: index + 1)
                    }
                    if model.value?.editable == true {
                        Button {
                            dismiss()
                            edit()
                        } label: {
                            Label("Edit Top 8", systemImage: "list.number")
                        }
                        .buttonStyle(.designPrimary)
                        .padding(.top, 8)
                    }
                }
                .padding(Design.gutter)
            }
            .background(Theme.background)
            .navigationTitle("Inner circle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Theme.background)
    }

    private func row(_ person: TopEight.Card, rank: Int) -> some View {
        let room = live.room(hostedBy: person.id)
        return Button {
            dismiss()
            if let room { openRoom(room) } else { open(person.profileUrl ?? "/profile.html?id=\(person.id)") }
        } label: {
            HStack(spacing: 12) {
                Text("\(rank)").font(.roosterDisplay(14, relativeTo: .body)).foregroundStyle(Theme.muted)
                    .frame(width: 22)
                RingAvatar(name: person.name, photoPath: person.photoUrl, size: 40, ring: room != nil)
                Text(person.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                Spacer(minLength: 8)
                if room != nil { LivePill(text: "LIVE") }
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.muted)
            }
            .designCard(padding: 12, radius: Design.tileRadius)
        }
        .buttonStyle(PressableStyle())
    }
}

// MARK: - LIVE NOW

/// A live room in the feed: LIVE NOW, its title, the host and how many are listening, with the
/// host's photo fading in from the right.
struct LiveNowCard: View {
    let label: String
    let title: String
    let hostName: String
    let hostPhoto: String?
    let listening: Int?
    let join: () -> Void

    var body: some View {
        Button(action: join) {
            VStack(alignment: .leading, spacing: 0) {
                LivePill(text: label, filled: false)
                Text(title)
                    .font(.roosterDisplay(17, relativeTo: .headline))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .padding(.top, 8)
                HStack(spacing: 10) {
                    AvatarStack(people: [(name: hostName, photo: hostPhoto)], size: 26)
                    Label {
                        Text(listeningText)
                    } icon: {
                        Image(systemName: "person.2")
                    }
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.ink.opacity(0.8))
                    .lineLimit(1)
                }
                .padding(.top, 8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(alignment: .trailing) {
                GeometryReader { proxy in
                    SiteImage(path: hostPhoto)
                        .frame(width: proxy.size.width * 0.55, height: proxy.size.height)
                        .clipped()
                        .mask(LinearGradient(colors: [.clear, .black.opacity(0.85), .black], startPoint: .leading, endPoint: .trailing))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .accessibilityHidden(true)
            }
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous).stroke(Theme.line))
            .contentShape(RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous))
        }
        .buttonStyle(PressableStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label.capitalized): \(title), hosted by \(hostName). \(listeningText)")
        .accessibilityHint("Joins the room")
    }

    private var listeningText: String {
        guard let listening else { return hostName }
        return "\(Compact.string(listening)) listening"
    }
}

struct ScrollOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

struct HeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}
