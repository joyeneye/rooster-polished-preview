import SwiftUI

/// What the site's create buttons open, wherever they are pressed from.
enum CreateKind: String, Identifiable {
    case post, photo, song
    var id: String { rawValue }
}

/// The unread message count (Discover's envelope, Home's inbox button). The site reads it on load, on focus and when the page
/// comes back into view (roster-utility.js:15, 27); the app does the same, plus once a minute.
@MainActor
final class UnreadCounter: ObservableObject {
    @Published private(set) var count = 0
    private let api: FeedAPI
    private var loop: Task<Void, Never>?

    init(api: FeedAPI) { self.api = api }

    func start() {
        guard loop == nil else { return }
        loop = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(60))
            }
        }
    }

    func refresh() async {
        #if DEBUG
        if NativeFixtures.enabled { count = 20; return }
        #endif
        struct Unread: Decodable { let unreadCount: Int? }
        if let read = try? await api.get("/api/member-messages/unread", as: Unread.self) {
            count = max(0, read.unreadCount ?? 0)
        }
    }
}
