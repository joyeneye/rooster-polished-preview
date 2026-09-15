import Foundation

/// A member in the directory, as /api/members returns them (member-directory.mts:6-31).
struct DirectoryMember: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let photoUrl: String?
    let joinedAt: String?
    let profession: String?
    let titleLines: String?
    let location: String?
    let relationship: String?
    let online: Bool?

    var relationshipState: Relationship { Relationship(rawValue: relationship ?? "none") ?? .none }

    /// "Producer", or the member's own title lines when they have no profession set.
    var workLabel: String? {
        if let profession, let label = Professions.shortLabels[profession], profession != "other" { return label }
        let title = titleLines?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return title.isEmpty ? nil : title
    }

    var shortLocation: String? {
        let place = location?.split(whereSeparator: { ",\n|/".contains($0) }).first?.trimmingCharacters(in: .whitespaces) ?? ""
        return place.isEmpty ? nil : place
    }

    var profilePath: String { "/profile.html?id=\(id)" }
}

enum Relationship: String {
    case `self`, none, accepted, incoming, outgoing, declined, following
}

struct DirectoryPage: Decodable {
    struct Context: Decodable {
        struct Viewer: Decodable {
            let id: String
            let profession: String?
            let titleLines: String?
            let location: String?
        }
        let viewer: Viewer
        let ready: Bool
    }

    let members: [DirectoryMember]
    let connectionContext: Context?
    let total: Int?
    let nextOffset: Int?
}

/// The profession tables from people-connections.js:4-7.
enum Professions {
    static let shortLabels: [String: String] = [
        "musician": "Artist", "producer": "Producer", "songwriter": "Songwriter", "engineer": "Audio engineer",
        "a_and_r": "A&R", "dj": "DJ", "barber": "Barber", "hairstylist": "Hair specialist",
        "beauty_products": "Hair & beauty products", "journalist": "Journalist", "podcaster": "Podcaster",
        "photographer": "Photographer", "designer": "Designer", "model": "Model", "creator": "Content creator",
        "business": "Business owner", "speaker": "Speaker", "ministry": "Ministry / church leadership",
        "logistics": "Trucking / logistics", "other": "Other work",
    ]

    enum Goal: String, CaseIterable, Identifiable {
        case all, music, beauty, content, brand, services
        var id: String { rawValue }
        var title: String {
            switch self {
            case .all: "For you"
            case .music: "Make music"
            case .beauty: "Build in hair & beauty"
            case .content: "Create content"
            case .brand: "Build a brand"
            case .services: "Grow services & events"
            }
        }
    }

    static let groups: [Goal: Set<String>] = [
        .music: ["musician", "producer", "songwriter", "engineer", "a_and_r", "dj"],
        .beauty: ["barber", "hairstylist", "beauty_products", "model"],
        .content: ["creator", "photographer", "designer", "model", "podcaster", "journalist"],
        .brand: ["business", "creator", "designer", "photographer", "beauty_products"],
        .services: ["business", "speaker", "ministry", "logistics"],
    ]

    static let pairs: [String: Set<String>] = [
        "musician": ["producer", "songwriter", "engineer", "dj", "a_and_r", "photographer"],
        "producer": ["musician", "songwriter", "engineer", "dj", "podcaster"],
        "songwriter": ["musician", "producer", "a_and_r"],
        "engineer": ["producer", "musician", "podcaster"],
        "a_and_r": ["musician", "producer", "songwriter"],
        "dj": ["producer", "musician", "business"],
        "barber": ["creator", "photographer", "beauty_products"],
        "hairstylist": ["beauty_products", "creator", "photographer", "model"],
        "beauty_products": ["hairstylist", "creator", "photographer", "model", "barber"],
        "creator": ["photographer", "designer", "beauty_products", "business", "podcaster"],
        "photographer": ["creator", "model", "hairstylist", "barber", "musician", "business"],
        "designer": ["business", "creator", "musician"],
        "model": ["photographer", "hairstylist", "beauty_products", "designer"],
        "podcaster": ["journalist", "producer", "engineer", "creator"],
        "journalist": ["podcaster", "photographer", "creator"],
        "business": ["creator", "designer", "photographer", "dj", "speaker", "logistics"],
        "speaker": ["business", "podcaster", "journalist", "ministry"],
        "ministry": ["speaker", "photographer", "business"],
        "logistics": ["business"],
    ]
}

struct ConnectionMatch: Hashable, Identifiable {
    let member: DirectoryMember
    let reason: String
    let score: Int
    let sameCity: Bool
    let index: Int
    var id: String { member.id }
}

/// rank() from people-connections.js:13-36, line for line.
enum Connections {
    private static let memberID = try! NSRegularExpression(pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", options: .caseInsensitive)

    static func isMemberID(_ value: String) -> Bool {
        memberID.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil
    }

    static func city(_ value: String?) -> String {
        guard let value, value.rangeOfCharacter(from: CharacterSet(charactersIn: "0123456789@<>")) == nil else { return "" }
        let first = value.split(omittingEmptySubsequences: false, whereSeparator: { ",\n|/".contains($0) }).first.map(String.init) ?? ""
        let place = first.trimmingCharacters(in: .whitespaces).lowercased().split(whereSeparator: \.isWhitespace).joined(separator: " ")
        let excluded: Set<String> = ["united states", "usa", "us", "united kingdom", "worldwide", "online", "remote"]
        return (3...50).contains(place.count) && !excluded.contains(place) ? place : ""
    }

    static func rank(_ members: [DirectoryMember], viewer: DirectoryPage.Context.Viewer?, goal: Professions.Goal = .all,
                     dismissed: Set<String> = []) -> [ConnectionMatch] {
        guard let viewer, isMemberID(viewer.id) else { return [] }
        let own = viewer.profession.flatMap { Professions.shortLabels[$0] != nil ? $0 : nil } ?? ""
        let ownCity = city(viewer.location)
        var seen = Set<String>()
        var matches: [ConnectionMatch] = []
        for (index, member) in members.prefix(120).enumerated() {
            guard isMemberID(member.id), member.id != viewer.id, !seen.contains(member.id), !dismissed.contains(member.id),
                  member.relationshipState == .none else { continue }
            seen.insert(member.id)
            guard let work = member.profession, let workLabel = Professions.shortLabels[work], work != "other" else { continue }
            var score = 0
            var reason = ""
            if goal != .all {
                guard Professions.groups[goal]?.contains(work) == true else { continue }
                score = 40
                reason = "\(workLabel) · matches your “\(goal.title)” goal"
            } else if Professions.pairs[own]?.contains(work) == true, let ownLabel = Professions.shortLabels[own] {
                score = 40
                reason = "\(ownLabel) + \(workLabel): complementary work"
            } else if !own.isEmpty && own == work {
                score = 25
                reason = "You both work in \(workLabel.lowercased())"
            } else if !own.isEmpty && Professions.groups.values.contains(where: { $0.contains(own) && $0.contains(work) }) {
                score = 15
                reason = "\(workLabel) in your creative field"
            }
            let sameCity = !ownCity.isEmpty && ownCity == city(member.location)
            if sameCity {
                score += 8
                if reason.isEmpty { reason = "You both list \(member.shortLocation ?? "the same area")" }
            }
            guard score > 0 else { continue }
            matches.append(ConnectionMatch(member: member, reason: reason, score: score, sameCity: sameCity, index: index))
        }
        return matches.sorted { $0.score != $1.score ? $0.score > $1.score : $0.index < $1.index }
    }
}
