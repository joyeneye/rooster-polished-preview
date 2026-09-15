import SwiftUI

/// State for the native WYD feed: which lane is showing, what's in it, and which card is on screen.
@MainActor
final class FeedModel: ObservableObject {
    enum Lane: String, CaseIterable, Identifiable {
        case following, forYou
        var id: String { rawValue }
        var title: String { self == .following ? "Following" : "For You" }
        var filter: String { self == .following ? "following" : "for_you" }
    }

    enum Status: Equatable {
        case loading
        case ready
        /// Following needs an approved account.
        case locked(String)
        case failed(String)
    }

    @Published private(set) var lane: Lane = .forYou
    @Published private(set) var items: [FeedItem] = []
    @Published private(set) var status: Status = .loading
    @Published private(set) var isLoadingMore = false
    @Published var activeID: String?
    /// Promos and clips play muted until the viewer turns sound on, as on the site.
    @Published var soundOn = false

    let api: FeedAPI
    private let promos: [Promo]
    private var cursor: String?
    private var generation = 0
    private var stories: [Story] = []
    private var storiesFetchedAt: Date?

    init(api: FeedAPI, promos: [Promo] = Promos.nextOrder()) {
        self.api = api
        self.promos = promos
    }

    func startIfNeeded() {
        guard items.isEmpty, status == .loading, generation == 0 else { return }
        Task { await load() }
    }

    func select(_ lane: Lane) {
        guard lane != self.lane else { return }
        self.lane = lane
        items = []
        activeID = nil
        status = .loading
        Task { await load() }
    }

    func load() async {
        generation += 1
        let current = generation
        cursor = nil
        if items.isEmpty { status = .loading }

        #if DEBUG
        if let fixture = FeedFixture.posts, lane == .forYou {
            let stories = await discovery()
            items = FeedMixer.forYou(posts: fixture, stories: stories, promos: promos)
            status = .ready
            return
        }
        #endif

        async let storiesTask = lane == .forYou ? discovery() : []
        do {
            let page = try await api.feed(filter: lane.filter)
            let stories = await storiesTask
            guard current == generation else { return }
            cursor = page.nextCursor
            items = lane == .forYou
                ? FeedMixer.forYou(posts: page.posts, stories: stories, promos: promos)
                : page.posts.map(FeedItem.post)
            status = .ready
            warmFirstCards()
        } catch let error as FeedError {
            let stories = await storiesTask
            guard current == generation else { return }
            switch (lane, error) {
            case (.following, .locked(let message)):
                items = []
                status = .locked(message)
            case (.following, .failed(let message)):
                items = []
                status = .failed(message)
            case (.forYou, _):
                // Signed out, For You still has ROOSTER promos and headlines (loadStage's catch).
                items = FeedMixer.forYou(posts: [], stories: stories, promos: promos)
                if items.isEmpty, case .failed(let message) = error { status = .failed(message) } else { status = .ready }
                warmFirstCards()
            }
        } catch {
            guard current == generation else { return }
            status = .failed("ROOSTER could not connect.")
        }
    }

    /// Later pages carry member posts only (mixSlots with append).
    func loadMoreIfNeeded(after item: FeedItem) {
        guard let cursor, !isLoadingMore, items.last?.id == item.id else { return }
        isLoadingMore = true
        let current = generation
        Task {
            defer { if current == generation { isLoadingMore = false } }
            guard let page = try? await api.feed(filter: lane.filter, cursor: cursor), current == generation else { return }
            let known = Set(items.map(\.id))
            items.append(contentsOf: page.posts.map(FeedItem.post).filter { !known.contains($0.id) })
            self.cursor = page.nextCursor
        }
    }

    /// YEP, Repost and Save. Optimistic; rolls back if the server refuses.
    func toggle(_ action: String, on post: FeedPost) async throws {
        guard let index = items.firstIndex(where: { $0.id == FeedItem.post(post).id }), case .post(var updated) = items[index] else { return }
        let original = updated
        switch action {
        case "like":
            updated.viewer.liked.toggle(); updated.counts.likes += updated.viewer.liked ? 1 : -1
        case "repost":
            updated.viewer.reposted.toggle(); updated.counts.reposts += updated.viewer.reposted ? 1 : -1
        case "bookmark":
            updated.viewer.bookmarked.toggle()
        default:
            return
        }
        items[index] = .post(updated)
        do {
            let result = try await api.act(postID: post.id, action: action)
            if let active = result.active, let count = result.count {
                switch action {
                case "like": updated.viewer.liked = active; updated.counts.likes = count
                case "repost": updated.viewer.reposted = active; updated.counts.reposts = count
                default: updated.viewer.bookmarked = active
                }
                replace(updated)
            }
        } catch {
            replace(original)
            throw error
        }
    }

    func comment(_ body: String, on post: FeedPost) async throws {
        let result = try await api.act(postID: post.id, action: "comment", body: body)
        guard case .post(var updated)? = items.first(where: { $0.id == FeedItem.post(post).id }) else { return }
        updated.counts.comments = result.count ?? updated.counts.comments + 1
        replace(updated)
    }

    private func replace(_ post: FeedPost) {
        guard let index = items.firstIndex(where: { $0.id == FeedItem.post(post).id }) else { return }
        items[index] = .post(post)
    }

    /// Starts the first cards' artwork downloading while the welcome screen is still up.
    private func warmFirstCards() {
        let paths: [String] = items.prefix(3).compactMap {
            switch $0 {
            case .promo(let promo): promo.poster
            case .post(let post): post.media.first?.thumbnailUrl ?? (post.surface == .photo ? post.media.first?.url : nil)
            case .news: nil
            }
        }
        for path in paths {
            guard let url = ShellURL.resolve(path, base: api.base) else { continue }
            URLSession.shared.dataTask(with: URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad)).resume()
        }
    }

    func scrollToTop() {
        withAnimation(.snappy) { activeID = items.first?.id }
    }

    /// Headlines are cached for 15 minutes, like loadDiscovery().
    private func discovery() async -> [Story] {
        if let storiesFetchedAt, Date().timeIntervalSince(storiesFetchedAt) < 900 { return stories }
        guard let fresh = try? await api.stories() else { return stories }
        stories = fresh
        storiesFetchedAt = Date()
        return fresh
    }
}
