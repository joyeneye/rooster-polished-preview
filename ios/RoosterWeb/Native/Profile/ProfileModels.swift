import Foundation

/// /api/profile?id= and /api/profile/me (member-profiles.mts:88-140).
struct ProfileResponse: Decodable {
    let profile: MemberProfile
    let canEditOwner: Bool?
}

struct MemberProfile: Decodable, Hashable {
    struct Membership: Decodable, Hashable {
        let levelLabel: String?
        let earlyMember: Bool?
        let foundingMember: Bool?
        let approvedCreator: Bool?
        let memberSince: String?
    }

    let id: String
    let name: String
    let status: String?
    let aboutMe: String?
    let profession: String?
    let websiteUrl: String?
    let titleLines: String?
    let credentials: String?
    let location: String?
    let photoUrl: String?
    let verified: Bool?
    let verifiedOwner: Bool?
    let membership: Membership?
    let profilePending: Bool?

    /// Long profession names from profile-profession.js, used when the member has no title lines.
    static let professionLabels: [String: String] = [
        "musician": "Musician / Artist", "producer": "Producer", "songwriter": "Songwriter", "engineer": "Audio Engineer",
        "a_and_r": "A&R / Music Executive", "dj": "DJ", "barber": "Barber", "hairstylist": "Hairstylist",
        "beauty_products": "Hair & Beauty Brand", "journalist": "Journalist / Media", "podcaster": "Podcaster / Host",
        "photographer": "Photographer", "designer": "Designer / Stylist", "model": "Model", "creator": "Creator / Influencer",
        "business": "Business Owner", "speaker": "Speaker", "ministry": "Ministry / Church Leadership",
        "logistics": "Trucking / Logistics", "other": "Creative Professional",
    ]

    static let musicProfessions: Set<String> = ["musician", "producer", "songwriter", "engineer", "a_and_r", "dj"]

    var roleLabel: String? {
        let title = titleLines?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !title.isEmpty { return title }
        return profession.flatMap { Self.professionLabels[$0] }
    }

    /// Music profiles lead with Profile Music; everyone else with their Creator Studio
    /// (profile-experience.js:21-37).
    var isMusic: Bool { verifiedOwner == true || Self.musicProfessions.contains(profession ?? "") }

    var badges: [String] {
        var badges: [String] = []
        if membership?.foundingMember == true { badges.append("Founding Member") }
        if membership?.earlyMember == true { badges.append("Early Member") }
        if membership?.approvedCreator == true { badges.append("Approved Creator") }
        return badges
    }

    var locationLine: String? {
        let text = location?.replacingOccurrences(of: "\n", with: ", ").trimmingCharacters(in: .whitespaces) ?? ""
        return text.isEmpty ? nil : text
    }

    var website: URL? {
        guard let websiteUrl, let url = URL(string: websiteUrl), url.scheme == "https" else { return nil }
        return url
    }
}

/// /api/top-eight-roster (top-eight-roster.mts:66-134).
struct TopEight: Decodable {
    struct Card: Decodable, Hashable, Identifiable {
        let id: String
        let name: String
        let photoUrl: String?
        let profileUrl: String?
    }
    let members: [Card]
    let mode: String?
    let editable: Bool?
}

/// /api/friends (friends.mts:176-195).
struct FriendsList: Decodable {
    struct Friend: Decodable, Hashable, Identifiable {
        let memberId: String
        let memberName: String
        let profileUrl: String?
        var id: String { memberId }
    }
    struct RelationshipState: Decodable {
        let state: String
    }
    let count: Int
    let friends: [Friend]
    let relationship: RelationshipState?
}

/// /api/clips?member= (member-clips.mts:36, 324-352).
struct ClipsList: Decodable {
    struct Clip: Decodable, Hashable, Identifiable {
        let id: String
        let name: String?
        let caption: String?
        let createdAt: String
        let videoUrl: String
        let width: Int?
        let height: Int?
        let duration: Double?
    }
    let clips: [Clip]
}

/// /api/member-wall?member= (member-wall.mts:90-183).
struct WallPage: Decodable {
    struct Comment: Decodable, Hashable, Identifiable {
        let id: String
        let authorId: String?
        let name: String
        let message: String
        let createdAt: String
        let status: String?
        let verified: Bool?
        let verifiedOwner: Bool?
        let profileUrl: String?
        let photoUrl: String?
    }
    let comments: [Comment]
    let total: Int?
    let next: String?
    let canPost: Bool?
}

/// /api/member-album?member= (member-albums.mts:24-36).
struct AlbumPage: Decodable {
    struct Photo: Decodable, Hashable, Identifiable {
        let id: String
        let url: String
        let caption: String?
        let createdAt: String?
        let width: Int?
        let height: Int?
    }
    let total: Int?
    let nextOffset: Int?
    let photos: [Photo]
}

/// /api/member-songs?id= (member-songs.mts:155-163, 289-300).
struct SongsList: Decodable {
    struct Song: Decodable, Hashable, Identifiable {
        struct Origin: Decodable, Hashable {
            let memberId: String?
            let name: String?
        }
        let slot: Int?
        let revision: String?
        let status: String?
        let title: String?
        let duration: Double?
        let source: String?
        let provider: String?
        let externalUrl: String?
        let url: String?
        let catalogVideoId: String?
        let origin: Origin?

        var id: String { revision ?? catalogVideoId ?? "\(slot ?? 0)-\(title ?? "")" }
        var providerName: String {
            switch provider {
            case "youtube": "YouTube"
            case "spotify": "Spotify"
            case "apple": "Apple Music"
            default: source == "upload" ? "ROOSTER" : "Song"
            }
        }
    }
    let songs: [Song]
    let catalogSongs: [Song]?
    let featuredSongs: [Song]?
}

/// /api/member-music-plays?id= and /api/music-plays (member-music-plays.mts:79-81).
struct PlayCounts: Decodable {
    let counts: [String: Int]
    let total: Int?
    let today: Int?
}

/// /api/visitors?id= (profile-visitors.mts:487-503).
struct VisitorStats: Decodable {
    let today: Int?
    let thisWeek: Int?
    let allTime: Int?
    let position: Int?
}

/// /api/profile-bookings?id= (profile-bookings.mts:54-69).
struct ProfileBookings: Decodable {
    struct Business: Decodable, Hashable, Identifiable {
        let name: String
        let bookingUrl: String
        let servicesCount: Int?
        var id: String { bookingUrl }
    }
    let businesses: [Business]
    let canManage: Bool?
}

/// /api/live/rooms (roster-live.mts:39-46, 188-205).
struct LiveRooms: Decodable {
    struct Room: Decodable, Hashable, Identifiable {
        let key: String
        let title: String
        let description: String?
        let medium: String
        let hostId: String
        let hostName: String
        let hostPhotoUrl: String?
        let createdAt: String?
        let listenerCount: Int?
        let speakerCount: Int?
        let participantCount: Int?
        let youAreHost: Bool?
        var id: String { key }
        var isVideo: Bool { medium == "video" }
    }
    let rooms: [Room]
}

/// Everything a profile screen shows, loaded together.
struct ProfileBundle {
    var profile: MemberProfile
    var isMe = false
    var topEight: TopEight?
    var friends: FriendsList?
    var clips: [ClipsList.Clip] = []
    var wall: WallPage?
    var album: AlbumPage?
    var songs: SongsList?
    var plays: [String: Int] = [:]
    var visitors: VisitorStats?
    var bookings: ProfileBookings?
    var liveRoom: LiveRooms.Room?
}
