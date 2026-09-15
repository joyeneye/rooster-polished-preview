import SwiftUI

/// /api/opportunities and /api/opportunity (opportunities.mts:197-279).
struct OpportunityCard: Decodable, Hashable, Identifiable {
    let slug: String
    let title: String
    let headline: String?
    let description: String?
    let posterRole: String?
    let seekingRole: String?
    let lanes: [String]?
    let genre: String?
    let city: String?
    let region: String?
    let workMode: String?
    let postedByKind: String?
    let postedByMemberId: String?
    let postedByName: String?
    let featured: Bool?
    let applicationCount: Int?
    let createdAt: String?
    var id: String { slug }

    var place: String? {
        let parts = [city, region].compactMap { $0?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    var modeLabel: String? {
        switch workMode {
        case "remote": "Remote"
        case "in_person": "In person"
        case "either": "Remote or in person"
        default: nil
        }
    }

    var profilePath: String? {
        if postedByKind == "owner" { return "/profile.html?id=owner" }
        return postedByMemberId.map { "/profile.html?id=\($0)" }
    }
}

struct OpportunityList: Decodable {
    let opportunities: [OpportunityCard]
    let total: Int?
}

struct OpportunityOptions: Decodable {
    struct Choice: Decodable, Hashable, Identifiable {
        let value: String
        let label: String
        var id: String { value }
    }
    let posterRoles: [Choice]
    let seekingRoles: [Choice]
    let workModes: [Choice]
    let genres: [String]
}

struct OpportunityDetail: Decodable {
    let opportunity: OpportunityCard
}

@MainActor
final class OpportunitiesModel: ObservableObject {
    @Published private(set) var cards: [OpportunityCard] = []
    @Published private(set) var options: OpportunityOptions?
    @Published private(set) var total: Int?
    @Published private(set) var loading = false
    @Published private(set) var failure: FeedError?
    @Published var role: String? { didSet { reload() } }
    @Published var genre: String? { didSet { reload() } }
    @Published var mode: String? { didSet { reload() } }
    @Published var sort = "newest" { didSet { reload() } }

    private let api: FeedAPI
    private var generation = 0

    init(api: FeedAPI) {
        self.api = api
    }

    func startIfNeeded() {
        guard cards.isEmpty, !loading else { return }
        Task {
            options = try? await api.get("/api/opportunities/options", as: OpportunityOptions.self)
            await load()
        }
    }

    private func reload() {
        Task { await load() }
    }

    func load() async {
        generation += 1
        let current = generation
        loading = true
        defer { if current == generation { loading = false } }
        var path = "/api/opportunities?sort=\(sort)"
        if let role { path += "&role=\(ProfileModel.encode(role))" }
        if let genre { path += "&genre=\(ProfileModel.encode(genre))" }
        if let mode { path += "&mode=\(ProfileModel.encode(mode))" }
        do {
            let list = try await api.get(path, as: OpportunityList.self)
            guard current == generation else { return }
            cards = list.opportunities
            total = list.total
            failure = nil
        } catch let error as FeedError {
            if current == generation { failure = error }
        } catch {}
    }

    var filtersOn: Bool { role != nil || genre != nil || mode != nil }

    func clearFilters() {
        role = nil
        genre = nil
        mode = nil
    }
}

struct OpportunitiesView: View {
    let stack: ShellTab
    @StateObject private var model: OpportunitiesModel
    @State private var link: String?
    @EnvironmentObject private var session: SessionModel

    init(stack: ShellTab, api: FeedAPI) {
        self.stack = stack
        _model = StateObject(wrappedValue: OpportunitiesModel(api: api))
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("YOUR NEXT CHAPTER").font(.roosterMono(10)).tracking(1.4).foregroundStyle(Theme.red)
                    Text("Opportunities").font(.rooster(28)).foregroundStyle(Theme.ink)
                    Text("Openings posted by people on the roster.").font(.system(size: 15)).foregroundStyle(Theme.muted)
                }
                .padding(.horizontal, 20)

                filters

                if model.loading && model.cards.isEmpty {
                    LoadingRows(count: 3).padding(.horizontal, 20)
                } else if let failure = model.failure, model.cards.isEmpty {
                    ErrorState(message: failure.message) {
                        if case .locked = failure { session.revalidate() }
                        Task { await model.load() }
                    }
                } else if model.cards.isEmpty {
                    Text("Nothing on the board right now.").font(.system(size: 15)).foregroundStyle(Theme.muted).padding(.horizontal, 20)
                } else {
                    Text("\(model.total ?? model.cards.count) open · \(model.sort == "newest" ? "newest first" : "trending")")
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted).padding(.horizontal, 20)
                    ForEach(model.cards) { card in
                        NavigationLink(value: AppRoute.native(.opportunity(slug: card.slug))) {
                            OpportunityRow(card: card)
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 16)
                    }
                }
            }
            .padding(.vertical, 12)
        }
        .refreshable { await model.load() }
        .nativeScreenChrome("Opportunities")
        .opensSiteLinks($link, in: stack)
        .onAppear(perform: model.startIfNeeded)
    }

    private var filters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Menu {
                    Button("Any role") { model.role = nil }
                    ForEach(model.options?.seekingRoles ?? []) { choice in
                        Button(choice.label) { model.role = choice.value }
                    }
                } label: {
                    FilterChip(title: roleLabel, active: model.role != nil)
                }
                Menu {
                    Button("Any genre") { model.genre = nil }
                    ForEach(model.options?.genres ?? [], id: \.self) { genre in
                        Button(genre) { model.genre = genre }
                    }
                } label: {
                    FilterChip(title: model.genre ?? "Genre", active: model.genre != nil)
                }
                Menu {
                    Button("Anywhere") { model.mode = nil }
                    ForEach(model.options?.workModes ?? []) { choice in
                        Button(choice.label) { model.mode = choice.value }
                    }
                } label: {
                    FilterChip(title: modeLabel, active: model.mode != nil)
                }
                Button {
                    model.sort = model.sort == "newest" ? "trending" : "newest"
                } label: {
                    FilterChip(title: model.sort == "newest" ? "Newest" : "Trending", active: model.sort == "trending", symbol: "arrow.up.arrow.down")
                }
                if model.filtersOn {
                    Button("Clear") { model.clearFilters() }
                        .font(.system(size: 14, weight: .semibold)).tint(Theme.red)
                }
            }
            .padding(.horizontal, 20)
        }
    }

    private var roleLabel: String {
        model.options?.seekingRoles.first { $0.value == model.role }?.label ?? "Role"
    }

    private var modeLabel: String {
        model.options?.workModes.first { $0.value == model.mode }?.label ?? "Where"
    }
}

struct FilterChip: View {
    let title: String
    let active: Bool
    var symbol: String? = "chevron.down"

    var body: some View {
        HStack(spacing: 5) {
            Text(title).font(.system(size: 14, weight: .semibold))
            if let symbol { Image(systemName: symbol).font(.system(size: 10, weight: .bold)) }
        }
        .foregroundStyle(active ? .white : Theme.ink)
        .padding(.horizontal, 14)
        .frame(height: 34)
        .background(active ? Theme.red : Theme.surface, in: Capsule())
        .overlay(Capsule().stroke(Color(uiColor: Theme.uiLine), lineWidth: active ? 0 : 1))
    }
}

private struct OpportunityRow: View {
    let card: OpportunityCard

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if card.featured == true {
                    Text("FEATURED").font(.roosterMono(9)).tracking(1).foregroundStyle(.white)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Theme.red, in: Capsule())
                }
                if let created = card.createdAt {
                    Text(FeedDate.ago(created)).font(.system(size: 12)).foregroundStyle(Theme.muted)
                }
                Spacer()
                if let count = card.applicationCount, count > 0 {
                    Text("\(count) applied").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.muted)
                }
            }
            Text(card.title).font(.rooster(20)).foregroundStyle(Theme.ink)
            if let poster = card.posterRole, let seeking = card.seekingRole {
                Text("\(poster) looking for \(seeking)").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.red)
            }
            if let headline = card.headline, !headline.isEmpty {
                Text(headline).font(.system(size: 15)).foregroundStyle(Theme.ink.opacity(0.85)).lineLimit(3)
            }
            HStack(spacing: 6) {
                ForEach([card.genre, card.place, card.modeLabel].compactMap { $0 }.filter { !$0.isEmpty }, id: \.self) { tag in
                    Text(tag).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.muted)
                        .padding(.horizontal, 9).padding(.vertical, 4)
                        .background(Theme.background, in: Capsule())
                }
            }
            if let name = card.postedByName {
                Text("Posted by \(name)").font(.system(size: 13)).foregroundStyle(Theme.muted)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Color(uiColor: Theme.uiLine)))
    }
}

/// One opening, with everything the apply form asks about. Applying is a write, so it is coming soon.
struct OpportunityView: View {
    let slug: String
    let stack: ShellTab
    @StateObject private var detail: Loadable<OpportunityDetail>
    @State private var notice: String?
    @State private var link: String?

    init(slug: String, stack: ShellTab, api: FeedAPI) {
        self.slug = slug
        self.stack = stack
        _detail = StateObject(wrappedValue: Loadable {
            try await api.get("/api/opportunity?slug=\(ProfileModel.encode(slug))", as: OpportunityDetail.self)
        })
    }

    var body: some View {
        LoadableContent(loadable: detail) { value in
            let card = value.opportunity
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if card.featured == true {
                        Text("FEATURED OPPORTUNITY").font(.roosterMono(10)).tracking(1.4).foregroundStyle(Theme.red)
                    }
                    Text(card.title).font(.rooster(30)).foregroundStyle(Theme.ink)
                    if let poster = card.posterRole, let seeking = card.seekingRole {
                        Text("\(poster) looking for \(seeking)").font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.red)
                    }
                    if let headline = card.headline, !headline.isEmpty {
                        Text(headline).font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.ink)
                    }
                    if let description = card.description, !description.isEmpty {
                        Text(description).font(.system(size: 16)).foregroundStyle(Theme.ink.opacity(0.9)).lineSpacing(3)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach([("music.mic", card.seekingRole), ("guitars", card.genre), ("mappin.circle.fill", card.place),
                                 ("location.circle", card.modeLabel), ("person.2.fill", card.applicationCount.map { "\($0) applied" })]
                                .compactMap { symbol, value in value.map { (symbol, $0) } }, id: \.1) { symbol, value in
                            HStack(spacing: 10) {
                                Image(systemName: symbol).font(.system(size: 14)).foregroundStyle(Theme.red).frame(width: 20)
                                Text(value).font(.system(size: 15)).foregroundStyle(Theme.ink)
                            }
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))

                    if let profilePath = card.profilePath, let name = card.postedByName {
                        Button { link = profilePath } label: {
                            HStack {
                                MemberAvatar(name: name, photoPath: nil, size: 40)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text("Posted by").font(.system(size: 12)).foregroundStyle(Theme.muted)
                                    Text(name).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                                }
                                Spacer()
                                Image(systemName: "chevron.forward").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
                            }
                        }
                        .buttonStyle(.plain)
                    }

                    Button { notice = "Applying from the app is coming soon." } label: {
                        Text("Apply through ROOSTER")
                            .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity, minHeight: 52)
                            .background(Theme.red, in: Capsule())
                    }
                    .buttonStyle(PressableStyle())
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
        }
        .nativeScreenChrome("Opportunity")
        .notice($notice)
        .opensSiteLinks($link, in: stack)
    }
}
