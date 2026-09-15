import Foundation

/// slots-mix.mjs and slots-promos.mjs, ported so the native feed orders For You exactly as the
/// site does: member posts in their order, with headlines and ROOSTER promos worked in.
enum FeedMixer {
    private static let day: TimeInterval = 86_400

    /// mixSlots(posts, stories, promos, {view: 'for_you', append: false}).
    static func forYou(posts: [FeedPost], stories: [Story], promos: [Promo], now: Date = Date()) -> [FeedItem] {
        var seen = Set<String>()
        func unique(_ items: [FeedItem]) -> [FeedItem] {
            items.filter { seen.insert($0.id).inserted }
        }
        let members = unique(posts.map(FeedItem.post))
        let news = balanced(unique(stories.filter { isSafe($0, now: now) }.map(FeedItem.news)))
        let promotions = unique(promos.map(FeedItem.promo))
        var result: [FeedItem] = []

        if members.count < 4 {
            var memberIndex = 0, newsIndex = 0, promoIndex = 0
            // A quiet feed opens with one clearly labelled ROOSTER promo, then alternates the rest
            // with music and sports headlines, keeping every member post in order.
            if promoIndex < promotions.count { result.append(promotions[promoIndex]); promoIndex += 1 }
            var group = 0
            while group < 8 && (newsIndex < news.count || promoIndex < promotions.count) {
                if memberIndex < members.count { result.append(members[memberIndex]); memberIndex += 1 }
                if group > 0 && promoIndex < promotions.count { result.append(promotions[promoIndex]); promoIndex += 1 }
                var groupNews = 0
                while groupNews < 2 && newsIndex < news.count && newsIndex < 8 {
                    result.append(news[newsIndex]); newsIndex += 1; groupNews += 1
                }
                group += 1
            }
            result.append(contentsOf: members[memberIndex...])
            return result
        }

        var newsIndex = 0, promoIndex = 0, discoveryIndex = 0
        // A casting campaign takes the first discovery space after three members, in place of a
        // house ad rather than as a second ad stream.
        let campaignFirst: Bool = {
            if case .promo(let promo) = promotions.first { return promo.campaign }
            return false
        }()
        let maxPromos = max(campaignFirst ? 1 : 0, members.count / 6)
        for (index, member) in members.enumerated() {
            result.append(member)
            guard (index + 1) % 3 == 0 else { continue }
            discoveryIndex += 1
            let isPromoTurn = discoveryIndex % 2 == (campaignFirst ? 1 : 0)
            if isPromoTurn && promoIndex < maxPromos && promoIndex < promotions.count {
                result.append(promotions[promoIndex]); promoIndex += 1
            } else if newsIndex < news.count {
                result.append(news[newsIndex]); newsIndex += 1
            }
        }
        return result
    }

    /// safeStory(): music or sports, dated within the last week (and not ahead of now by more
    /// than five minutes), linking over https with no credentials in the URL.
    static func isSafe(_ story: Story, now: Date) -> Bool {
        guard story.category == "music" || story.category == "sports", let date = story.date else { return false }
        guard date <= now.addingTimeInterval(300), date >= now.addingTimeInterval(-7 * day) else { return false }
        guard let url = URL(string: story.url) else { return false }
        return url.scheme == "https" && url.user == nil && url.password == nil
    }

    /// Music and sports, alternating.
    private static func balanced(_ items: [FeedItem]) -> [FeedItem] {
        func stories(_ category: String) -> [FeedItem] {
            items.filter { if case .news(let story) = $0 { return story.category == category }; return false }
        }
        let music = stories("music"), sports = stories("sports")
        var result: [FeedItem] = []
        for i in 0..<max(music.count, sports.count) {
            if i < music.count { result.append(music[i]) }
            if i < sports.count { result.append(sports[i]) }
        }
        return result
    }
}

enum Promos {
    static let castingCall = Promo(
        id: "girl-group-casting-v1",
        poster: "/assets/slots-ads/girl-group-casting-v1.png",
        campaign: true,
        category: "CASTING CALL",
        sponsor: "MORE HITS ON THE WAY",
        title: "Four voices. One new group.",
        copy: "J.White Did It is looking for 3 female rappers + 1 female R&B singer. Ages 18+. Bring your voice, movement, and personality.",
        href: "/apply.html?opportunity=jspace-female-group-2026",
        action: "Apply for the group"
    )

    static let houseAds: [Promo] = [
        Promo(id: "hair-v1", video: "/assets/slots-ads/hair-v1.mp4", poster: "/assets/slots-ads/hair-v1.jpg", category: "HAIR & BEAUTY",
              title: "Your next look starts here.", copy: "Meet the people behind the styles you love.", href: "/booking", action: "Explore beauty"),
        Promo(id: "barber-v1", video: "/assets/slots-ads/barber-v1.mp4", poster: "/assets/slots-ads/barber-v1.jpg", category: "BARBERS & STYLISTS",
              title: "Fresh cut. New connection.", copy: "Discover barbers and stylists on ROOSTER.", href: "/booking", action: "Find your barber"),
        Promo(id: "sports-v1", video: "/assets/slots-ads/sports-v1.mp4", poster: "/assets/slots-ads/sports-v1.jpg", category: "SPORTS & COMMUNITY",
              title: "Your game. Your people.", copy: "Share the highlights. Start the conversation.", href: "/?view=board", action: "Join the conversation"),
        Promo(id: "podcast-v1", video: "/assets/slots-ads/podcast-v1.mp4", poster: "/assets/slots-ads/podcast-v1.jpg", category: "ROOMS & PODCASTS",
              title: "Give your voice a room.", copy: "Find your people. Start something worth talking about.", href: "/live.html", action: "Explore Rooms"),
        Promo(id: "fashion-v1", video: "/assets/slots-ads/fashion-v1.mp4", poster: "/assets/slots-ads/fashion-v1.jpg", category: "CULTURE & STYLE",
              title: "Your style. Your people.", copy: "Meet creators with a point of view.", href: "/people.html", action: "Meet creators"),
        Promo(id: "orbit-v1", video: "/roster-promo-radio.mp4", poster: "/assets/slots-ads/rooster-radio.jpg", category: "MUSIC & RADIO",
              title: "Turn the day into a station.", copy: "Find music, conversation, and new sounds on ORBIT.", href: "/radio.html", action: "Open ORBIT"),
        Promo(id: "create-v1", video: "/roster-promo-create.mp4", poster: "/assets/slots-ads/rooster-create.jpg", category: "CREATORS",
              title: "Make something people remember.", copy: "Post the idea. Share the moment. Find your people.", href: "/?compose=post", action: "Post now"),
        Promo(id: "booking-v1", video: "/roster-promo-book.mp4", poster: "/assets/slots-ads/rooster-book.jpg", category: "BUSINESS & BOOKING",
              title: "Turn your work into appointments.", copy: "Give clients one simple place to discover and book you.", href: "/booking", action: "Open Booking"),
    ]

    /// nextPromoOrder(): the casting call first on every visit, the house ads rotated one step per visit.
    static func order(visit: Int) -> [Promo] {
        let offset = abs(visit) % houseAds.count
        return [castingCall] + Array(houseAds[offset...] + houseAds[..<offset])
    }

    private static let visitKey = "rooster.promoVisit"

    static func nextOrder(defaults: UserDefaults = .standard) -> [Promo] {
        let visit = defaults.integer(forKey: visitKey)
        defaults.set((visit + 1) % houseAds.count, forKey: visitKey)
        return order(visit: visit)
    }
}
