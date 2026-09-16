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

/// The People tab, native: search, people to build with, and the roster.
struct PeopleView: View {
    @EnvironmentObject private var store: ShellStore
    @EnvironmentObject private var session: SessionModel
    @ObservedObject var model: PeopleModel
    @State private var notice: String?
    @State private var browser: BrowserDestination?

    var body: some View {
        NavigationStack(path: store.path(for: .people)) {
            ScrollViewReader { proxy in
                List {
                    if !model.matches.isEmpty || (!model.isSearching && model.viewer != nil && !model.members.isEmpty) {
                        Section { suggestions } .listRowInsets(EdgeInsets()).listRowBackground(Color.clear).listRowSeparator(.hidden)
                    }
                    Section {
                        if model.isLoading {
                            LoadingRows().listRowBackground(Theme.surface)
                        } else if let failure = model.failure, model.members.isEmpty {
                            ErrorState(message: failure.message) { retry(after: failure) }.listRowBackground(Color.clear)
                        } else if model.members.isEmpty {
                            empty.listRowBackground(Color.clear)
                        } else {
                            ForEach(model.members) { member in
                                MemberRow(member: member, state: model.stateChanges[member.id] ?? member.relationshipState,
                                                      open: open, request: { connect(member) })
                                    .id(member.id)
                                    .listRowBackground(Theme.surface)
                                    .onAppear { model.loadMoreIfNeeded(after: member) }
                            }
                            if model.isLoadingMore {
                                ProgressView().tint(Theme.red).frame(maxWidth: .infinity).listRowBackground(Color.clear)
                            }
                        }
                    } header: {
                        if !model.isLoading && !model.members.isEmpty {
                            HStack {
                                Text(model.isSearching ? "Results" : "Newest on the roster")
                                Spacer()
                                if let total = model.total, !model.isSearching { Text("\(total) on the roster") }
                            }
                            .font(.system(size: 13, weight: .semibold))
                            .textCase(nil)
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(Theme.background)
                .refreshable { await model.load() }
                .onChange(of: model.scrollTarget) { _, target in
                    guard let target else { return }
                    withAnimation(.snappy) { proxy.scrollTo(target, anchor: .top) }
                    model.scrollTarget = nil
                }
            }
            .navigationTitle("People")
            // Inline like every tab; the app's bar appearance leaves large titles blank at rest.
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $model.query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search the roster")
            .onChange(of: model.query) { _, _ in model.searchChanged() }
            .notice($notice)
            .navigationDestination(for: AppRoute.self) { route in
                AppRouteView(route: route, stack: .people)
            }
        }
        .sheet(item: $browser) { SafariView(url: $0.url).ignoresSafeArea() }
        .onAppear(perform: model.startIfNeeded)
    }

    private var suggestions: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading(eyebrow: "YOUR NEXT CONNECTION", title: "People to build with")
                .padding(.horizontal, 20)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Professions.Goal.allCases) { goal in
                        Button {
                            withAnimation(.snappy) { model.goal = goal }
                        } label: {
                            Text(goal.title)
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(model.goal == goal ? .white : Theme.ink)
                                .padding(.horizontal, 14)
                                .frame(height: 34)
                                .background(model.goal == goal ? Theme.red : Theme.surface, in: Capsule())
                                .overlay(Capsule().stroke(Color(uiColor: Theme.uiLine), lineWidth: model.goal == goal ? 0 : 1))
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(model.goal == goal ? .isSelected : [])
                    }
                }
                .padding(.horizontal, 20)
            }
            if model.matches.isEmpty {
                Text(model.viewer?.profession == nil && model.goal == .all
                     ? "Choose a goal above, or add what you do to your profile, to find people with skills that fit."
                     : "No new matches here yet. Try another goal.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 20)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(model.matches) { match in
                            MatchCard(match: match, open: open, dismiss: { model.dismiss(match) })
                                .transition(.scale(scale: 0.9).combined(with: .opacity))
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 4)
                }
            }
        }
        .padding(.top, 4)
        .padding(.bottom, 8)
    }

    private var empty: some View {
        VStack(spacing: 8) {
            Image(systemName: "person.2.slash").font(.system(size: 28, weight: .semibold)).foregroundStyle(Theme.muted)
            Text(model.isSearching ? "No one on the roster by that name." : "The roster is empty right now.")
                .font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 30)
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
}

private struct MemberRow: View {
    let member: DirectoryMember
    let state: Relationship
    let open: (String) -> Void
    let request: () -> Void

    var body: some View {
        Button { open(member.profilePath) } label: {
            HStack(spacing: 14) {
                MemberAvatar(name: member.name, photoPath: member.photoUrl, size: 52, online: member.online)
                VStack(alignment: .leading, spacing: 3) {
                    Text(member.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                    if let work = member.workLabel {
                        Text(work).font(.system(size: 14)).foregroundStyle(Theme.muted).lineLimit(1)
                    }
                    if let place = member.shortLocation {
                        HStack(spacing: 3) {
                            Image(systemName: "mappin.circle.fill").font(.system(size: 11))
                            Text(place).lineLimit(1)
                        }
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.muted.opacity(0.85))
                    }
                }
                Spacer(minLength: 8)
                RelationshipControl(state: state, request: request, review: { open("/members.html#friend-requests") })
            }
            .padding(.vertical, 5)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            if state != .self {
                Button { open("/members.html?to=\(member.id)#member-mail") } label: { Label("Send message", systemImage: "bubble.left.and.bubble.right") }
            }
            Button { open(member.profilePath) } label: { Label("View profile", systemImage: "person.crop.circle") }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens their profile")
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
                    .foregroundStyle(Theme.red)
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .overlay(Capsule().stroke(Theme.red.opacity(0.45)))
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Add to my roster")
        case .incoming:
            Button(action: review) {
                Text("Review")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .background(Theme.red, in: Capsule())
            }
            .buttonStyle(.borderless)
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
        }
    }
}

private struct MatchCard: View {
    let match: ConnectionMatch
    let open: (String) -> Void
    let dismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                MemberAvatar(name: match.member.name, photoPath: match.member.photoUrl, size: 50, online: match.member.online)
                VStack(alignment: .leading, spacing: 2) {
                    Text(match.member.name).font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.ink).lineLimit(1)
                    Text(Professions.shortLabels[match.member.profession ?? ""] ?? "").font(.system(size: 13)).foregroundStyle(Theme.muted).lineLimit(1)
                }
            }
            Text(match.reason)
                .font(.system(size: 14))
                .foregroundStyle(Theme.ink.opacity(0.85))
                .lineLimit(2, reservesSpace: true)
            if match.sameCity {
                HStack(spacing: 4) {
                    Image(systemName: "mappin.circle.fill")
                    Text("Same area on your profiles")
                }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color(hex: 0x2F7A45))
            }
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                Button { open(match.member.profilePath) } label: {
                    Text("View & connect")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 38)
                        .background(Theme.red, in: Capsule())
                }
                .buttonStyle(PressableStyle())
                Button("Not now", action: dismiss)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.muted)
                    .frame(minHeight: 38)
                    .padding(.horizontal, 4)
            }
        }
        .padding(16)
        .frame(width: 268, height: 214, alignment: .topLeading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color(uiColor: Theme.uiLine)))
    }
}
