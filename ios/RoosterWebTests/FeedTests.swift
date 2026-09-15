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
