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

#if DEBUG
extension NativeFixtures {
    static func rooms() -> LiveRooms? {
        guard enabled else { return nil }
        return try? FeedAPI.decoder.decode(LiveRooms.self, from: Data("""
        {"rooms": [
          {"key": "abc123def456", "title": "Sunday cypher: bring 16 bars", "description": "Open mic for anyone on the roster. Hosts pick the next up.", "medium": "audio", "host_id": "4b1d7c2e-1111-4a6b-9c3d-000000000002", "host_name": "Marcus Lane", "host_photo_url": "/assets/slots-ads/podcast-v1.jpg", "participant_count": 23, "speaker_count": 4, "listener_count": 19},
          {"key": "zzz999yyy888", "title": "Studio session: finishing the hook", "description": "", "medium": "video", "host_id": "4b1d7c2e-1111-4a6b-9c3d-000000000001", "host_name": "Nia Carter", "host_photo_url": "/assets/slots-ads/hair-v1.jpg", "participant_count": 58, "speaker_count": 1, "listener_count": 57}
        ]}
        """.utf8))
    }
}
#endif

#if DEBUG
extension NativeFixtures {
    static func mailbox() -> Mailbox? {
        guard enabled else { return nil }
        return try? FeedAPI.decoder.decode(Mailbox.self, from: Data("""
        {"user": {"id": "me-0001", "name": "Jeffrey O"},
         "unread_count": 2, "unread_ids": ["m3"], "next": {"inbox_before": null, "sent_before": null},
         "inbox": [
           {"id": "m1", "sender_id": "4b1d7c2e-1111-4a6b-9c3d-000000000002", "recipient_id": "me-0001", "sender_name": "Marcus Lane", "recipient_name": "Jeffrey O", "subject": "New message", "body": "Yo, that hook is crazy. I have studio time Saturday if you want it.", "created_at": "2026-09-15T14:02:00Z"},
           {"id": "m3", "sender_id": "4b1d7c2e-1111-4a6b-9c3d-000000000003", "recipient_id": "me-0001", "sender_name": "Tasha Monroe", "recipient_name": "Jeffrey O", "subject": "Photo", "body": "", "created_at": "2026-09-15T16:40:00Z", "photo": {"url": "/assets/slots-ads/fashion-v1.jpg", "mime": "image/jpeg", "width": 1200, "height": 800}}],
         "sent": [
           {"id": "m2", "sender_id": "me-0001", "recipient_id": "4b1d7c2e-1111-4a6b-9c3d-000000000002", "sender_name": "Jeffrey O", "recipient_name": "Marcus Lane", "subject": "Reply", "body": "Saturday works. I'll bring the stems.", "created_at": "2026-09-15T15:10:00Z"}]}
        """.utf8))
    }
}
#endif

#if DEBUG
extension NativeFixtures {
    static func workspace() -> ManagerWorkspace? {
        guard enabled else { return nil }
        return try? FeedAPI.decoder.decode(ManagerWorkspace.self, from: Data("""
        {"truncated": false,
         "messages": [{"role": "user", "content": "How much am I still owed?"},
                      {"role": "assistant", "content": "You have $1,240.00 outstanding, and $320.00 of that is past its expected date."}],
         "records": [
          {"id": 1, "kind": "royalty", "title": "Late Checkout — publishing", "status": "open", "relation_key": "late-checkout", "updated_at": "2026-09-10T12:00:00Z",
           "data": {"record_type": "money-v1", "song_title": "Late Checkout", "source": "Songtrust", "income_type": "Publishing", "currency": "USD", "earned_cents": 84000, "paid_cents": 52000, "expected_date": "2026-08-30", "paid_date": "2026-07-15", "period": "Q2 2026", "territory": "US", "statement_reference": "ST-88213", "notes": "Split with Marcus 50/50."}},
          {"id": 2, "kind": "royalty", "title": "Southside Summer — streaming", "status": "open", "relation_key": "southside", "updated_at": "2026-09-12T12:00:00Z",
           "data": {"record_type": "money-v1", "song_title": "Southside Summer", "source": "DistroKid", "income_type": "Streaming", "currency": "USD", "earned_cents": 42000, "paid_cents": 0, "expected_date": "2026-10-15", "paid_date": "", "period": "Aug 2026", "territory": "Worldwide", "statement_reference": "", "notes": ""}},
          {"id": 3, "kind": "royalty", "title": "Houston show", "status": "closed", "relation_key": "show", "updated_at": "2026-09-01T12:00:00Z",
           "data": {"record_type": "money-v1", "song_title": "", "source": "The Studio at Midtown", "income_type": "Shows", "currency": "USD", "earned_cents": 60000, "paid_cents": 60000, "expected_date": "2026-08-20", "paid_date": "2026-08-20", "period": "", "territory": "", "statement_reference": "", "notes": ""}},
          {"id": 4, "kind": "song", "title": "Late Checkout", "status": "open", "relation_key": "late-checkout", "updated_at": "2026-09-08T12:00:00Z",
           "data": {"title": "Late Checkout", "artist": "Nia Carter", "collaborators": "Marcus Lane", "isrc": "USRC17607839", "notes": "Hook rewritten 9/12."}},
          {"id": 5, "kind": "document", "title": "Late Checkout split sheet", "status": "open", "relation_key": "late-checkout", "updated_at": "2026-09-09T12:00:00Z",
           "data": {"document_type": "split-sheet", "song_title": "Late Checkout", "artist": "Nia Carter", "date": "2026-09-09",
                    "contributors": [{"name": "Nia Carter", "role": "Writer", "share": 50}, {"name": "Marcus Lane", "role": "Producer", "share": 35}, {"name": "Dre Wallace", "role": "Writer", "share": 15}]}},
          {"id": 6, "kind": "person", "title": "Marcus Lane", "status": "open", "relation_key": "marcus", "updated_at": "2026-09-05T12:00:00Z",
           "data": {"name": "Marcus Lane", "role": "Producer", "company": "Lane Audio", "email": "marcus@example.com", "phone": "", "notes": "Engineer for the EP."}}]}
        """.utf8))
    }

    static func reviewRoom() -> ReviewRoom? {
        guard enabled else { return nil }
        return try? FeedAPI.decoder.decode(ReviewRoom.self, from: Data("""
        {"workspace": {"slug": "jwhite", "name": "J.White's Review Room", "bio": "Send a record. Get honest feedback."},
         "permissions": {"reviewer": false, "admin": false},
         "stats": {"waiting": 2, "reviewed": 1, "revenue_cents": 0, "pending_cents": 0},
         "tiers": [{"code": "free", "name": "Free lane", "description": "When there's room.", "price_cents": 0, "priority_weight": 1, "active": true},
                   {"code": "priority", "name": "Priority", "description": "Front of the queue this week.", "price_cents": 2500, "priority_weight": 5, "active": true}],
         "queue": [
           {"id": 11, "public_id": "q1", "artist_name": "Nia Carter", "title": "Late Checkout", "genre": "R&B", "mood": "Late night", "tier_code": "priority", "status": "waiting", "source_type": "upload", "audio_url": "", "featured": true, "queue_status": "waiting", "queue_position": 1, "created_at": "2026-09-15T12:00:00Z"},
           {"id": 12, "public_id": "q2", "artist_name": "Dre Wallace", "title": "No Hook Needed", "genre": "Hip-Hop", "tier_code": "free", "status": "waiting", "source_type": "link", "source_url": "https://open.spotify.com/track/1", "queue_status": "waiting", "queue_position": 2, "created_at": "2026-09-14T12:00:00Z"}],
         "submissions": [
           {"id": 13, "public_id": "s1", "room_name": "J.White's Review Room", "artist_name": "You", "title": "Southside Summer", "genre": "Hip-Hop", "tier_code": "free", "status": "reviewed", "source_type": "upload", "audio_url": "", "song_info": "Listen to the second verse.", "created_at": "2026-09-02T12:00:00Z",
            "review": {"overall_score": 8, "scores": {"songwriting": 8, "production": 7, "originality": 9, "replay": 8}, "feedback": "The verse writing is the strongest part. Tighten the mix on the low end and this is ready.", "visibility": "private", "decision": "approve", "published_at": "2026-09-06T12:00:00Z"}}]}
        """.utf8))
    }
}
#endif

#if DEBUG
extension NativeFixtures {
    static func chat() -> ChatPage? {
        guard enabled else { return nil }
        let now = Date()
        func stamp(_ secondsAgo: Double) -> String { ISO8601DateFormatter().string(from: now.addingTimeInterval(-secondsAgo)) }
        return try? FeedAPI.decoder.decode(ChatPage.self, from: Data("""
        {"room": "The Listening Room", "next": null, "messages": [
          {"id": "c1", "member_id": "4b1d7c2e-1111-4a6b-9c3d-000000000002", "name": "Marcus Lane", "body": "Who's got something new today?", "created_at": "\(stamp(48))"},
          {"id": "c2", "member_id": "4b1d7c2e-1111-4a6b-9c3d-000000000001", "name": "Nia Carter", "body": "Just dropped a rough mix in the review room 👀", "created_at": "\(stamp(31))"},
          {"id": "c3", "member_id": "owner", "name": "J.White", "body": "Pull it up. I'm listening.", "created_at": "\(stamp(9))"}]}
        """.utf8))
    }
}
#endif

#if DEBUG
extension NativeFixtures {
    static func accessOverview() -> AccessOverview? {
        guard enabled else { return nil }
        return try? FeedAPI.decoder.decode(AccessOverview.self, from: Data("""
        {"counts": {"approved": 31, "pending": 3, "declined": 1, "waiting_requests": 2, "usable_invitations": 4},
         "requests": [
           {"id": 1, "name": "Kayla Brooks", "email": "kayla@example.com", "about": "Hairstylist in Houston, been following since the first Top Rosters.", "status": "waiting", "member_id": null, "invite_code": null, "created_at": "2026-09-14T18:00:00Z"},
           {"id": 2, "name": "Andre Cole", "email": "andre@example.com", "about": "Producer, worked on two independent EPs.", "status": "waiting", "member_id": null, "invite_code": null, "created_at": "2026-09-15T12:00:00Z"}],
         "invitations": [
           {"id": 9, "code": "ROSTER-7K2M-QP44", "note": "For Kayla", "uses": 0, "max_uses": 1, "expires_at": "2026-10-15T00:00:00Z", "revoked_at": null, "created_at": "2026-09-15T12:00:00Z", "usable": true},
           {"id": 8, "code": "ROSTER-3A9X-BB21", "note": "Studio night", "uses": 2, "max_uses": 2, "expires_at": null, "revoked_at": null, "created_at": "2026-09-01T12:00:00Z", "usable": false}],
         "members": [
           {"member_id": "4b1d7c2e-1111-4a6b-9c3d-000000000001", "name": "Nia Carter", "status": "approved", "grandfathered": false, "invite_code": "ROSTER-1A2B-3C4D", "created_at": "2026-06-02T12:00:00Z", "decided_at": null},
           {"member_id": "4b1d7c2e-1111-4a6b-9c3d-000000000002", "name": "Marcus Lane", "status": "pending", "grandfathered": false, "invite_code": null, "created_at": "2026-09-10T12:00:00Z", "decided_at": null}]}
        """.utf8))
    }

    static func bookingAccount() -> BookingAccount? {
        guard enabled else { return nil }
        return try? FeedAPI.decoder.decode(BookingAccount.self, from: Data("""
        {"businesses": [{"id": 1, "slug": "nia-vocals", "name": "Nia Carter Vocals", "published": true, "currency": "USD", "stripe_charges_enabled": false, "role": "owner"}]}
        """.utf8))
    }

    static func bookingDashboard() -> BookingDashboard? {
        guard enabled else { return nil }
        return try? FeedAPI.decoder.decode(BookingDashboard.self, from: Data("""
        {"business": {"id": 1, "slug": "nia-vocals", "name": "Nia Carter Vocals", "published": true, "currency": "USD"},
         "metrics": {"today_appointments": 2, "upcoming_appointments": 5, "today_revenue_cents": 18000, "month_revenue_cents": 142000, "clients": 23, "rating": 4.8},
         "upcoming": []}
        """.utf8))
    }

    static func bookingAppointments() -> BookingAppointments? {
        guard enabled else { return nil }
        let now = Date()
        func stamp(_ hours: Double) -> String { ISO8601DateFormatter().string(from: now.addingTimeInterval(hours * 3600)) }
        return try? FeedAPI.decoder.decode(BookingAppointments.self, from: Data("""
        {"appointments": [
          {"appointment": {"id": 11, "public_id": "p1", "confirmation_code": "AB12", "status": "confirmed", "starts_at": "\(stamp(3))", "ends_at": "\(stamp(4))", "price_cents": 9000}, "service_name": "Vocal session", "staff_name": "Nia", "client_name": "Marcus Lane", "client_phone": "(713) 555-0134"},
          {"appointment": {"id": 12, "public_id": "p2", "confirmation_code": "CD34", "status": "completed", "starts_at": "\(stamp(-26))", "ends_at": "\(stamp(-25))", "price_cents": 9000}, "service_name": "Demo coaching", "staff_name": "Nia", "client_name": "Tasha Monroe"}]}
        """.utf8))
    }

    static func bookingClients() -> BookingClients? {
        guard enabled else { return nil }
        return try? FeedAPI.decoder.decode(BookingClients.self, from: Data("""
        {"clients": [
          {"id": 1, "name": "Marcus Lane", "email": "marcus@example.com", "phone": "(713) 555-0134", "appointment_count": 4, "total_spend_cents": 36000, "next_appointment_at": null},
          {"id": 2, "name": "Tasha Monroe", "email": "tasha@example.com", "phone": null, "appointment_count": 2, "total_spend_cents": 18000, "next_appointment_at": null}]}
        """.utf8))
    }

    static func bookingServices() -> BookingServices? {
        guard enabled else { return nil }
        return try? FeedAPI.decoder.decode(BookingServices.self, from: Data("""
        {"services": [
          {"id": 1, "name": "Vocal session", "description": "Two hours in the booth.", "price_cents": 9000, "duration_minutes": 120, "online_booking_enabled": true, "active": true},
          {"id": 2, "name": "Demo coaching", "description": "", "price_cents": 6000, "duration_minutes": 60, "online_booking_enabled": true, "active": false}],
         "staff": [{"id": 1, "name": "Nia Carter", "photo_url": "/assets/slots-ads/hair-v1.jpg", "role": "Owner"}]}
        """.utf8))
    }
}
#endif

#if DEBUG
extension NativeFixtures {
    static func account() -> (AccessState, MemberProfile?)? {
        guard enabled, let access = try? FeedAPI.decoder.decode(AccessState.self, from: Data("""
        {"invite_only": true, "signed_in": true, "approved": true, "status": "approved", "is_owner": true,
         "member_id": "4b1d7c2e-1111-4a6b-9c3d-0000000000aa", "name": "Jeffrey O", "message": ""}
        """.utf8)) else { return nil }
        return (access, profile(id: nil)?.profile)
    }
}
#endif
