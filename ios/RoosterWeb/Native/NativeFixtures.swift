#if DEBUG
import Foundation

/// Sample data for native screens on the simulator, where nobody can sign in. Debug builds only,
/// and only when launched with -RoosterFixtures. Photos are the site's own promo images; the
/// members are made up.
enum NativeFixtures {
    static var enabled: Bool { ProcessInfo.processInfo.arguments.contains("-RoosterFixtures") }

    static func directory(query: String) -> DirectoryPage? {
        guard enabled else { return nil }
        let json = """
        {"members": [
          {"id": "4b1d7c2e-1111-4a6b-9c3d-000000000001", "name": "Nia Carter", "photo_url": "/assets/slots-ads/hair-v1.jpg", "joined_at": "2026-09-14T18:00:00Z", "profession": "musician", "title_lines": "", "location": "Houston, TX", "relationship": "none", "online": true},
          {"id": "4b1d7c2e-1111-4a6b-9c3d-000000000002", "name": "Marcus Lane", "photo_url": "/assets/slots-ads/podcast-v1.jpg", "joined_at": "2026-09-13T18:00:00Z", "profession": "engineer", "title_lines": "", "location": "Dallas, TX", "relationship": "none", "online": false},
          {"id": "4b1d7c2e-1111-4a6b-9c3d-000000000003", "name": "Tasha Monroe", "photo_url": "/assets/slots-ads/fashion-v1.jpg", "joined_at": "2026-09-12T18:00:00Z", "profession": "photographer", "title_lines": "", "location": "Houston", "relationship": "incoming", "online": true},
          {"id": "4b1d7c2e-1111-4a6b-9c3d-000000000004", "name": "Dre Wallace", "photo_url": "/assets/slots-ads/sports-v1.jpg", "joined_at": "2026-09-11T18:00:00Z", "profession": "songwriter", "title_lines": "", "location": "Atlanta, GA", "relationship": "accepted", "online": null},
          {"id": "4b1d7c2e-1111-4a6b-9c3d-000000000005", "name": "Kayla Brooks", "photo_url": null, "joined_at": "2026-09-10T18:00:00Z", "profession": "hairstylist", "title_lines": "", "location": "Houston, TX", "relationship": "outgoing", "online": false},
          {"id": "4b1d7c2e-1111-4a6b-9c3d-000000000006", "name": "J.T. Ramos", "photo_url": "/assets/slots-ads/barber-v1.jpg", "joined_at": "2026-09-09T18:00:00Z", "profession": "dj", "title_lines": "", "location": "San Antonio", "relationship": "none", "online": true},
          {"id": "4b1d7c2e-1111-4a6b-9c3d-000000000007", "name": "Brianna Cole", "photo_url": null, "joined_at": "2026-09-08T18:00:00Z", "profession": "", "title_lines": "Vocal coach · Session singer", "location": "Online", "relationship": "none", "online": false}
        ],
        "connection_context": {"viewer": {"id": "4b1d7c2e-1111-4a6b-9c3d-0000000000aa", "profession": "producer", "title_lines": "", "location": "Houston, TX"}, "ready": true},
        "total": 31, "next_offset": null}
        """
        guard var page = try? FeedAPI.decoder.decode(DirectoryPage.self, from: Data(json.utf8)) else { return nil }
        let trimmed = query.trimmingCharacters(in: .whitespaces).lowercased()
        if !trimmed.isEmpty {
            page = DirectoryPage(members: page.members.filter { $0.name.lowercased().contains(trimmed) },
                                 connectionContext: page.connectionContext, total: page.total, nextOffset: nil)
        }
        return page
    }
}
#endif

#if DEBUG
extension NativeFixtures {
    static func profile(id: String?) -> ProfileBundle? {
        guard enabled else { return nil }
        let decode: (String) -> ProfileResponse? = { try? FeedAPI.decoder.decode(ProfileResponse.self, from: Data($0.utf8)) }
        let isMe = id == nil
        guard let response = decode("""
        {"profile": {"id": "4b1d7c2e-1111-4a6b-9c3d-000000000001", "name": "\(isMe ? "Jeffrey O" : "Nia Carter")",
          "status": "Studio all week. Hook is finally sitting right.", "about_me": "Houston singer-songwriter. I write about home, heartbreak and the people who show up. Always looking for producers who want to build something real.",
          "profession": "musician", "website_url": "https://example.com", "title_lines": "", "credentials": "Opened for local tours · 2 independent EPs",
          "location": "Houston, TX", "photo_url": "/assets/slots-ads/hair-v1.jpg", "verified": true, "verified_owner": false,
          "membership": {"level_label": "Early Member", "early_member": true, "founding_member": false, "approved_creator": true, "member_since": "2026-06-02T12:00:00Z"}},
         "can_edit_owner": false}
        """) else { return nil }
        let photos = ["hair-v1", "fashion-v1", "podcast-v1", "barber-v1", "sports-v1", "rooster-radio"]
        var bundle = ProfileBundle(profile: response.profile)
        bundle.isMe = isMe
        bundle.topEight = try? FeedAPI.decoder.decode(TopEight.self, from: Data("""
        {"mode": "custom", "editable": \(isMe), "members": [
          {"id": "a1", "name": "Marcus Lane", "photo_url": "/assets/slots-ads/podcast-v1.jpg"},
          {"id": "a2", "name": "Tasha Monroe", "photo_url": "/assets/slots-ads/fashion-v1.jpg"},
          {"id": "a3", "name": "Dre Wallace", "photo_url": "/assets/slots-ads/sports-v1.jpg"},
          {"id": "a4", "name": "J.T. Ramos", "photo_url": "/assets/slots-ads/barber-v1.jpg"},
          {"id": "a5", "name": "Kayla Brooks", "photo_url": null}]}
        """.utf8))
        bundle.friends = try? FeedAPI.decoder.decode(FriendsList.self, from: Data("""
        {"count": 42, "relationship": {"state": "none"}, "friends": [
          {"member_id": "owner", "member_name": "J.White", "profile_url": "/#home"},
          {"member_id": "b1", "member_name": "Marcus Lane"}, {"member_id": "b2", "member_name": "Tasha Monroe"},
          {"member_id": "b3", "member_name": "Dre Wallace"}, {"member_id": "b4", "member_name": "Brianna Cole"}]}
        """.utf8))
        bundle.clips = (try? FeedAPI.decoder.decode(ClipsList.self, from: Data("""
        {"clips": [
          {"id": "c1", "name": "Nia", "caption": "Studio night", "created_at": "2026-09-14T20:00:00Z", "video_url": "/assets/slots-ads/barber-v1.mp4", "duration": 12},
          {"id": "c2", "name": "Nia", "caption": "Soundcheck", "created_at": "2026-09-12T20:00:00Z", "video_url": "/assets/slots-ads/hair-v1.mp4", "duration": 9},
          {"id": "c3", "name": "Nia", "caption": "On the road", "created_at": "2026-09-10T20:00:00Z", "video_url": "/assets/slots-ads/fashion-v1.mp4", "duration": 15}]}
        """.utf8)))?.clips ?? []
        bundle.wall = try? FeedAPI.decoder.decode(WallPage.self, from: Data("""
        {"total": 3, "next": null, "can_post": true, "comments": [
          {"id": "w1", "name": "J.White", "message": "Welcome to the ROOSTER. Glad you're here.", "created_at": "2026-09-14T18:00:00Z", "status": "approved", "verified_owner": true, "photo_url": null},
          {"id": "w2", "name": "Marcus Lane", "message": "That hook on the new one is crazy. Let's lock in a session.", "created_at": "2026-09-15T10:00:00Z", "status": "approved", "photo_url": "/assets/slots-ads/podcast-v1.jpg"}]}
        """.utf8))
        bundle.album = AlbumPage(total: photos.count, nextOffset: nil, photos: photos.enumerated().map {
            AlbumPage.Photo(id: "p\($0.offset)", url: "/assets/slots-ads/\($0.element).jpg", caption: $0.offset == 0 ? "Fitting day" : nil, createdAt: nil, width: nil, height: nil)
        })
        bundle.songs = try? FeedAPI.decoder.decode(SongsList.self, from: Data("""
        {"songs": [
          {"slot": 1, "revision": "r1", "status": "approved", "title": "Late Checkout", "source": "link", "provider": "youtube", "external_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
          {"slot": 2, "revision": "r2", "status": "approved", "title": "Southside Summer", "source": "link", "provider": "spotify", "external_url": "https://open.spotify.com/track/1"}],
         "featured_songs": [{"slot": 1, "revision": "r9", "title": "Neon Houston", "source": "link", "provider": "youtube", "external_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "origin": {"member_id": "b1", "name": "Marcus Lane"}}]}
        """.utf8))
        bundle.plays = ["r1": 18400, "r2": 2210, "r9": 530]
        bundle.visitors = VisitorStats(today: 38, thisWeek: 214, allTime: 5120, position: 4)
        bundle.bookings = ProfileBookings(businesses: [.init(name: "Nia Carter Vocals", bookingUrl: "/book/nia-vocals", servicesCount: 3)], canManage: isMe)
        return bundle
    }
}
#endif
