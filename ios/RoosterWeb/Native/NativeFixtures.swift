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
