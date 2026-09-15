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
        XCTAssertNil(route("/members.html#member-chat"))
        XCTAssertNil(route("/rcm.html"))
        XCTAssertNil(route("/booking/dashboard"))
        XCTAssertNil(route("/review-room.html"))
    }

    func testPricesFollowTheBusinessCurrency() {
        XCTAssertEqual(Money.string(4500, currency: "USD"), "$45")
        XCTAssertEqual(Money.string(4599, currency: "usd"), "$45.99")
        XCTAssertEqual(Money.string(0, currency: "USD"), "Free")
        XCTAssertNil(Money.string(nil, currency: "USD"))
    }
}
