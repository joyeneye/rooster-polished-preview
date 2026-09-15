import SwiftUI

@MainActor
final class ProfileModel: ObservableObject {
    enum Tab: String, CaseIterable, Identifiable {
        case posts, music, photos, about
        var id: String { rawValue }
        var title: String {
            switch self {
            case .posts: "Posts"
            case .music: "Music"
            case .photos: "Photos"
            case .about: "About"
            }
        }
    }

    /// A member id, "owner" for J.White, or nil for the signed-in member's own profile.
    let requestedID: String?
    @Published private(set) var bundle: ProfileBundle?
    @Published private(set) var failure: FeedError?
    @Published var tab: Tab
    @Published private(set) var loadingMoreWall = false

    private let api: FeedAPI
    private var loading = false

    init(id: String?, initialTab: Tab = .posts, api: FeedAPI) {
        requestedID = id
        tab = initialTab
        self.api = api
    }

    func startIfNeeded() {
        guard bundle == nil, !loading else { return }
        Task { await load() }
    }

    func load() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        failure = nil
        #if DEBUG
        if let fixture = NativeFixtures.profile(id: requestedID) {
            bundle = fixture
            return
        }
        #endif
        do {
            let me = try? await api.get("/api/profile/me", as: ProfileResponse.self)
            let target = requestedID ?? me?.profile.id ?? "owner"
            let response = try await api.get("/api/profile?id=\(Self.encode(target))", as: ProfileResponse.self)
            var bundle = ProfileBundle(profile: response.profile)
            bundle.isMe = me.map { $0.profile.id == response.profile.id } ?? false
            // J.White's pages answer to "owner"; everyone else to their id. The album only takes an id.
            let key = target == "owner" ? "owner" : response.profile.id
            let memberID = response.profile.id
            let isOwner = target == "owner" || response.profile.verifiedOwner == true

            async let topEight = try? api.get("/api/top-eight-roster?target_id=\(Self.encode(key))", as: TopEight.self)
            async let friends = try? api.get("/api/friends?target_id=\(Self.encode(key))", as: FriendsList.self)
            async let clips = try? api.get("/api/clips?member=\(Self.encode(key))", as: ClipsList.self)
            async let wall = isOwner ? nil : try? api.get("/api/member-wall?member=\(Self.encode(memberID))", as: WallPage.self)
            async let album = Connections.isMemberID(memberID)
                ? try? api.get("/api/member-album?member=\(Self.encode(memberID))&limit=10&offset=0", as: AlbumPage.self) : nil
            async let songs = try? api.get("/api/member-songs?id=\(Self.encode(key))", as: SongsList.self)
            async let plays = try? api.get(isOwner ? "/api/music-plays" : "/api/member-music-plays?id=\(Self.encode(key))", as: PlayCounts.self)
            async let visitors = try? api.get("/api/visitors?id=\(Self.encode(key))", as: VisitorStats.self)
            async let bookings = Connections.isMemberID(memberID)
                ? try? api.get("/api/profile-bookings?id=\(Self.encode(memberID))", as: ProfileBookings.self) : nil
            async let rooms = try? api.get("/api/live/rooms", as: LiveRooms.self)

            bundle.topEight = await topEight
            bundle.friends = await friends
            bundle.clips = await clips?.clips ?? []
            bundle.wall = await wall
            bundle.album = await album
            bundle.songs = await songs
            bundle.plays = await plays?.counts ?? [:]
            bundle.visitors = await visitors
            bundle.bookings = await bookings
            bundle.liveRoom = await rooms?.rooms.first { $0.hostId == memberID }
            self.bundle = bundle
        } catch let error as FeedError {
            failure = error
        } catch {
            failure = .failed("ROOSTER could not connect.")
        }
    }

    func loadMoreWall() {
        guard let bundle, let wall = bundle.wall, let next = wall.next, !loadingMoreWall else { return }
        loadingMoreWall = true
        Task {
            defer { loadingMoreWall = false }
            let path = "/api/member-wall?member=\(Self.encode(bundle.profile.id))&before=\(Self.encode(next))"
            guard let page = try? await api.get(path, as: WallPage.self) else { return }
            let known = Set(wall.comments.map(\.id))
            self.bundle?.wall = WallPage(comments: wall.comments + page.comments.filter { !known.contains($0.id) },
                                         total: page.total ?? wall.total, next: page.next, canPost: wall.canPost)
        }
    }

    static func encode(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_.~"))) ?? value
    }
}
