#if DEBUG
import Foundation

/// Sample member posts for checking the post cards while the preview can't sign anyone in.
/// Debug builds only, and only when launched with -RoosterFeedFixture. The media are the site's
/// own promo files; the members are made up and the actions won't reach the server.
enum FeedFixture {
    static var posts: [FeedPost]? {
        guard ProcessInfo.processInfo.arguments.contains("-RoosterFeedFixture") || NativeFixtures.enabled else { return nil }
        let now = Date()
        func stamp(_ minutesAgo: Double) -> String {
            ISO8601DateFormatter().string(from: now.addingTimeInterval(-minutesAgo * 60))
        }
        let json = """
        [
          {"id": 9001, "author": {"id": "fixture-1", "name": "Nia Carter", "photo_url": "/assets/slots-ads/hair-v1.jpg", "kind": "artist"},
           "content_type": "video_post", "body": "Studio night. Hook is finally sitting right 🔥", "room_id": null, "metadata": {"location": "Houston, TX"},
           "media": [{"type": "video", "url": "/assets/slots-ads/barber-v1.mp4", "thumbnail_url": "/assets/slots-ads/barber-v1.jpg"}],
           "counts": {"likes": 1284, "comments": 86, "reposts": 41, "bookmarks": 12, "views": 9120},
           "viewer": {"liked": true, "bookmarked": false, "reposted": false, "can_delete": false}, "published_at": "\(stamp(12))"},
          {"id": 9002, "author": {"id": "fixture-2", "name": "Marcus Lane", "photo_url": "/assets/slots-ads/podcast-v1.jpg", "kind": "producer"},
           "content_type": "text_post", "body": "Who's in Dallas this weekend? Need two vocalists for a session Saturday. Paid, links in bio.", "room_id": null, "metadata": {},
           "media": [], "counts": {"likes": 42, "comments": 19, "reposts": 3, "bookmarks": 1, "views": 510},
           "viewer": {"liked": false, "bookmarked": false, "reposted": false, "can_delete": false}, "published_at": "\(stamp(95))"},
          {"id": 9003, "author": {"id": "fixture-3", "name": "Tasha Monroe", "photo_url": "/assets/slots-ads/fashion-v1.jpg", "kind": "creator"},
           "content_type": "photo_post", "body": "Fitting for the video shoot.", "room_id": null, "metadata": {"location": "Atlanta"},
           "media": [{"type": "image", "url": "/assets/slots-ads/fashion-v1.jpg"}],
           "counts": {"likes": 311, "comments": 24, "reposts": 8, "bookmarks": 30, "views": 2400},
           "viewer": {"liked": false, "bookmarked": true, "reposted": false, "can_delete": false}, "published_at": "\(stamp(300))"},
          {"id": 9004, "author": {"id": "fixture-4", "name": "Dre Wallace", "photo_url": "/assets/slots-ads/sports-v1.jpg", "kind": "artist"},
           "content_type": "song_post", "body": "Late Checkout", "room_id": null, "metadata": {"title": "Late Checkout", "artist": "Dre Wallace", "artwork_url": "/assets/slots-ads/rooster-radio.jpg", "play_count": 18400},
           "media": [{"type": "audio", "url": "/assets/slots-ads/hair-v1.mp4"}],
           "counts": {"likes": 902, "comments": 57, "reposts": 64, "bookmarks": 80, "views": 18400},
           "viewer": {"liked": false, "bookmarked": false, "reposted": true, "can_delete": false}, "published_at": "\(stamp(1500))"}
        ]
        """
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try? decoder.decode([FeedPost].self, from: Data(json.utf8))
    }
}
#endif
