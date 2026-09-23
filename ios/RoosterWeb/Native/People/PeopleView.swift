import SwiftUI

@MainActor
final class PeopleModel: ObservableObject {
    @Published var query = ""
    @Published private(set) var members: [DirectoryMember] = []
    @Published private(set) var total: Int?
    @Published private(set) var viewer: DirectoryPage.Context.Viewer?
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false
    @Published private(set) var failure: FeedError?
    @Published var goal: Professions.Goal = .all
    @Published private(set) var dismissed: Set<String> = []
    /// Where a roster request left things, for rows loaded before it was sent.
    @Published private(set) var stateChanges: [String: Relationship] = [:]
    @Published var scrollTarget: String?

    private let api: FeedAPI
    private var nextOffset: Int?
    private var generation = 0
    private var hasLoaded = false

    init(api: FeedAPI) {
        self.api = api
    }

    var isSearching: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }

    /// Up to three people to build with, only on the unfiltered list (people-connections.js update()).
    var matches: [ConnectionMatch] {
        guard !isSearching else { return [] }
        return Array(Connections.rank(members, viewer: viewer, goal: goal, dismissed: dismissed).prefix(3))
    }

    func startIfNeeded() {
        guard !hasLoaded else { return }
        hasLoaded = true
        Task { await load() }
    }

    func load() async {
        generation += 1
        let current = generation
        isLoading = members.isEmpty
        failure = nil
        #if DEBUG
        if let fixture = NativeFixtures.directory(query: query) {
            members = fixture.members; total = fixture.total; viewer = fixture.connectionContext?.viewer; nextOffset = nil
            isLoading = false
            return
        }
        #endif
        do {
            let page = try await api.get(path(offset: 0), as: DirectoryPage.self)
            guard current == generation else { return }
            members = page.members
            total = page.total
            if let context = page.connectionContext, context.ready { viewer = context.viewer }
            nextOffset = page.nextOffset
        } catch let error as FeedError {
            guard current == generation else { return }
            failure = error
        } catch {}
        if current == generation { isLoading = false }
    }

    func searchChanged() {
        Task {
            let typed = query
            try? await Task.sleep(for: .milliseconds(350))
            guard typed == query else { return }
            members = []
            await load()
        }
    }

    func loadMoreIfNeeded(after member: DirectoryMember) {
        guard let offset = nextOffset, !isLoadingMore, members.last?.id == member.id else { return }
        isLoadingMore = true
        let current = generation
        Task {
            defer { if current == generation { isLoadingMore = false } }
            guard let page = try? await api.get(path(offset: offset), as: DirectoryPage.self), current == generation else { return }
            let known = Set(members.map(\.id))
            members += page.members.filter { !known.contains($0.id) }
            nextOffset = page.nextOffset
        }
    }

    /// Asks to be on someone's roster, and remembers what the site made of it.
    func connect(_ member: DirectoryMember) async -> String {
        let outcome = await ConnectionActions(api: api).request(member.id)
        if let state = outcome.state { stateChanges[member.id] = state }
        return outcome.message
    }

    func dismiss(_ match: ConnectionMatch) {
        withAnimation(.snappy) { _ = dismissed.insert(match.member.id) }
    }

    private func path(offset: Int) -> String {
        var path = "/api/members?limit=24&offset=\(offset)"
        let trimmed = String(query.trimmingCharacters(in: .whitespaces).prefix(60))
        if !trimmed.isEmpty, let encoded = trimmed.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "&q=\(encoded)"
        }
        return path
    }
}

/// The Discover tab: search the roster, who is on right now, people to build with, the rest of
/// ROOSTER to explore, and the newest members.
struct PeopleView: View {
    @EnvironmentObject private var store: ShellStore
    @EnvironmentObject private var session: SessionModel
    @ObservedObject var model: PeopleModel
    @State private var notice: String?
    @State private var browser: BrowserDestination?
    @FocusState private var searching: Bool
    #if DEBUG
    @State private var debugJump: String?
    #endif

    private static let topAnchor = "discover-top"
    /// The site's discovery pages that the tab bar has no room for.
    private static let explore: [ShellDestination] = [.topRosters, .opportunities, .booking, .radio]

    var body: some View {
        NavigationStack(path: store.path(for: .people)) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        header.id(Self.topAnchor)
                        searchField
                            .padding(.horizontal, Design.gutter)
                            .padding(.top, 16)

                        if !model.isSearching {
                            if !online.isEmpty {
                                onlineNow.padding(.top, 26)
                            }
                            if model.viewer != nil && !model.members.isEmpty {
                                suggestions.padding(.top, 26)
                            }
                            exploreGrid.padding(.top, 26).id("discover-explore")
                        }

                        roster.padding(.top, 26)
                    }
                    .padding(.top, 8)
                    .padding(.bottom, Design.tabBarClearance)
                }
                .scrollDismissesKeyboard(.interactively)
                .debugScrollToBottom()
                .background(Theme.background)
                .refreshable { await model.load() }
                .onChange(of: model.scrollTarget) { _, target in
                    guard target != nil else { return }
                    withAnimation(.snappy) { proxy.scrollTo(Self.topAnchor, anchor: .top) }
                    model.scrollTarget = nil
                }
                #if DEBUG
                .onChange(of: debugJump) { _, anchor in
                    if let anchor { proxy.scrollTo(anchor, anchor: .top) }
                }
                #endif
            }
            .statusBarScrim()
            .toolbar(.hidden, for: .navigationBar)
            .notice($notice)
            .navigationDestination(for: AppRoute.self) { route in
                AppRouteView(route: route, stack: .people)
            }
        }
        .sheet(item: $browser) { SafariView(url: $0.url).ignoresSafeArea() }
        .onAppear(perform: model.startIfNeeded)
        .onChange(of: model.query) { _, _ in model.searchChanged() }
        #if DEBUG
        .task { openDebugPush() }
        #endif
    }

    // MARK: Sections

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 6) {
                RoosterWordmark(size: 18)
                ScreenTitle(text: "Discover")
                Text(subtitle)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.muted)
            }
            Spacer(minLength: 12)
            InboxButton(unread: store.unread) { store.push(.native(.messages), in: .people) }
                .padding(.top, 2)
        }
        .padding(.horizontal, Design.gutter)
    }

    private var subtitle: String {
        if let total = model.total, total > 0 { return "\(total.formatted()) on the roster. Find your people." }
        return "Find your people. Build your circle."
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.muted)
            TextField("", text: $model.query, prompt: Text("Search the roster").foregroundStyle(Theme.muted))
                .font(.system(size: 16))
                .foregroundStyle(Theme.ink)
                .tint(Theme.red)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($searching)
            if !model.query.isEmpty {
                Button { model.query = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 17))
                        .foregroundStyle(Theme.muted)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .frame(minHeight: 50)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(searching ? Theme.red.opacity(0.6) : Theme.line))
        .contentShape(Rectangle())
        .onTapGesture { searching = true }
    }

    /// Members the directory reports as online right now.
    private var online: [DirectoryMember] {
        model.members.filter { $0.online == true }
    }

    private var onlineNow: some View {
        VStack(alignment: .leading, spacing: 14) {
            DesignSectionHeader(title: "On right now", dot: true)
                .padding(.horizontal, Design.gutter)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 16) {
                    ForEach(online) { member in
                        Button { open(member.profilePath) } label: {
                            VStack(spacing: 10) {
                                RingAvatar(name: member.name, photoPath: member.photoUrl, size: 62)
                                Text(firstName(member.name))
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(Theme.ink)
                                    .lineLimit(1)
                            }
                            .frame(width: 74)
                        }
                        .buttonStyle(PressableStyle())
                        .accessibilityLabel("\(member.name), online")
                    }
                }
                .padding(.horizontal, Design.gutter)
                .padding(.vertical, 6)
            }
        }
    }

    private var suggestions: some View {
        VStack(alignment: .leading, spacing: 14) {
            DesignSectionHeader(title: "People to build with")
                .padding(.horizontal, Design.gutter)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Professions.Goal.allCases) { goal in
                        RosterFilterChip(title: goal.title, selected: model.goal == goal) {
                            withAnimation(.snappy) { model.goal = goal }
                        }
                    }
                }
                .padding(.horizontal, Design.gutter)
            }
            if model.matches.isEmpty {
                Text(model.viewer?.profession == nil && model.goal == .all
                     ? "Choose a goal above, or add what you do to your profile, to find people with skills that fit."
                     : "No new matches here yet. Try another goal.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .designCard(padding: 16)
                    .padding(.horizontal, Design.gutter)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(model.matches) { match in
                            MatchCard(match: match, open: open, dismiss: { model.dismiss(match) })
                                .transition(.scale(scale: 0.9).combined(with: .opacity))
                        }
                    }
                    .padding(.horizontal, Design.gutter)
                    .padding(.vertical, 2)
                }
            }
        }
    }

    private var exploreGrid: some View {
        VStack(alignment: .leading, spacing: 14) {
            DesignSectionHeader(title: "Explore")
                .padding(.horizontal, Design.gutter)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ForEach(Self.explore) { destination in
                    Button { store.push(destination, in: .people) } label: {
                        ExploreTile(destination: destination)
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            .padding(.horizontal, Design.gutter)
        }
    }

    @ViewBuilder private var roster: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                DesignSectionHeader(title: model.isSearching ? "Results" : "Newest on the roster")
                if let total = model.total, !model.isSearching, !model.members.isEmpty {
                    Text("\(total.formatted()) members")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.muted)
                        .fixedSize()
                }
            }
            .padding(.horizontal, Design.gutter)

            if model.isLoading {
                LoadingRows().padding(.horizontal, 16).designCard(padding: 0).padding(.horizontal, Design.gutter)
            } else if let failure = model.failure, model.members.isEmpty {
                ErrorState(message: failure.message) { retry(after: failure) }
                    .designCard(padding: 0)
                    .padding(.horizontal, Design.gutter)
            } else if model.members.isEmpty {
                empty.padding(.horizontal, Design.gutter)
            } else {
                LazyVStack(spacing: 10) {
                    ForEach(model.members) { member in
                        MemberRow(member: member, state: model.stateChanges[member.id] ?? member.relationshipState,
                                  open: open, request: { connect(member) })
                            .id(member.id)
                            .onAppear { model.loadMoreIfNeeded(after: member) }
                    }
                    if model.isLoadingMore {
                        ProgressView().tint(Theme.red).frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                }
                .padding(.horizontal, Design.gutter)
            }
        }
    }

    private var empty: some View {
        VStack(spacing: 10) {
            Image(systemName: "person.2.slash").font(.system(size: 28, weight: .semibold)).foregroundStyle(Theme.muted)
            Text(model.isSearching ? "No one on the roster by that name." : "The roster is empty right now.")
                .font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
        .designCard()
    }

    // MARK: Actions

    private func firstName(_ name: String) -> String {
        name.split(separator: " ").first.map(String.init) ?? name
    }

    private func connect(_ member: DirectoryMember) {
        Task { notice = await model.connect(member) }
    }

    private func retry(after failure: FeedError) {
        if case .locked = failure { session.revalidate() }
        Task { await model.load() }
    }

    private func open(_ link: String) {
        if let external = store.open(link, from: .people) { browser = BrowserDestination(url: external) }
    }

    #if DEBUG
    /// `-RoosterScreen discover -RoosterPush messages|thread|requests|explore|search|<ShellDestination>`
    /// (fixtures only) opens a screen reached from Discover, so it can be captured headless.
    private func openDebugPush() {
        guard NativeFixtures.enabled, store.path(for: .people).wrappedValue.isEmpty else { return }
        let defaults = UserDefaults.standard
        let name = defaults.string(forKey: "RoosterPush") ?? defaults.string(forKey: "RoosterScreen")
        switch name {
        case "messages":
            store.selection = .people
            store.push(.native(.messages), in: .people)
        case "thread":
            store.selection = .people
            store.push(.native(.conversation(memberID: "4b1d7c2e-1111-4a6b-9c3d-000000000002", name: "Marcus Lane")), in: .people)
        case "requests":
            store.selection = .people
            store.push(.native(.requests), in: .people)
        case "explore":
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                debugJump = "discover-explore"
            }
        case "search":
            model.query = "Ma"
        case let other?:
            // Any More destination by name: topRosters, opportunities, booking, account, about…
            if let destination = ShellDestination(rawValue: other) {
                store.selection = .people
                store.push(destination, in: .people)
            }
        default:
            break
        }
    }
    #endif
}

/// The envelope with the unread count, top right of Discover.
private struct InboxButton: View {
    /// Observed here: the store doesn't republish its models' changes.
    @ObservedObject var unread: UnreadCounter
    let action: () -> Void

    var body: some View {
        let count = unread.count
        Button(action: action) {
            Image(systemName: "envelope")
                .font(.system(size: 19, weight: .medium))
                .foregroundStyle(Theme.ink)
                .frame(width: 46, height: 46)
                .background(Theme.raised, in: Circle())
                .overlay(Circle().stroke(Theme.line))
                .overlay(alignment: .topTrailing) {
                    if count > 0 {
                        Text(count > 99 ? "99+" : "\(count)")
                            .font(.system(size: 11, weight: .heavy))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 5)
                            .frame(minWidth: 20, minHeight: 20)
                            .background(Theme.red, in: Capsule())
                            .overlay(Capsule().stroke(Theme.background, lineWidth: 2))
                            .offset(x: 5, y: -4)
                    }
                }
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(count > 0 ? "Messages, \(count) unread" : "Messages")
    }
}

/// A filter chip: red when chosen, raised grey otherwise.
struct RosterFilterChip: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(selected ? .white : Theme.ink.opacity(0.85))
                .padding(.horizontal, 16)
                .frame(height: 36)
                .background(selected ? Theme.red : Theme.raised, in: Capsule())
                .overlay(Capsule().stroke(selected ? .clear : Theme.line))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct ExploreTile: View {
    let destination: ShellDestination

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: destination.symbol)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Theme.red)
                .frame(width: 40, height: 40)
                .background(Theme.red.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(destination.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                Text(destination.tagline)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(2, reservesSpace: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .designCard(padding: 14, radius: 18)
        .contentShape(Rectangle())
    }
}

private struct MemberRow: View {
    let member: DirectoryMember
    let state: Relationship
    let open: (String) -> Void
    let request: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            Button { open(member.profilePath) } label: {
                HStack(spacing: 14) {
                    MemberAvatar(name: member.name, photoPath: member.photoUrl, size: 54, online: member.online)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(member.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                        if let work = member.workLabel {
                            Text(work).font(.system(size: 14)).foregroundStyle(Theme.muted).lineLimit(1)
                        }
                        if let place = member.shortLocation {
                            HStack(spacing: 3) {
                                Image(systemName: "mappin").font(.system(size: 10, weight: .semibold))
                                Text(place).lineLimit(1)
                            }
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.muted.opacity(0.85))
                        }
                    }
                    Spacer(minLength: 8)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityHint("Opens their profile")
            RelationshipControl(state: state, request: request, review: { open("/members.html#friend-requests") })
        }
        .designCard(padding: 12, radius: 18)
        .contextMenu {
            if state != .self {
                Button { open("/members.html?to=\(member.id)#member-mail") } label: { Label("Send message", systemImage: "bubble.left.and.bubble.right") }
            }
            Button { open(member.profilePath) } label: { Label("View profile", systemImage: "person.crop.circle") }
        }
    }
}

/// The roster action for a member: Add, Review, or where things stand (community.js:53-56).
private struct RelationshipControl: View {
    let state: Relationship
    let request: () -> Void
    let review: () -> Void

    var body: some View {
        switch state {
        case .none:
            Button(action: request) {
                Label("Add", systemImage: "plus").labelStyle(.titleAndIcon)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 14)
                    .frame(height: 34)
                    .background(Theme.raised, in: Capsule())
                    .overlay(Capsule().stroke(Theme.red.opacity(0.55)))
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("Add to my roster")
        case .incoming:
            Button(action: review) {
                Text("Review")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .frame(height: 34)
                    .background(Theme.red, in: Capsule())
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("Review their roster request")
        default:
            let label: (String, String) = switch state {
            case .accepted: ("Connected", "checkmark")
            case .outgoing: ("Requested", "clock")
            case .following: ("Following", "star")
            case .declined: ("Closed", "xmark")
            default: ("You", "person.fill")
            }
            Label(label.0, systemImage: label.1)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.muted)
                .padding(.horizontal, 10)
                .frame(height: 30)
                .background(Theme.raised, in: Capsule())
        }
    }
}

/// A person to build with: their photo big, why they fit, and the way to connect.
private struct MatchCard: View {
    let match: ConnectionMatch
    let open: (String) -> Void
    let dismiss: () -> Void
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                RemoteImage(url: match.member.photoUrl.flatMap { store.siteURL($0) }, size: 260) {
                    ZStack {
                        LinearGradient(colors: [Theme.raised, Theme.surface], startPoint: .top, endPoint: .bottom)
                        MemberAvatar(name: match.member.name, photoPath: nil, size: 84)
                    }
                }
                .frame(width: 256, height: 176)
                .clipped()
                LinearGradient(colors: [.clear, Theme.surface.opacity(0.35), Theme.surface], startPoint: .top, endPoint: .bottom)
                    .frame(height: 96)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(match.member.name)
                            .font(.rooster(20))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                        if match.member.online == true {
                            Circle().fill(Theme.green).frame(width: 8, height: 8).accessibilityLabel("Online")
                        }
                    }
                    Text(Professions.shortLabels[match.member.profession ?? ""] ?? "")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 8)
            }
            .frame(width: 256, height: 176)
            .contentShape(Rectangle())
            .onTapGesture { open(match.member.profilePath) }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)

            VStack(alignment: .leading, spacing: 10) {
                Text(match.reason)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.ink.opacity(0.85))
                    .lineLimit(2, reservesSpace: true)
                if match.sameCity {
                    Label("Same area on your profiles", systemImage: "mappin")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.green)
                }
                Spacer(minLength: 0)
                HStack(spacing: 8) {
                    Button { open(match.member.profilePath) } label: {
                        Text("View & connect")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, minHeight: 40)
                            .background(Theme.red, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(PressableStyle())
                    Button(action: dismiss) {
                        Text("Not now")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.ink.opacity(0.85))
                            .padding(.horizontal, 14)
                            .frame(minHeight: 40)
                            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            .padding(14)
        }
        .frame(width: 256, height: 318, alignment: .top)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous).stroke(Theme.line))
    }
}
