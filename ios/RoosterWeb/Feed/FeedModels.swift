import Foundation

/// A music or sports headline from /api/slots/discover (netlify/functions/slots-discover.mts).
struct Story: Decodable, Hashable, Identifiable {
    let id: String
    let title: String
    let url: String
    let source: String
    let category: String
    let publishedAt: String

    var date: Date? { FeedDate.parse(publishedAt) }
    var isSports: Bool { category == "sports" }
}

/// A house ad or casting campaign (slots-promos.mjs). Paths are site-relative.
struct Promo: Hashable, Identifiable {
    let id: String
    var video: String?
    let poster: String
    var campaign = false
    let category: String
    var sponsor: String?
    let title: String
    let copy: String
    let href: String
    let action: String
}

/// A member post as the feed API returns it (social-feed.mts postView).
struct FeedPost: Decodable, Hashable, Identifiable {
    struct Author: Decodable, Hashable {
        let id: String
        let name: String
        let photoUrl: String?
        let kind: String
    }

    struct Media: Decodable, Hashable {
        let type: String
        let url: String
        let thumbnailUrl: String?
        let alt: String?
        let durationMs: Int?
    }

    struct Counts: Decodable, Hashable {
        var likes = 0
        var comments = 0
        var reposts = 0
        var bookmarks = 0
        var views = 0
    }

    struct Viewer: Decodable, Hashable {
        var liked = false
        var bookmarked = false
        var reposted = false
        var canDelete = false
    }

    /// The fields the feed reads from free-form metadata. Each is decoded on its own, so one
    /// unexpected value can't drop the whole post.
    struct Metadata: Decodable, Hashable {
        var title: String?
        var artist: String?
        var artworkUrl: String?
        var playCount: Int?
        var location: String?
        var medium: String?
        var hostName: String?
        var speakers: Int?
        var listeners: Int?
        var origin: String?

        init() {}

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            title = try? c.decodeIfPresent(String.self, forKey: .title)
            artist = try? c.decodeIfPresent(String.self, forKey: .artist)
            artworkUrl = try? c.decodeIfPresent(String.self, forKey: .artworkUrl)
            playCount = try? c.decodeIfPresent(Int.self, forKey: .playCount)
            location = try? c.decodeIfPresent(String.self, forKey: .location)
            medium = try? c.decodeIfPresent(String.self, forKey: .medium)
            hostName = try? c.decodeIfPresent(String.self, forKey: .hostName)
            speakers = try? c.decodeIfPresent(Int.self, forKey: .speakers)
            listeners = try? c.decodeIfPresent(Int.self, forKey: .listeners)
            origin = try? c.decodeIfPresent(String.self, forKey: .origin)
        }

        private enum CodingKeys: String, CodingKey {
            case title, artist, artworkUrl, playCount, location, medium, hostName, speakers, listeners, origin
        }
    }

    let id: String
    let author: Author
    let contentType: String
    let body: String?
    let roomId: String?
    let metadata: Metadata
    let media: [Media]
    var counts: Counts
    var viewer: Viewer
    let publishedAt: String

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Post ids are serial integers today; accept strings too.
        if let number = try? c.decode(Int.self, forKey: .id) {
            id = String(number)
        } else {
            id = try c.decode(String.self, forKey: .id)
        }
        author = try c.decode(Author.self, forKey: .author)
        contentType = try c.decode(String.self, forKey: .contentType)
        body = try? c.decodeIfPresent(String.self, forKey: .body)
        if let number = try? c.decodeIfPresent(Int.self, forKey: .roomId) {
            roomId = String(number)
        } else {
            roomId = try? c.decodeIfPresent(String.self, forKey: .roomId)
        }
        metadata = (try? c.decodeIfPresent(Metadata.self, forKey: .metadata)) ?? Metadata()
        media = (try? c.decodeIfPresent([Media].self, forKey: .media)) ?? []
        counts = (try? c.decodeIfPresent(Counts.self, forKey: .counts)) ?? Counts()
        viewer = (try? c.decodeIfPresent(Viewer.self, forKey: .viewer)) ?? Viewer()
        publishedAt = try c.decode(String.self, forKey: .publishedAt)
    }

    private enum CodingKeys: String, CodingKey {
        case id, author, contentType, body, roomId, metadata, media, counts, viewer, publishedAt
    }

    enum Surface { case video, photo, audio, text, room }

    /// stageMedia() in community-home.js, plus room posts.
    var surface: Surface {
        if contentType == "room_post", roomId != nil { return .room }
        guard let first = media.first else { return .text }
        switch first.type {
        case "video": return .video
        case "image": return .photo
        default: return .audio
        }
    }

    var isProfileClip: Bool { metadata.origin == "profile_clip" }

    /// "photo", "text", "New clip" — the post kind label (postMarkup).
    var kindLabel: String {
        if isProfileClip { return "New clip" }
        return contentType.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: " post", with: "")
    }

    var profilePath: String {
        author.id == "roster" ? "/people.html" : "/profile.html?id=\(author.id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? author.id)"
    }
}

struct FeedPage: Decodable {
    let posts: [FeedPost]
    let nextCursor: String?
}

enum FeedItem: Hashable, Identifiable {
    case post(FeedPost)
    case news(Story)
    case promo(Promo)

    /// Namespaced like slots-mix.mjs itemKey, so a story id can't collide with a post id.
    var id: String {
        switch self {
        case .post(let post): "post-\(post.id)"
        case .news(let story): "news-\(story.id)"
        case .promo(let promo): "promo-\(promo.id)"
        }
    }
}

enum FeedDate {
    private static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let plain = ISO8601DateFormatter()

    static func parse(_ value: String) -> Date? {
        fractional.date(from: value) ?? plain.date(from: value)
    }

    /// ago() in community-home.js: "now", "5m", "3h", "2d", then a short date.
    static func ago(_ value: String, now: Date = Date()) -> String {
        guard let date = parse(value) else { return "" }
        let seconds = max(1, Int(now.timeIntervalSince(date)))
        if seconds < 60 { return "now" }
        if seconds < 3600 { return "\(seconds / 60)m" }
        if seconds < 86_400 { return "\(seconds / 3600)h" }
        if seconds < 604_800 { return "\(seconds / 86_400)d" }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }

    static func storyDate(_ value: String) -> String {
        parse(value)?.formatted(.dateTime.month(.abbreviated).day().year()) ?? ""
    }
}

enum Compact {
    /// compact() in community-home.js: 1,234 → "1.2K".
    static func string(_ value: Int) -> String {
        value > 999 ? value.formatted(.number.notation(.compactName).precision(.fractionLength(0...1))) : String(value)
    }
}
