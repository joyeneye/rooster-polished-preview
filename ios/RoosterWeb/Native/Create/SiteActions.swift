import UIKit

/// The saves behind the site's create and edit buttons, each one following the handler it
/// talks to. Every method returns the site's own words for the outcome, so a screen can show
/// them as they are — including "held for review" and a full album.
struct SiteActions {
    let api: FeedAPI

    // MARK: - WYD posts (social-feed.mts:206-282)

    struct Created: Decodable { let post: FeedPost?; let duplicate: Bool? }

    /// "Post / Share an update". The site refuses any < or > in a post (social-feed.mts:31).
    func post(_ text: String) async -> Result<FeedPost?, FeedError> {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return .failure(.failed("Write something first.")) }
        guard !body.contains("<"), !body.contains(">") else {
            return .failure(.failed("Posts can't include < or >."))
        }
        guard body.count <= 5000 else { return .failure(.failed("Keep a post under 5,000 characters.")) }
        do {
            let made = try await api.post("/api/community/feed",
                                          body: ["body": body, "content_type": "text_post", "visibility": "public"],
                                          as: Created.self)
            return .success(made.post)
        } catch let error as FeedError { return .failure(error) }
        catch { return .failure(.failed("That didn't post. Try again.")) }
    }

    /// "Take a Pic": the photo goes into your album first, then a photo post points at it
    /// (community-home.js:764-788). The request id is fixed per photo, so a retry after a
    /// dropped connection cannot post it twice.
    func postPhoto(_ image: UIImage, caption: String, location: String, requestId: String) async -> Result<FeedPost?, FeedError> {
        guard let jpeg = PhotoPrep.jpeg(image, longestSide: 1600, underBytes: 2_900_000) else {
            return .failure(.failed("That photo couldn't be read."))
        }
        struct Saved: Decodable { struct Photo: Decodable { let id: String }; let photo: Photo }
        do {
            let saved = try await api.upload("/api/member-album/upload",
                                             fields: ["caption": String(caption.prefix(500))],
                                             file: jpeg, fileField: "photo", filename: "photo.jpg",
                                             contentType: "image/jpeg", as: Saved.self)
            var metadata: [String: Any] = ["album_photo": ["id": saved.photo.id], "photo_request_id": requestId]
            let place = location.trimmingCharacters(in: .whitespacesAndNewlines)
            if !place.isEmpty { metadata["location"] = String(place.prefix(100)) }
            let made = try await api.post("/api/community/feed",
                                          body: ["body": String(caption.prefix(500)), "content_type": "photo_post",
                                                 "visibility": "public", "metadata": metadata],
                                          as: Created.self)
            return .success(made.post)
        } catch let error as FeedError { return .failure(error) }
        catch { return .failure(.failed("That photo didn't post. Try again.")) }
    }

    /// "Delete my post". Only your own; the site checks too (social-feed.mts:255-282).
    func deletePost(_ id: String) async -> FeedError? {
        struct Gone: Decodable { let deleted: Bool? }
        do {
            _ = try await api.delete("/api/community/feed", body: ["post_id": Int(id) ?? id], as: Gone.self)
            return nil
        } catch let error as FeedError { return error }
        catch { return .failed("That post didn't delete. Try again.") }
    }

    // MARK: - Top 8 (top-eight-roster.mts)

    func topEight() async throws -> TopEight {
        try await api.get("/api/top-eight-roster?target_id=self", as: TopEight.self)
    }

    /// Up to eight different people, in order. They need not be on your roster.
    func saveTopEight(_ order: [String]) async -> Result<TopEight, FeedError> {
        do { return .success(try await api.put("/api/top-eight-roster?target_id=self",
                                              body: ["order": Array(order.prefix(8))], as: TopEight.self)) }
        catch let error as FeedError { return .failure(error) }
        catch { return .failure(.failed("Your Top 8 didn't save. Try again.")) }
    }

    // MARK: - Songs (member-songs.mts)

    func songs() async throws -> SongSlots {
        try await api.get("/api/member-songs/me", as: SongSlots.self)
    }

    /// "Song / Add music" puts a YouTube, Spotify or Apple Music link in one of three slots.
    /// The slot's current revision has to come back with it, or the site refuses the save
    /// as a change made in another window.
    func addSongLink(slot: Int, revision: String?, title: String, url: String) async -> FeedError? {
        struct Saved: Decodable { let status: String? }
        do {
            _ = try await api.post("/api/member-songs/link",
                                   body: ["slot": slot, "revision": revision ?? NSNull(),
                                          "request_id": UUID().uuidString.lowercased(),
                                          "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
                                          "url": url.trimmingCharacters(in: .whitespacesAndNewlines)],
                                   as: Saved.self)
            return nil
        } catch let error as FeedError { return error }
        catch { return .failed("That song didn't save. Try again.") }
    }

    // MARK: - Photo and status (member-profiles.mts:188-283)

    /// "Edit photo & status". Status is required on every save; the photo is optional and is
    /// stored exactly as sent, so it is shrunk to a JPEG here first. Status goes through the
    /// site's moderation: it can come back held for review (202) or refused (422).
    func updateProfile(status: String, photo: UIImage?) async -> Result<String, FeedError> {
        let text = status.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...160).contains(text.count) else { return .failure(.failed("Your status needs 1 to 160 characters.")) }
        var file: Data?
        if let photo {
            guard let jpeg = PhotoPrep.jpeg(photo, longestSide: 1200, underBytes: 2_900_000) else {
                return .failure(.failed("That photo couldn't be read."))
            }
            file = jpeg
        }
        struct Saved: Decodable { let status: String?; let error: String? }
        do {
            let saved = try await api.upload("/api/profile/update",
                                             fields: ["status": text, "request_id": UUID().uuidString.lowercased()],
                                             file: file, fileField: "photo", filename: "photo.jpg",
                                             contentType: "image/jpeg", as: Saved.self)
            if saved.status == "pending" {
                return .success(saved.error ?? "Your status is being reviewed. Your profile is unchanged for now.")
            }
            return .success("Saved.")
        } catch let error as FeedError { return .failure(error) }
        catch { return .failure(.failed("Your profile didn't save. Try again.")) }
    }

    // MARK: - Presence (member-presence.mts)

    /// Who is online, for a profile's status line. This read needs no session.
    func presence(_ ids: [String]) async -> [String: Bool] {
        struct Statuses: Decodable { let statuses: [String: Bool] }
        let list = ids.prefix(40).joined(separator: ",")
        guard !list.isEmpty,
              let read = try? await api.get("/api/member-presence?ids=\(list)", as: Statuses.self) else { return [:] }
        return read.statuses
    }
}

/// /api/member-songs/me (member-songs.mts:281-288).
struct SongSlots: Decodable {
    struct Slot: Decodable, Hashable, Identifiable {
        let slot: Int
        let revision: String?
        let status: String
        let title: String?
        let provider: String?
        let externalUrl: String?
        var id: Int { slot }
        var isEmpty: Bool { status == "empty" }
    }
    let slots: [Slot]
}

/// The site takes JPEG, PNG or WebP and refuses anything over 3 MB. A phone photo is a
/// HEIC of 3–6 MB, so every upload is redrawn as a JPEG and stepped down until it fits.
enum PhotoPrep {
    static func jpeg(_ image: UIImage, longestSide: CGFloat, underBytes: Int) -> Data? {
        var side = longestSide
        for _ in 0..<4 {
            let scale = min(1, side / max(image.size.width, image.size.height, 1))
            let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
            let format = UIGraphicsImageRendererFormat.default()
            format.scale = 1
            format.opaque = true
            let drawn = UIGraphicsImageRenderer(size: size, format: format).image { context in
                UIColor.white.setFill()
                context.fill(CGRect(origin: .zero, size: size))
                image.draw(in: CGRect(origin: .zero, size: size))
            }
            for quality in [0.86, 0.72, 0.58] as [CGFloat] {
                if let data = drawn.jpegData(compressionQuality: quality), data.count <= underBytes { return data }
            }
            side *= 0.75
        }
        return nil
    }

    static func jpeg(_ data: Data, longestSide: CGFloat, underBytes: Int) -> Data? {
        UIImage(data: data).flatMap { jpeg($0, longestSide: longestSide, underBytes: underBytes) }
    }
}

/// The online heartbeat the site sends while a member has it open: "active" every 45 seconds,
/// "offline" when they leave (community.js:5, 10, 82-84). Presence lasts 90 seconds.
@MainActor
final class PresenceBeat {
    private let api: FeedAPI
    private let session = UUID().uuidString.lowercased()
    private var loop: Task<Void, Never>?

    init(api: FeedAPI) { self.api = api }

    func start() {
        guard loop == nil else { return }
        loop = Task { [api, session] in
            struct Ok: Decodable { let ok: Bool? }
            while !Task.isCancelled {
                _ = try? await api.post("/api/member-presence", body: ["session_id": session, "state": "active"], as: Ok.self)
                try? await Task.sleep(for: .seconds(45))
            }
        }
    }

    func stop() {
        loop?.cancel()
        loop = nil
        let api = api, session = session
        Task.detached {
            struct Ok: Decodable { let ok: Bool? }
            _ = try? await api.post("/api/member-presence", body: ["session_id": session, "state": "offline"], as: Ok.self)
        }
    }
}
