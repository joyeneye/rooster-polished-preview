import AVKit
import SwiftUI
import WebKit

/// /api/member-messages (member-messages.mts:15-26, 83-133, 278-323).
struct Mailbox: Decodable {
    struct Message: Decodable, Hashable, Identifiable {
        struct Photo: Decodable, Hashable {
            let url: String
            let width: Int?
            let height: Int?
        }
        struct Video: Decodable, Hashable {
            let url: String
            let mime: String?
            let width: Int?
            let height: Int?
            let duration: Double?
        }
        let id: String
        let senderId: String
        let recipientId: String
        let senderName: String
        let recipientName: String
        let subject: String?
        let body: String?
        let createdAt: String
        let photo: Photo?
        let video: Video?
    }
    struct User: Decodable { let id: String; let name: String? }
    struct Next: Decodable { let inboxBefore: String?; let sentBefore: String? }

    let user: User
    let inbox: [Message]
    let sent: [Message]
    let unreadCount: Int?
    let unreadIds: [String]?
    let next: Next?
}

/// One person's messages, built on the device: the API has no per-conversation endpoint.
struct Conversation: Identifiable, Hashable {
    let otherId: String
    let otherName: String
    var messages: [Mailbox.Message]
    var unread: Int
    var id: String { otherId }
    var last: Mailbox.Message? { messages.last }
}

@MainActor
final class MessagesModel: ObservableObject {
    @Published private(set) var conversations: [Conversation] = []
    @Published private(set) var me: String?
    @Published private(set) var failure: FeedError?
    @Published private(set) var loading = false
    @Published private(set) var hasMore = false

    private let api: FeedAPI
    private var inboxBefore: String?
    private var sentBefore: String?
    private var messages: [Mailbox.Message] = []
    private var unread: Set<String> = []

    init(api: FeedAPI) {
        self.api = api
    }

    func startIfNeeded() {
        guard conversations.isEmpty, !loading else { return }
        Task { await load() }
    }

    func load() async {
        loading = true
        defer { loading = false }
        #if DEBUG
        if let fixture = NativeFixtures.mailbox() {
            apply(fixture, append: false)
            return
        }
        #endif
        do {
            let page = try await api.get("/api/member-messages?limit=100&directory=0", as: Mailbox.self)
            apply(page, append: false)
            failure = nil
        } catch let error as FeedError {
            failure = error
        } catch {
            failure = .failed("ROOSTER could not connect.")
        }
    }

    func loadOlder() {
        guard hasMore, !loading else { return }
        loading = true
        Task {
            defer { loading = false }
            var path = "/api/member-messages?limit=100&directory=0"
            if let inboxBefore { path += "&inbox_before=\(ProfileModel.encode(inboxBefore))" }
            if let sentBefore { path += "&sent_before=\(ProfileModel.encode(sentBefore))" }
            guard let page = try? await api.get(path, as: Mailbox.self) else { return }
            apply(page, append: true)
        }
    }

    private func apply(_ page: Mailbox, append: Bool) {
        me = page.user.id
        unread.formUnion(page.unreadIds ?? [])
        let known = Set(messages.map(\.id))
        let fresh = (page.inbox + page.sent).filter { !known.contains($0.id) }
        messages = append ? messages + fresh : (page.inbox + page.sent)
        inboxBefore = page.next?.inboxBefore
        sentBefore = page.next?.sentBefore
        hasMore = inboxBefore != nil || sentBefore != nil
        rebuild()
    }

    private func rebuild() {
        guard let me else { return }
        var threads: [String: Conversation] = [:]
        for message in messages.sorted(by: { $0.createdAt < $1.createdAt }) {
            let outgoing = message.senderId == me
            let otherId = outgoing ? message.recipientId : message.senderId
            let otherName = outgoing ? message.recipientName : message.senderName
            var thread = threads[otherId] ?? Conversation(otherId: otherId, otherName: otherName, messages: [], unread: 0)
            thread.messages.append(message)
            if !outgoing && unread.contains(message.id) { thread.unread += 1 }
            threads[otherId] = thread
        }
        conversations = threads.values.sorted {
            ($0.last?.createdAt ?? "") > ($1.last?.createdAt ?? "")
        }
    }
}

/// Messages, native: the conversation list and one thread. Sending is a write, so it is coming soon.
struct MessagesView: View {
    let stack: ShellTab
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        MessagesList(stack: stack, model: store.messages)
    }
}

private struct MessagesList: View {
    let stack: ShellTab
    /// Observed here, not read off the store: the store doesn't republish its models' changes.
    @ObservedObject var model: MessagesModel
    @EnvironmentObject private var session: SessionModel
    @State private var link: String?

    var body: some View {
        Group {
            if model.conversations.isEmpty && model.loading {
                LoadingRows().padding(.horizontal, 20).frame(maxHeight: .infinity, alignment: .top)
            } else if let failure = model.failure, model.conversations.isEmpty {
                ErrorState(message: failure.message) {
                    if case .locked = failure { session.revalidate() }
                    Task { await model.load() }
                }
                .frame(maxHeight: .infinity)
            } else if model.conversations.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "tray").font(.system(size: 32)).foregroundStyle(Theme.muted)
                    Text("No messages yet.").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                    Text("Open somebody's profile and say hello.").font(.system(size: 14)).foregroundStyle(Theme.muted)
                }
                .frame(maxHeight: .infinity)
            } else {
                List {
                    ForEach(model.conversations) { conversation in
                        NavigationLink(value: AppRoute.native(.conversation(memberID: conversation.otherId, name: conversation.otherName))) {
                            ConversationRow(conversation: conversation, me: model.me)
                        }
                    }
                    if model.hasMore {
                        Button("Load older messages") { model.loadOlder() }
                            .font(.system(size: 15, weight: .semibold)).tint(Theme.red)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .refreshable { await model.load() }
            }
        }
        .nativeScreenChrome("Messages")
        .opensSiteLinks($link, in: stack)
        .onAppear(perform: model.startIfNeeded)
    }
}

private struct ConversationRow: View {
    let conversation: Conversation
    let me: String?

    var body: some View {
        HStack(spacing: 12) {
            MemberAvatar(name: conversation.otherName, photoPath: nil, size: 48)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(conversation.otherName).font(.system(size: 16, weight: conversation.unread > 0 ? .bold : .semibold)).foregroundStyle(Theme.ink)
                    Spacer()
                    if let last = conversation.last {
                        Text(FeedDate.ago(last.createdAt)).font(.system(size: 12)).foregroundStyle(Theme.muted)
                    }
                }
                HStack(spacing: 6) {
                    Text(preview)
                        .font(.system(size: 14, weight: conversation.unread > 0 ? .semibold : .regular))
                        .foregroundStyle(conversation.unread > 0 ? Theme.ink : Theme.muted)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if conversation.unread > 0 {
                        Text("\(conversation.unread)").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                            .padding(.horizontal, 7).padding(.vertical, 2)
                            .background(Theme.red, in: Capsule())
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var preview: String {
        guard let last = conversation.last else { return "" }
        let mine = last.senderId == me ? "You: " : ""
        if let body = last.body?.trimmingCharacters(in: .whitespacesAndNewlines), !body.isEmpty { return mine + body }
        if last.photo != nil { return mine + "Photo" }
        if last.video != nil { return mine + "Video" }
        return mine + (last.subject ?? "Message")
    }
}

/// One conversation: the messages you and this member have exchanged.
struct ConversationView: View {
    let memberID: String
    let name: String
    let stack: ShellTab
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        ConversationThread(memberID: memberID, name: name, stack: stack, model: store.messages)
    }
}

private struct ConversationThread: View {
    let memberID: String
    let name: String
    let stack: ShellTab
    @ObservedObject var model: MessagesModel
    @EnvironmentObject private var store: ShellStore
    @State private var notice: String?
    @State private var link: String?
    @State private var resolvedName: String?

    private var conversation: Conversation? {
        model.conversations.first { $0.otherId == memberID }
    }
    /// A thread opened from a profile carries no name until the mailbox loads.
    private var title: String {
        [name, conversation?.otherName, resolvedName].compactMap { $0 }.first { !$0.isEmpty } ?? "Message"
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(conversation?.messages ?? []) { message in
                        MessageBubble(message: message, outgoing: message.senderId == model.me)
                            .id(message.id)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 16)
            }
            .onAppear {
                if let last = conversation?.last { proxy.scrollTo(last.id, anchor: .bottom) }
            }
        }
        .safeAreaInset(edge: .bottom) {
            Button { notice = "Replying from the app is coming soon." } label: {
                HStack {
                    Text("Message \(title.split(separator: " ").first.map(String.init) ?? title)…")
                        .foregroundStyle(Theme.muted)
                    Spacer()
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 26)).foregroundStyle(Theme.red.opacity(0.5))
                }
                .padding(.horizontal, 16)
                .frame(height: 52)
                .background(Theme.surface, in: Capsule())
                .overlay(Capsule().stroke(Color(uiColor: Theme.uiLine)))
                .padding(.horizontal, 14)
                .padding(.bottom, 8)
            }
            .buttonStyle(.plain)
            .background(Theme.background)
        }
        .nativeScreenChrome(title)
        .onAppear(perform: model.startIfNeeded)
        .task {
            guard name.isEmpty, conversation == nil, resolvedName == nil else { return }
            let api = FeedAPI(base: store.baseURL)
            resolvedName = try? await api.get("/api/profile?id=\(ProfileModel.encode(memberID))", as: ProfileResponse.self).profile.name
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { link = "/profile.html?id=\(memberID)" } label: { Image(systemName: "person.crop.circle") }
                    .accessibilityLabel("Open their profile")
            }
        }
        .notice($notice)
        .opensSiteLinks($link, in: stack)
    }
}

private struct MessageBubble: View {
    let message: Mailbox.Message
    let outgoing: Bool
    @EnvironmentObject private var store: ShellStore
    @State private var showsPhoto = false

    var body: some View {
        HStack {
            if outgoing { Spacer(minLength: 40) }
            VStack(alignment: outgoing ? .trailing : .leading, spacing: 6) {
                if let subject = message.subject, !subject.isEmpty, subject != "New message", subject != "Reply" {
                    Text(subject).font(.system(size: 12, weight: .bold)).foregroundStyle(outgoing ? .white.opacity(0.8) : Theme.muted)
                }
                if let photo = message.photo, let url = store.siteURL(photo.url) {
                    Button { showsPhoto = true } label: {
                        RemoteImage(url: url, size: 260, contentMode: .fit) { ProgressView().tint(Theme.red).frame(height: 160) }
                            .frame(maxWidth: 260)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .fullScreenCover(isPresented: $showsPhoto) {
                        ZStack(alignment: .topTrailing) {
                            Color.black.ignoresSafeArea()
                            RemoteImage(url: url, size: 1200, contentMode: .fit) { ProgressView().tint(.white) }
                            Button { showsPhoto = false } label: {
                                Image(systemName: "xmark").font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                                    .frame(width: 40, height: 40).background(.white.opacity(0.18), in: Circle())
                            }
                            .padding(16)
                        }
                    }
                }
                if let video = message.video, let url = store.siteURL(video.url) {
                    PrivateVideo(url: url)
                        .frame(width: 240, height: 320)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                if let body = message.body?.trimmingCharacters(in: .whitespacesAndNewlines), !body.isEmpty {
                    Text(body).font(.system(size: 16)).foregroundStyle(outgoing ? .white : Theme.ink)
                }
                Text(FeedDate.ago(message.createdAt)).font(.system(size: 11)).foregroundStyle(outgoing ? .white.opacity(0.7) : Theme.muted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(outgoing ? AnyShapeStyle(Theme.red) : AnyShapeStyle(Theme.surface),
                        in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(outgoing ? .clear : Color(uiColor: Theme.uiLine)))
            if !outgoing { Spacer(minLength: 40) }
        }
    }
}

/// Message video is private: the player needs the member's cookies (member-messages.mts:626-717).
struct PrivateVideo: View {
    let url: URL
    @State private var player: AVPlayer?

    var body: some View {
        ZStack {
            Color.black
            if let player {
                VideoPlayer(player: player)
            } else {
                ProgressView().tint(.white)
            }
        }
        .task {
            guard player == nil else { return }
            let cookies = await MainActor.run { WKWebsiteDataStore.default().httpCookieStore }
            let all = await cookies.allCookies().filter { $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) == url.host }
            let asset = AVURLAsset(url: url, options: [AVURLAssetHTTPCookiesKey: all])
            player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
        }
    }
}
