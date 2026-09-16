import XCTest
@testable import RoosterWeb

final class FeedMixerTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-09-15T18:00:00Z")!

    private func story(_ id: String, _ category: String, hoursAgo: Double = 2, url: String? = nil) -> Story {
        let date = ISO8601DateFormatter().string(from: now.addingTimeInterval(-hoursAgo * 3600))
        return Story(id: id, title: "Headline \(id)", url: url ?? "https://example.com/\(id)", source: "Source", category: category, publishedAt: date)
    }

    private func post(_ id: Int) -> FeedPost {
        let json = """
        {"id": \(id), "author": {"id": "m\(id)", "name": "Member \(id)", "photo_url": null, "kind": "artist"},
         "content_type": "text_post", "body": "hi", "metadata": {}, "media": [],
         "counts": {"likes": 1, "comments": 0, "reposts": 0, "bookmarks": 0, "views": 3},
         "viewer": {"liked": false, "bookmarked": false, "reposted": false, "can_delete": false},
         "published_at": "2026-09-15T17:00:00.000Z"}
        """
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try! decoder.decode(FeedPost.self, from: Data(json.utf8))
    }

    private let promos = Promos.order(visit: 0)

    func testQuietFeedOpensWithTheCastingCallThenAlternates() {
        let stories = [story("m1", "music"), story("m2", "music"), story("s1", "sports"), story("s2", "sports")]
        let ids = FeedMixer.forYou(posts: [], stories: stories, promos: promos, now: now).map(\.id)
        // Exactly what slots-mix.mjs returns for the same inputs (run under node): eight groups at
        // most, so the last house ad doesn't fit.
        XCTAssertEqual(ids, [
            "promo-girl-group-casting-v1", "news-m1", "news-s1", "promo-hair-v1", "news-m2", "news-s2", "promo-barber-v1",
            "promo-sports-v1", "promo-podcast-v1", "promo-fashion-v1", "promo-orbit-v1", "promo-create-v1",
        ])
    }

    func testBusyFeedKeepsMemberOrderAndSpacesDiscovery() {
        let posts = (1...6).map(post)
        let stories = [story("m1", "music"), story("s1", "sports")]
        let ids = FeedMixer.forYou(posts: posts, stories: stories, promos: promos, now: now).map(\.id)
        XCTAssertEqual(ids, ["post-1", "post-2", "post-3", "promo-girl-group-casting-v1", "post-4", "post-5", "post-6", "news-m1"])
    }

    func testUnsafeStoriesAreDropped() {
        let stale = story("old", "music", hoursAgo: 24 * 8)
        let future = story("future", "sports", hoursAgo: -1)
        let insecure = story("http", "music", url: "http://example.com/a")
        let credentials = story("creds", "music", url: "https://user:pass@example.com/a")
        let otherCategory = story("pol", "politics")
        for bad in [stale, future, insecure, credentials, otherCategory] {
            XCTAssertFalse(FeedMixer.isSafe(bad, now: now), bad.id)
        }
        XCTAssertTrue(FeedMixer.isSafe(story("ok", "sports"), now: now))
    }

    func testPromoRotationKeepsTheCampaignFirst() {
        XCTAssertEqual(Promos.order(visit: 0).map(\.id).prefix(2), ["girl-group-casting-v1", "hair-v1"])
        XCTAssertEqual(Promos.order(visit: 1).map(\.id).prefix(2), ["girl-group-casting-v1", "barber-v1"])
        XCTAssertEqual(Promos.order(visit: Promos.houseAds.count).map(\.id), Promos.order(visit: 0).map(\.id))
        XCTAssertEqual(Set(Promos.order(visit: 3).map(\.id)).count, Promos.houseAds.count + 1)
    }
}

final class FeedDecodingTests: XCTestCase {
    func testPostDecodesTheServerShapeAndToleratesOddMetadata() throws {
        let json = """
        {"id": "42", "author": {"id": "roster", "name": "ROOSTER", "photo_url": "/profile.jpg", "kind": "team"},
         "content_type": "song_post", "body": null, "room_id": 7,
         "metadata": {"title": "Late Checkout", "play_count": "not a number", "location": 12},
         "media": [{"id": 1, "type": "audio", "url": "/a.mp3", "thumbnail_url": null, "alt": null, "duration_ms": 1000, "width": null, "height": null}],
         "counts": {"likes": 1200, "comments": 3, "reposts": 0, "bookmarks": 0, "views": 9},
         "viewer": {"liked": true, "bookmarked": false, "reposted": false, "can_delete": true},
         "featured": false, "published_at": "2026-09-15T17:00:00.000Z"}
        """
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let post = try decoder.decode(FeedPost.self, from: Data(json.utf8))
        XCTAssertEqual(post.id, "42")
        XCTAssertEqual(post.roomId, "7")
        XCTAssertEqual(post.metadata.title, "Late Checkout")
        XCTAssertNil(post.metadata.playCount)
        XCTAssertNil(post.metadata.location)
        XCTAssertEqual(post.surface, .audio)
        XCTAssertEqual(post.profilePath, "/people.html")
        XCTAssertTrue(post.viewer.canDelete)
        XCTAssertEqual(post.kindLabel, "song")
    }

    func testStoriesDecode() throws {
        let json = #"{"stories":[{"id":"a1","title":"T","url":"https://pitchfork.com/x","source":"Pitchfork","category":"music","published_at":"2026-09-15T13:02:24.000Z"}]}"#
        struct Body: Decodable { let stories: [Story] }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let stories = try decoder.decode(Body.self, from: Data(json.utf8)).stories
        XCTAssertEqual(stories.first?.source, "Pitchfork")
        XCTAssertNotNil(stories.first?.date)
    }

    func testRelativeTimesMatchTheSite() {
        let now = ISO8601DateFormatter().date(from: "2026-09-15T18:00:00Z")!
        XCTAssertEqual(FeedDate.ago("2026-09-15T17:59:30.000Z", now: now), "now")
        XCTAssertEqual(FeedDate.ago("2026-09-15T17:15:00Z", now: now), "45m")
        XCTAssertEqual(FeedDate.ago("2026-09-15T13:00:00Z", now: now), "5h")
        XCTAssertEqual(FeedDate.ago("2026-09-12T18:00:00Z", now: now), "3d")
        XCTAssertEqual(Compact.string(999), "999")
        XCTAssertEqual(Compact.string(1284), "1.3K")
    }
}

final class SessionTests: XCTestCase {
    func testTokenExpiryIsReadFromTheJWT() {
        // {"exp": 1789574400} → 2026-09-16T16:00:00Z
        let payload = Data(#"{"sub":"member","exp":1789574400}"#.utf8).base64EncodedString()
            .replacingOccurrences(of: "=", with: "").replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        XCTAssertEqual(JWT.expiry("header.\(payload).signature")?.timeIntervalSince1970, 1_789_574_400)
        XCTAssertNil(JWT.expiry("not-a-token"))
        XCTAssertNil(JWT.expiry("a.!!!.c"))
    }

    func testSignInFormEncodesPasswordsSafely() {
        let form = IdentityAPI.form(["grant_type": "password", "username": "a+b@x.com", "password": "p&ss= w%rd"])
        XCTAssertEqual(form, "grant_type=password&password=p%26ss%3D%20w%25rd&username=a%2Bb%40x.com")
    }

    func testIdentityFailuresReadAsPlainEnglish() {
        let invalid = Data(#"{"error":"invalid_grant","error_description":"No user found with that email, or password invalid."}"#.utf8)
        XCTAssertEqual(IdentityAPI.failure(invalid, status: 400, signingIn: true), .rejected("That email and password don't match a ROOSTER account."))
        let unconfirmed = Data(#"{"error":"invalid_grant","error_description":"Email not confirmed"}"#.utf8)
        XCTAssertEqual(IdentityAPI.failure(unconfirmed, status: 400, signingIn: true),
                       .rejected("Confirm your email first. Check your inbox for the link from ROOSTER."))
        XCTAssertEqual(IdentityAPI.failure(Data(), status: 429, signingIn: true), .message("Too many tries. Wait a minute, then try again."))
        if case .rejected = IdentityAPI.failure(Data(), status: 502, signingIn: true) { XCTFail("a server outage is not a rejected password") }
    }
}

final class NativeRouterTests: XCTestCase {
    private let policy = LinkPolicy(home: URL(string: "https://rooster-polished.vercel.app")!)
    private let member = "4b1d7c2e-1111-4a6b-9c3d-000000000001"

    private func route(_ path: String) -> NativeScreen? {
        NativeRouter.screen(for: URL(string: "https://rooster-polished.vercel.app\(path)")!, policy: policy)
    }

    func testProfileLinksOpenTheNativeProfile() {
        XCTAssertEqual(route("/profile.html?id=\(member)"), .profile(id: member, tab: .posts))
        XCTAssertEqual(route("/profile.html?id=\(member)&view=songs"), .profile(id: member, tab: .music))
        XCTAssertEqual(route("/profile.html?id=owner"), .profile(id: "owner", tab: .posts))
        XCTAssertEqual(route("/#home"), .profile(id: "owner", tab: .posts), "community-home.js turns /#home into J.White's profile")
        XCTAssertEqual(route("/member-photos.html?id=\(member)"), .profile(id: member, tab: .photos))
        XCTAssertEqual(route("/my-profile.html?view=photos"), .profile(id: nil, tab: .photos))
    }

    func testEverythingElseStaysOnTheWeb() {
        XCTAssertNil(route("/profile.html?id=not-a-member"))
        XCTAssertNil(route("/"))
        XCTAssertNil(route("/#mona"))
        XCTAssertNil(route("/live.html"))
        XCTAssertNil(NativeRouter.screen(for: URL(string: "https://jwhitedidit.net/profile.html?id=\(member)")!, policy: policy))
    }

    func testConnectionRankingMatchesTheSite() {
        let decoder = FeedAPI.decoder
        let page = try! decoder.decode(DirectoryPage.self, from: Data("""
        {"members": [
          {"id": "4b1d7c2e-1111-4a6b-9c3d-000000000001", "name": "A", "profession": "dj", "location": "Houston", "relationship": "none"},
          {"id": "4b1d7c2e-1111-4a6b-9c3d-000000000002", "name": "B", "profession": "musician", "location": "Dallas", "relationship": "none"},
          {"id": "4b1d7c2e-1111-4a6b-9c3d-000000000003", "name": "C", "profession": "musician", "location": "Houston, TX", "relationship": "none"},
          {"id": "4b1d7c2e-1111-4a6b-9c3d-000000000004", "name": "D", "profession": "musician", "location": "Houston", "relationship": "accepted"},
          {"id": "4b1d7c2e-1111-4a6b-9c3d-000000000005", "name": "E", "profession": "barber", "location": "Atlanta", "relationship": "none"},
          {"id": "4b1d7c2e-1111-4a6b-9c3d-000000000006", "name": "F", "profession": "producer", "location": "remote", "relationship": "none"}
        ], "connection_context": {"viewer": {"id": "4b1d7c2e-1111-4a6b-9c3d-0000000000aa", "profession": "producer", "location": "Houston, TX"}, "ready": true}}
        """.utf8))
        let ranked = Connections.rank(page.members, viewer: page.connectionContext?.viewer)
        // Producer + (dj|musician) = 40, +8 for the same city; same work = 25; unrelated work and
        // anyone already connected are left out.
        XCTAssertEqual(ranked.map(\.member.name), ["A", "C", "B", "F"])
        XCTAssertEqual(ranked.map(\.score), [48, 48, 40, 25])
        XCTAssertEqual(ranked.first?.reason, "Producer + DJ: complementary work")
        XCTAssertEqual(Connections.rank(page.members, viewer: page.connectionContext?.viewer, goal: .beauty).map(\.member.name), ["E"])
    }
}

final class NativeRouterMoreTests: XCTestCase {
    private let policy = LinkPolicy(home: URL(string: "https://rooster-polished.vercel.app")!)

    private func route(_ path: String) -> NativeScreen? {
        NativeRouter.screen(for: URL(string: "https://rooster-polished.vercel.app\(path)")!, policy: policy)
    }

    func testMoreDestinationsOpenNativeScreens() {
        XCTAssertEqual(route("/top25.html"), .topRosters)
        XCTAssertEqual(route("/about.html"), .about)
        XCTAssertEqual(route("/morespace.html?q=nia"), .search(query: "nia"))
        XCTAssertEqual(route("/members.html#friend-requests"), .requests)
        XCTAssertEqual(route("/members.html#member-mail"), .messages)
        for destination in [ShellDestination.topRosters, .about, .requests, .search, .music, .photos] {
            XCTAssertNotNil(route(destination.path), destination.title)
        }
    }
}

final class NativeRouterBatchTests: XCTestCase {
    private let policy = LinkPolicy(home: URL(string: "https://rooster-polished.vercel.app")!)
    private let member = "4b1d7c2e-1111-4a6b-9c3d-000000000001"

    private func route(_ path: String) -> NativeScreen? {
        NativeRouter.screen(for: URL(string: "https://rooster-polished.vercel.app\(path)")!, policy: policy)
    }

    func testTheRestOfTheSiteRoutesNatively() {
        XCTAssertEqual(route("/members.html#member-mail"), .messages)
        XCTAssertEqual(route("/members.html?to=\(member)#member-mail"), .conversation(memberID: member, name: ""))
        XCTAssertEqual(route("/members.html"), .account)
        XCTAssertEqual(route("/opportunities.html"), .opportunities)
        XCTAssertEqual(route("/apply.html?opportunity=jspace-female-group-2026"), .opportunity(slug: "jspace-female-group-2026"))
        XCTAssertEqual(route("/booking"), .booking)
        XCTAssertEqual(route("/book/nia-vocals"), .bookingProvider(slug: "nia-vocals"))
        XCTAssertEqual(route("/radio.html"), .radio)
        // Screens that are still web pages.
        XCTAssertEqual(route("/rcm.html"), .manager)
        XCTAssertEqual(route("/rcm.html#money"), .managerMoney)
        XCTAssertEqual(route("/review-room.html"), .reviewRoom)
        XCTAssertEqual(route("/members.html#member-chat"), .chatRoom)
        XCTAssertEqual(route("/booking/dashboard"), .bookingDashboard)
    }

    func testPricesFollowTheBusinessCurrency() {
        XCTAssertEqual(Money.string(4500, currency: "USD"), "$45")
        XCTAssertEqual(Money.string(4599, currency: "usd"), "$45.99")
        XCTAssertEqual(Money.string(0, currency: "USD"), "Free")
        XCTAssertNil(Money.string(nil, currency: "USD"))
    }
}

final class ManagerMoneyTests: XCTestCase {
    private func record(_ id: Int, _ data: String) -> ManagerWorkspace.Record {
        let json = """
        {"id": \(id), "kind": "royalty", "title": "Entry \(id)", "status": "open", "relation_key": "k", "updated_at": "2026-09-01T00:00:00Z", "data": \(data)}
        """
        return try! FeedAPI.decoder.decode(ManagerWorkspace.Record.self, from: Data(json.utf8))
    }

    private let good = """
    {"record_type": "money-v1", "song_title": "Late Checkout", "source": "Songtrust", "income_type": "Publishing",
     "currency": "USD", "earned_cents": 84000, "paid_cents": 52000, "expected_date": "2026-08-30", "paid_date": "",
     "period": "", "territory": "", "statement_reference": "", "notes": ""}
    """

    func testTotalsAndStatusesFollowTheSite() {
        let records = [
            record(1, good),
            record(2, #"{"record_type": "money-v1", "source": "DistroKid", "income_type": "Streaming", "currency": "USD", "earned_cents": 42000, "paid_cents": 0, "expected_date": "2026-10-15"}"#),
            record(3, #"{"record_type": "money-v1", "source": "Venue", "income_type": "Shows", "currency": "USD", "earned_cents": 60000, "paid_cents": 60000}"#),
            record(4, #"{"record_type": "money-v1", "source": "JASRAC", "income_type": "Publishing", "currency": "JPY", "earned_cents": 5000, "paid_cents": 0}"#),
            // Refused by the site's rules: paid above earned, an unknown currency, and a wrong type.
            record(5, #"{"record_type": "money-v1", "source": "X", "income_type": "Publishing", "currency": "USD", "earned_cents": 10, "paid_cents": 99}"#),
            record(6, #"{"record_type": "money-v1", "source": "X", "income_type": "Publishing", "currency": "ZZZ", "earned_cents": 10, "paid_cents": 0}"#),
            record(7, #"{"record_type": "note-v1", "source": "X"}"#),
        ]
        let summary = ManagerMoney.summarize(records, today: "2026-09-15")
        XCTAssertEqual(summary.unrecognized, 3)
        XCTAssertEqual(summary.entries.count, 4)
        let usd = summary.groups.first { $0.currency == "USD" }
        XCTAssertEqual(usd?.earnedCents, 186_000)
        XCTAssertEqual(usd?.paidCents, 112_000)
        XCTAssertEqual(usd?.outstandingCents, 74_000)
        XCTAssertEqual(usd?.overdueCents, 32_000, "only the entry past its expected date counts as overdue")
        XCTAssertEqual(summary.entries.map(\.status), ["overdue", "unpaid", "paid", "unpaid"])
        // Currencies are never added together, and JPY has no decimals.
        XCTAssertEqual(summary.groups.map(\.currency), ["USD", "JPY"])
        XCTAssertEqual(ManagerMoney.format(5000, currency: "JPY"), "¥5,000")
        XCTAssertEqual(ManagerMoney.format(84000, currency: "USD"), "$840.00")
        XCTAssertEqual(ManagerMoney.decimal(84050, currency: "USD"), "840.50")
        XCTAssertEqual(ManagerMoney.decimal(5000, currency: "JPY"), "5000")
    }

    func testCSVMatchesTheSiteExport() {
        let summary = ManagerMoney.summarize([record(1, good)], today: "2026-09-15")
        let csv = ManagerMoney.csv(summary.entries)
        XCTAssertTrue(csv.hasPrefix("\u{FEFF}\"Record ID\",\"Song or project\",\"Payer\""))
        XCTAssertTrue(csv.contains("\"1\",\"Late Checkout\",\"Songtrust\",\"Publishing\",\"USD\",\"840.00\",\"520.00\",\"320.00\""))
        XCTAssertTrue(csv.contains("\"overdue\""))
        // A value that starts like a formula is quoted with a leading apostrophe.
        let risky = ManagerMoney.csv([ManagerMoney.Entry(id: 2, title: "", songTitle: "=cmd()", source: "S", incomeType: "Sales",
                                                         currency: "USD", earnedCents: 0, paidCents: 0, expectedDate: "", paidDate: "",
                                                         period: "", territory: "", statementReference: "", notes: "", status: "paid")])
        XCTAssertTrue(risky.contains("\"'=cmd()\""))
    }

    func testSplitSheetReadsItsContributors() {
        let json = """
        {"id": 9, "kind": "document", "title": "Split", "status": "open", "relation_key": "k", "updated_at": "2026-09-01T00:00:00Z",
         "data": {"document_type": "split-sheet", "song_title": "Late Checkout", "artist": "Nia", "date": "2026-09-09",
                  "contributors": [{"name": "Nia", "role": "Writer", "share": 60}, {"name": "Marcus", "role": "Producer", "share": 40}]}}
        """
        let record = try! FeedAPI.decoder.decode(ManagerWorkspace.Record.self, from: Data(json.utf8))
        let sheet = SplitSheet(record)
        XCTAssertEqual(sheet?.contributors.count, 2)
        XCTAssertEqual(sheet?.total, 100)
        XCTAssertEqual(record.kindLabel, "Split sheet")
    }
}

final class OwnerRouteTests: XCTestCase {
    private let policy = LinkPolicy(home: URL(string: "https://rooster-polished.vercel.app")!)

    private func route(_ path: String) -> NativeScreen? {
        NativeRouter.screen(for: URL(string: "https://rooster-polished.vercel.app\(path)")!, policy: policy)
    }

    func testOwnerToolsAndRoomsRouteNatively() {
        XCTAssertEqual(route("/members.html#roster-access-admin"), .approvals)
        XCTAssertEqual(route("/members.html#member-verification"), .verification)
        XCTAssertEqual(route("/members.html#founder-announcements"), .announcements)
        XCTAssertEqual(route("/booking/dashboard"), .bookingDashboard)
        XCTAssertEqual(route("/booking/dashboard#settings"), .bookingDashboard)
        XCTAssertEqual(route("/live.html?room=abc123def456"), .liveRoom(key: "abc123def456"))
        XCTAssertNil(route("/live.html"), "the Rooms tab already shows the list")
    }

    // MARK: - Business setup

    /// The business row as GET /api/booking/businesses returns it (booking-api.mts:134).
    private func businessRow() throws -> BookingDetails {
        try FeedAPI.decoder.decode(BookingDetails.self, from: Data("""
        {"id": 7, "slug": "nia-vocals", "name": "Nia Carter Vocals", "description": "Vocals and coaching.",
         "logo_url": "/api/booking/media?key=business%2F7%2Fa.webp", "cover_url": null,
         "phone": "(713) 555-0134", "email": "nia@example.com",
         "address_line1": "3400 Emancipation Ave", "address_line2": "Studio B", "city": "Houston", "region": "TX",
         "postal_code": "77004", "timezone": "America/Chicago", "currency": "USD", "category_id": 3,
         "published": true, "stripe_charges_enabled": false,
         "gallery": ["/api/booking/media?key=business%2F7%2Fb.webp"],
         "social_links": {"shop": "https://example.com/shop"},
         "policies": {"cancellation": "Free up to 24 hours before."}}
        """.utf8))
    }

    func testBusinessRowDecodesTheFieldsSetupEdits() throws {
        let details = try businessRow()
        XCTAssertEqual(details.addressLine1, "3400 Emancipation Ave")
        XCTAssertEqual(details.postalCode, "77004")
        XCTAssertEqual(details.categoryId, 3)
        XCTAssertEqual(details.gallery?.count, 1)
        XCTAssertEqual(details.socialLinks?["shop"], "https://example.com/shop")
        XCTAssertEqual(details.policies?["cancellation"], "Free up to 24 hours before.")
    }

    func testDetailsFormStartsFromTheBusinessRow() throws {
        let draft = BookingDetailsDraft(try businessRow())
        XCTAssertEqual(draft.name, "Nia Carter Vocals")
        XCTAssertEqual(draft.city, "Houston")
        XCTAssertEqual(draft.categoryId, 3)
        XCTAssertEqual(draft.shop, "https://example.com/shop", "the shop link lives under socialLinks")
        XCTAssertEqual(draft.cancellation, "Free up to 24 hours before.", "and the policy under policies")
        XCTAssertEqual(draft.timezone, "America/Chicago")
    }

    /// An empty timezone would fail the site's required-text check (booking-api.mts:172).
    func testDetailsFormFallsBackToAZone() throws {
        let blank = try FeedAPI.decoder.decode(BookingDetails.self, from: Data("""
        {"id": 7, "slug": "x", "name": "X", "timezone": ""}
        """.utf8))
        XCTAssertEqual(BookingDetailsDraft(blank).timezone, "America/Chicago")
        XCTAssertEqual(BookingDetailsDraft(blank).shop, "")
    }

    // MARK: - Opening hours

    private func weekJSON() throws -> [BookingHours] {
        try FeedAPI.decoder.decode(BookingWeek.self, from: Data("""
        {"hours": [
          {"id": 1, "weekday": 0, "start_minute": 540, "end_minute": 1020, "closed": true},
          {"id": 2, "weekday": 1, "start_minute": 600, "end_minute": 1140, "closed": false},
          {"id": 7, "weekday": 6, "start_minute": 660, "end_minute": 900, "closed": false}]}
        """.utf8)).hours
    }

    /// The form always shows a full week, even when the site is missing a day's row.
    func testHoursFormAlwaysCoversSevenDays() throws {
        let week = [DayHours].week(from: try weekJSON())
        XCTAssertEqual(week.count, 7)
        XCTAssertEqual(week.map(\.weekday), [0, 1, 2, 3, 4, 5, 6], "Sunday first, like the site")
        XCTAssertFalse(week[0].open, "Sunday came back closed")
        XCTAssertTrue(week[1].open)
        XCTAssertEqual(week[1].start, 600)
        XCTAssertEqual(week[1].end, 1140)
        XCTAssertFalse(week[2].open, "a day with no row of its own reads as closed")
        XCTAssertEqual(week[6].start, 660)
    }

    /// The site refuses a day that closes before it opens (booking-api.mts hoursAPI).
    func testHoursFormCatchesABackwardsDay() {
        XCTAssertTrue(DayHours(weekday: 1, open: true, start: 540, end: 1020).makesSense)
        XCTAssertFalse(DayHours(weekday: 1, open: true, start: 1020, end: 540).makesSense)
        XCTAssertFalse(DayHours(weekday: 1, open: true, start: 600, end: 600).makesSense, "a day cannot be open for no time")
        XCTAssertTrue(DayHours(weekday: 1, open: false, start: 1020, end: 540).makesSense, "a closed day's times don't matter")
    }

    /// The form thinks in "open"; the site stores "closed". Getting this backwards would
    /// shut a business on every save.
    func testSavedWeekInvertsOpenIntoClosed() throws {
        let week = [DayHours].week(from: try weekJSON())
        let sent = week.map { BookingHours(id: $0.weekday, weekday: $0.weekday,
                                           startMinute: $0.start, endMinute: $0.end, closed: !$0.open) }
        XCTAssertEqual(sent[0].closed, true, "Sunday was closed and stays closed")
        XCTAssertEqual(sent[1].closed, false, "Monday was open and stays open")
        XCTAssertEqual(sent.count, 7)
    }

    // MARK: - Manager money

    /// The site stores minor units and refuses anything that is not a nonnegative whole
    /// number (rcm-money.mjs:35-56), so the app has to do the rounding before it asks.
    func testMoneyBecomesWholeMinorUnits() {
        XCTAssertEqual(AddRecordSheet.cents("12.34"), 1234)
        XCTAssertEqual(AddRecordSheet.cents("1,250"), 125_000, "a typed thousands separator still counts")
        XCTAssertEqual(AddRecordSheet.cents(" 9.005 "), 901, "rounded, never truncated to a fraction of a cent")
        XCTAssertEqual(AddRecordSheet.cents(""), 0)
        XCTAssertEqual(AddRecordSheet.cents("not money"), 0)
        XCTAssertEqual(AddRecordSheet.cents("-5"), 0, "a negative would be refused by the site")
    }

    /// A money entry has to be a royalty record; anything else is refused outright
    /// (rcm-workspace.mts:76-80).
    func testEachRecordKindMapsToWhatTheSiteCallsIt() {
        XCTAssertEqual(AddRecordSheet.Kind.income.recordKind, "royalty")
        XCTAssertEqual(AddRecordSheet.Kind.split.recordKind, "document")
        XCTAssertEqual(AddRecordSheet.Kind.song.recordKind, "song")
        XCTAssertEqual(AddRecordSheet.Kind.show.recordKind, "show")
        XCTAssertEqual(AddRecordSheet.Kind.person.recordKind, "person")
    }

    /// The site only takes gallery entries it hosts itself (booking-api.mts:84).
    func testUploadedPhotosMatchTheGalleryRoute() throws {
        let route = try NSRegularExpression(pattern: "^/api/booking/media\\?key=[a-zA-Z0-9%._~-]{1,800}$")
        let photo = try XCTUnwrap(businessRow().gallery?.first)
        XCTAssertEqual(route.numberOfMatches(in: photo, range: NSRange(photo.startIndex..., in: photo)), 1)
    }
}
