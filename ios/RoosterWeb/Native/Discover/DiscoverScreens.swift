import SwiftUI

// MARK: - Shared loading

/// Loads one JSON read for a screen and keeps the state a screen needs to draw it.
@MainActor
final class Loadable<Value>: ObservableObject {
    @Published private(set) var value: Value?
    @Published private(set) var failure: FeedError?
    private let fetch: () async throws -> Value
    private var loading = false

    init(_ fetch: @escaping () async throws -> Value) {
        self.fetch = fetch
    }

    func startIfNeeded() {
        guard value == nil, !loading else { return }
        Task { await load() }
    }

    func load() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            value = try await fetch()
            failure = nil
        } catch let error as FeedError {
            failure = error
        } catch {
            failure = .failed("ROOSTER could not connect.")
        }
    }
}

/// Loading, failure and content for a Loadable, with the session renewed on a 401/403.
struct LoadableContent<Value, Content: View>: View {
    @ObservedObject var loadable: Loadable<Value>
    @ViewBuilder let content: (Value) -> Content
    @EnvironmentObject private var session: SessionModel

    var body: some View {
        Group {
            if let value = loadable.value {
                content(value)
            } else if let failure = loadable.failure {
                ErrorState(message: failure.message) {
                    if case .locked = failure { session.revalidate() }
                    Task { await loadable.load() }
                }
                .frame(maxHeight: .infinity)
            } else {
                ProgressView().controlSize(.large).tint(Theme.red).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .onAppear(perform: loadable.startIfNeeded)
    }
}

/// A native screen's link handler: the same routing as a tap on the site.
struct SiteLinkOpener: ViewModifier {
    let stack: ShellTab
    @Binding var link: String?
    @EnvironmentObject private var store: ShellStore
    @State private var browser: BrowserDestination?

    func body(content: Content) -> some View {
        content
            .onChange(of: link) { _, value in
                guard let value else { return }
                link = nil
                if let external = store.open(value, from: stack) { browser = BrowserDestination(url: external) }
            }
            .sheet(item: $browser) { SafariView(url: $0.url).ignoresSafeArea() }
    }
}

extension View {
    func opensSiteLinks(_ link: Binding<String?>, in stack: ShellTab) -> some View {
        modifier(SiteLinkOpener(stack: stack, link: link))
    }

    /// The cream bar and plain top edge every native screen uses.
    func nativeScreenChrome(_ title: String) -> some View {
        self
            .background(Theme.background)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .solidTopEdge()
    }
}

// MARK: - Top Rosters

/// /api/top25 and /api/visitors/featured (profile-visitors.mts:362-381, 539-546).
struct TopRosterChart: Decodable {
    struct Entry: Decodable, Hashable, Identifiable {
        struct Movement: Decodable, Hashable {
            let kind: String
            let places: Int?
            let label: String?
        }
        let position: Int
        let subject: String
        let name: String
        let photoUrl: String?
        let profileUrl: String?
        let visitors: Int
        let movement: Movement?
        let lastWeekPosition: Int?
        var id: String { subject }
    }
    let weekStart: String?
    let updatedAt: String?
    let ranked: Int?
    let entries: [Entry]
}

struct FeaturedWinner: Decodable {
    let featured: TopRosterChart.Entry?
}

struct TopRostersView: View {
    let stack: ShellTab
    @StateObject private var chart: Loadable<(TopRosterChart, TopRosterChart.Entry?)>
    @State private var link: String?

    init(stack: ShellTab, api: FeedAPI) {
        self.stack = stack
        _chart = StateObject(wrappedValue: Loadable {
            async let chart = api.get("/api/top25", as: TopRosterChart.self)
            async let featured = try? api.get("/api/visitors/featured", as: FeaturedWinner.self)
            return (try await chart, await featured?.featured)
        })
    }

    var body: some View {
        LoadableContent(loadable: chart) { value in
            let (chart, featured) = value
            List {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("THE 25 MOST VISITED PAGES THIS WEEK").font(.roosterMono(10)).tracking(1.2).foregroundStyle(Theme.red)
                        Text("Who got the top roster?").font(.rooster(28)).foregroundStyle(Theme.ink)
                        if let week = chart.weekStart, let date = FeedDate.parse(week + "T00:00:00Z") {
                            // week_start is a calendar date; read it in UTC or it lands a day early here.
                            Text("Week of \(date.formatted(Date.FormatStyle(timeZone: TimeZone(identifier: "UTC")!).month(.wide).day().year())) · \(chart.ranked ?? chart.entries.count) ranked")
                                .font(.system(size: 14)).foregroundStyle(Theme.muted)
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 8, trailing: 4))
                }
                if chart.entries.isEmpty {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Nobody has the top roster yet").font(.rooster(20)).foregroundStyle(Theme.ink)
                            Text("No pages have counted a visitor this week. As real visits come in, the Top Rosters build themselves here.")
                                .font(.system(size: 15)).foregroundStyle(Theme.muted)
                        }
                        .padding(.vertical, 6)
                    }
                } else {
                    Section {
                        ForEach(chart.entries) { entry in
                            Button { link = entry.profileUrl ?? "/profile.html?id=\(entry.subject)" } label: { ChartRow(entry: entry) }
                                .buttonStyle(.plain)
                        }
                    }
                }
                if let featured {
                    Section("Last week's top roster") {
                        Button { link = featured.profileUrl ?? "/profile.html?id=\(featured.subject)" } label: {
                            HStack(spacing: 14) {
                                Image(systemName: "trophy.fill").font(.system(size: 22)).foregroundStyle(Theme.gold)
                                MemberAvatar(name: featured.name, photoPath: featured.photoUrl, size: 48)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(featured.name).font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.ink)
                                    Text("\(featured.visitors) visitors").font(.system(size: 13)).foregroundStyle(Theme.muted)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                Section("How the Top Rosters are counted") {
                    ForEach([
                        "Each visitor counts once per profile per week. Refreshing a page does not add another visitor.",
                        "Nobody counts as a visitor to their own page.",
                        "These are estimated unique visitors, not verified individual people.",
                        "Profiles tied on visitors share the same position, and the next profile skips the places they used.",
                        "J.White Did It’s page keeps its own counter and stays out of the Top Rosters.",
                    ], id: \.self) { rule in
                        Text(rule).font(.system(size: 14)).foregroundStyle(Theme.ink.opacity(0.85))
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .refreshable { await self.chart.load() }
        }
        .nativeScreenChrome("Top Rosters")
        .opensSiteLinks($link, in: stack)
    }
}

private struct ChartRow: View {
    let entry: TopRosterChart.Entry

    var body: some View {
        HStack(spacing: 12) {
            Text(String(format: "%02d", entry.position))
                .font(.roosterMono(15))
                .foregroundStyle(entry.position <= 3 ? Theme.red : Theme.muted)
                .frame(width: 30, alignment: .leading)
            MemberAvatar(name: entry.name, photoPath: entry.photoUrl, size: 46)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                Text("\(entry.visitors) visitor\(entry.visitors == 1 ? "" : "s") this week").font(.system(size: 13)).foregroundStyle(Theme.muted)
            }
            Spacer()
            movement
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var movement: some View {
        let kind = entry.movement?.kind ?? "same"
        let (symbol, color, text): (String, Color, String) = switch kind {
        case "up": ("arrowtriangle.up.fill", Color(hex: 0x2F9E55), "\(entry.movement?.places ?? 0)")
        case "down": ("arrowtriangle.down.fill", Theme.red, "\(entry.movement?.places ?? 0)")
        case "new": ("sparkle", Theme.orange, "NEW")
        default: ("equal", Theme.muted, "")
        }
        HStack(spacing: 3) {
            Image(systemName: symbol).font(.system(size: 10, weight: .bold))
            if !text.isEmpty { Text(text).font(.system(size: 12, weight: .bold)) }
        }
        .foregroundStyle(color)
        .accessibilityLabel(entry.movement?.label ?? "Same")
    }
}

// MARK: - Roster requests

/// /api/friend-requests (friends.mts:231-242).
struct RosterRequests: Decodable {
    struct Request: Decodable, Hashable, Identifiable {
        let id: String
        let memberId: String
        let name: String
        let profileUrl: String?
        let createdAt: String?
    }
    let incoming: [Request]
    let outgoing: [Request]
    let pendingCount: Int?
}

struct RequestsView: View {
    let stack: ShellTab
    @StateObject private var requests: Loadable<RosterRequests>
    @State private var link: String?
    @State private var notice: String?

    init(stack: ShellTab, api: FeedAPI) {
        self.stack = stack
        _requests = StateObject(wrappedValue: Loadable { try await api.get("/api/friend-requests", as: RosterRequests.self) })
    }

    var body: some View {
        LoadableContent(loadable: requests) { value in
            List {
                Section {
                    if value.incoming.isEmpty {
                        Label("No one is waiting on you right now.", systemImage: "checkmark.circle").foregroundStyle(Theme.muted)
                    }
                    ForEach(value.incoming) { request in
                        HStack(spacing: 12) {
                            Button { link = profile(request) } label: {
                                HStack(spacing: 12) {
                                    MemberAvatar(name: request.name, photoPath: nil, size: 46)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(request.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                                        if let created = request.createdAt {
                                            Text("Asked \(FeedDate.ago(created))").font(.system(size: 13)).foregroundStyle(Theme.muted)
                                        }
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                            Spacer()
                            Button("Accept") { notice = ComingSoon.text }
                                .font(.system(size: 14, weight: .bold)).buttonStyle(.borderedProminent).tint(Theme.red)
                            Button { notice = ComingSoon.text } label: { Image(systemName: "xmark") }
                                .buttonStyle(.bordered).tint(Theme.muted).accessibilityLabel("Decline")
                        }
                    }
                } header: {
                    Text("Waiting on you\(value.incoming.isEmpty ? "" : " (\(value.incoming.count))")")
                }
                if !value.outgoing.isEmpty {
                    Section("Sent") {
                        ForEach(value.outgoing) { request in
                            Button { link = profile(request) } label: {
                                HStack(spacing: 12) {
                                    MemberAvatar(name: request.name, photoPath: nil, size: 40)
                                    Text(request.name).font(.system(size: 16)).foregroundStyle(Theme.ink)
                                    Spacer()
                                    Label("Waiting", systemImage: "clock").font(.system(size: 13)).foregroundStyle(Theme.muted)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .refreshable { await requests.load() }
        }
        .nativeScreenChrome("Roster requests")
        .notice($notice)
        .opensSiteLinks($link, in: stack)
    }

    private func profile(_ request: RosterRequests.Request) -> String {
        request.memberId == "owner" ? "/profile.html?id=owner" : (request.profileUrl ?? "/profile.html?id=\(request.memberId)")
    }
}

// MARK: - Search

/// /api/morespace/roster (morespace-search.mts:52-130).
struct RosterSearchPage: Decodable {
    struct Result: Decodable, Hashable {
        let kind: String
        let id: String
        let title: String
        let subtitle: String?
        let description: String?
        let photoUrl: String?
        let openUrl: String?
        let provider: String?
        let verified: Bool?
        /// A member and a song can share an id, so rows key on both.
        var key: String { "\(kind)-\(id)-\(title)" }
    }
    let results: [Result]
    let total: Int?
    let nextOffset: Int?
}

@MainActor
final class SearchModel: ObservableObject {
    @Published var query: String
    @Published private(set) var results: [RosterSearchPage.Result] = []
    @Published private(set) var total: Int?
    @Published private(set) var loading = false
    @Published private(set) var failure: FeedError?
    private var nextOffset: Int?
    private let api: FeedAPI
    private var generation = 0

    init(query: String, api: FeedAPI) {
        self.query = query
        self.api = api
    }

    func search() async {
        generation += 1
        let current = generation
        loading = true
        defer { if current == generation { loading = false } }
        do {
            let page = try await api.get(path(offset: 0), as: RosterSearchPage.self)
            guard current == generation else { return }
            results = page.results
            total = page.total
            nextOffset = page.nextOffset
            failure = nil
        } catch let error as FeedError {
            if current == generation { failure = error }
        } catch {}
    }

    func queryChanged() {
        let typed = query
        Task {
            try? await Task.sleep(for: .milliseconds(350))
            guard typed == query else { return }
            await search()
        }
    }

    func loadMore() {
        guard let offset = nextOffset else { return }
        nextOffset = nil
        Task {
            guard let page = try? await api.get(path(offset: offset), as: RosterSearchPage.self) else { return }
            results += page.results
            nextOffset = page.nextOffset
        }
    }

    private func path(offset: Int) -> String {
        let trimmed = String(query.trimmingCharacters(in: .whitespaces).prefix(80))
        return "/api/morespace/roster?q=\(ProfileModel.encode(trimmed))&offset=\(offset)"
    }

    var googleURL: URL? {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        return URL(string: "https://www.google.com/search?q=\(ProfileModel.encode(trimmed))")
    }
}

struct SearchView: View {
    let stack: ShellTab
    @StateObject private var model: SearchModel
    @State private var link: String?
    @EnvironmentObject private var session: SessionModel

    init(query: String, stack: ShellTab, api: FeedAPI) {
        self.stack = stack
        _model = StateObject(wrappedValue: SearchModel(query: query, api: api))
    }

    var body: some View {
        List {
            if let google = model.googleURL {
                Section {
                    Button { link = google.absoluteString } label: {
                        Label("Search Google for “\(model.query.trimmingCharacters(in: .whitespaces))”", systemImage: "globe")
                            .foregroundStyle(Theme.ink)
                    }
                }
            }
            Section {
                if model.loading && model.results.isEmpty {
                    LoadingRows(count: 4)
                } else if let failure = model.failure, model.results.isEmpty {
                    ErrorState(message: failure.message) {
                        if case .locked = failure { session.revalidate() }
                        Task { await model.search() }
                    }
                } else if model.results.isEmpty {
                    Text(model.query.isEmpty ? "Search people, profiles and songs on the roster." : "Nothing on the roster matches that.")
                        .font(.system(size: 15)).foregroundStyle(Theme.muted)
                } else {
                    ForEach(model.results, id: \.key) { result in
                        Button { link = fixed(result.openUrl) } label: { SearchRow(result: result) }
                            .buttonStyle(.plain)
                            .onAppear { if result == model.results.last { model.loadMore() } }
                    }
                }
            } header: {
                if let total = model.total, !model.results.isEmpty {
                    Text("ROOSTER · \(total) result\(total == 1 ? "" : "s")")
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .searchable(text: $model.query, placement: .navigationBarDrawer(displayMode: .always), prompt: "People, profiles and songs")
        .onChange(of: model.query) { _, _ in model.queryChanged() }
        .task { await model.search() }
        .nativeScreenChrome("Search")
        .opensSiteLinks($link, in: stack)
    }

    /// Song results link to #music, which profile.html doesn't have; ?view=songs is the Music tab.
    private func fixed(_ url: String?) -> String? {
        guard let url else { return nil }
        if url.hasSuffix("#music") {
            let base = String(url.dropLast("#music".count))
            if base == "/" { return "/profile.html?id=owner&view=songs" }
            return base + (base.contains("?") ? "&" : "?") + "view=songs"
        }
        return url
    }
}

private struct SearchRow: View {
    let result: RosterSearchPage.Result

    var body: some View {
        HStack(spacing: 12) {
            if result.kind == "song" {
                Image(systemName: "music.note").font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 46, height: 46)
                    .background(LinearGradient(colors: [Theme.red, Theme.orange], startPoint: .topLeading, endPoint: .bottomTrailing),
                                in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            } else {
                MemberAvatar(name: result.title, photoPath: result.photoUrl, size: 46)
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(result.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                    if result.verified == true {
                        Image(systemName: "checkmark.seal.fill").font(.system(size: 12)).foregroundStyle(Theme.red)
                    }
                }
                if let subtitle = result.subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.system(size: 13)).foregroundStyle(Theme.muted).lineLimit(1)
                }
                if let description = result.description, !description.isEmpty {
                    Text(description).font(.system(size: 13)).foregroundStyle(Theme.muted.opacity(0.85)).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}

// MARK: - About

struct AboutView: View {
    let stack: ShellTab
    @State private var link: String?

    private let paragraphs = [
        "I made ROOSTER because talent needs more than an algorithm. You need a place where your work, your people and your next opportunity can actually meet.",
        "ROOSTER brings short-form WYD, profiles, live video, audio rooms and real connections into one network built for discovery—not just scrolling.",
        "Music brought me here, but ROOSTER isn’t limited to music. Artists, producers, singers, DJs, creators, fans and people ready to build all have a place here.",
        "You don’t have to be famous to be on the ROOSTER. Show what you do. Share something. Meet somebody. Build your circle.",
        "That’s why I made ROOSTER. A place for people.",
        "ROOSTER is a creative social network with your profile, movable Top 8, music, photos, conversations, private messages and TOP ROSTERS. Then it goes further: you can find somebody to create with and find a real opening through OPPORTUNITIES. Connect. Collaborate. Find opportunities. Build.",
        "So my role changed. I am not just your producer on here. I am Your Connector.",
        "Let’s work.",
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                RoosterMark(size: 54).padding(.top, 8)
                Text("A PLACE FOR PEOPLE").font(.roosterMono(11)).tracking(1.4).foregroundStyle(Theme.red)
                Text("Why I made ROOSTER").font(.rooster(34)).foregroundStyle(Theme.ink)
                ForEach(paragraphs, id: \.self) { paragraph in
                    Text(paragraph).font(.system(size: 17)).foregroundStyle(Theme.ink.opacity(0.9)).lineSpacing(3)
                }
                Button { link = "/profile.html?id=owner" } label: {
                    HStack {
                        Text("J.White Did It").font(.rooster(22)).foregroundStyle(Theme.red)
                        Image(systemName: "arrow.forward").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.red)
                    }
                }
                .padding(.top, 4)
                Button { link = "/opportunities.html" } label: {
                    Label("See the Opportunities", systemImage: "sparkles")
                        .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .background(Theme.red, in: Capsule())
                }
                .buttonStyle(PressableStyle())
                .padding(.top, 8)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
        .nativeScreenChrome("About ROOSTER")
        .opensSiteLinks($link, in: stack)
    }
}
