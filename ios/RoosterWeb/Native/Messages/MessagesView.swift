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

    /// Sends a reply. request_id must be a UUID (member-messages.mts:545), and reusing one
    /// with different text is refused with a 409, so every attempt gets a fresh one.
    /// The site fills the subject in for attachments; a text reply needs one of its own.
    func send(to memberId: String, body: String) async -> String? {
        let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        struct Sent: Decodable { let message: Mailbox.Message }
        do {
            _ = try await api.post("/api/member-messages/send",
                                   body: ["recipient_id": memberId,
                                          "request_id": UUID().uuidString.lowercased(),
                                          "subject": "Reply",
                                          "body": String(text.prefix(3000))],
                                   as: Sent.self)
            await load()
            return nil
        } catch let error as FeedError {
            return error.message
        } catch {
            return "That didn't send. Try again."
        }
    }

    /// Marks what you just opened as read. The site takes exactly one key and refuses
    /// anything else (member-messages.mts:384).
    func markRead(_ conversation: Conversation) {
        guard let me else { return }
        let theirs = conversation.messages.filter { $0.recipientId == me && unread.contains($0.id) }
        guard !theirs.isEmpty else { return }
        let api = api
        Task {
            struct Receipt: Decodable { let unreadCount: Int? }
            for message in theirs {
                _ = try? await api.post("/api/member-messages/read", body: ["message_id": message.id], as: Receipt.self)
            }
            await load()
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


/// Messages, native: the conversation list and one thread.
struct MessagesView: View {
    let stack: ShellTab
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        MessagesList(stack: stack, model: store.messages)
    }
}

/// A pushed screen's title in the concept's style: Orbitron caps, centred in the bar.
private struct BarTitle: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.roosterDisplay(15, relativeTo: .headline))
            .tracking(1)
            .foregroundStyle(Theme.ink)
            .lineLimit(1)
            .accessibilityAddTraits(.isHeader)
    }
}

fileprivate extension ShellStore {
    /// A member's photo, when the directory has already loaded them; messages carry no photos.
    func knownPhoto(for memberID: String) -> String? {
        people.members.first { $0.id == memberID }?.photoUrl
    }
}

private struct MessagesList: View {
    let stack: ShellTab
    /// Observed here, not read off the store: the store doesn't republish its models' changes.
    @ObservedObject var model: MessagesModel
    @EnvironmentObject private var store: ShellStore
    @EnvironmentObject private var session: SessionModel
    @State private var link: String?

    private var unreadTotal: Int { model.conversations.reduce(0) { $0 + $1.unread } }

    var body: some View {
        Group {
            if model.conversations.isEmpty && model.loading {
                LoadingRows()
                    .padding(.horizontal, 16)
                    .designCard(padding: 0)
                    .padding(Design.gutter)
                    .frame(maxHeight: .infinity, alignment: .top)
            } else if let failure = model.failure, model.conversations.isEmpty {
                ErrorState(message: failure.message) {
                    if case .locked = failure { session.revalidate() }
                    Task { await model.load() }
                }
                .frame(maxHeight: .infinity)
            } else if model.conversations.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "envelope.open")
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(Theme.red)
                        .frame(width: 60, height: 60)
                        .background(Theme.red.opacity(0.14), in: Circle())
                    Text("No messages yet").font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.ink)
                    Text("Open somebody's profile and say hello.").font(.system(size: 14)).foregroundStyle(Theme.muted)
                }
                .frame(maxWidth: .infinity)
                .designCard(padding: 28)
                .padding(Design.gutter)
                .frame(maxHeight: .infinity, alignment: .top)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Eyebrow(text: unreadTotal > 0 ? "\(unreadTotal) unread · \(model.conversations.count) conversations"
                                                      : "\(model.conversations.count) conversation\(model.conversations.count == 1 ? "" : "s")")
                            .padding(.horizontal, 4)
                        VStack(spacing: 0) {
                            ForEach(Array(model.conversations.enumerated()), id: \.element.id) { index, conversation in
                                NavigationLink(value: AppRoute.native(.conversation(memberID: conversation.otherId, name: conversation.otherName))) {
                                    ConversationRow(conversation: conversation, me: model.me,
                                                    photo: store.knownPhoto(for: conversation.otherId))
                                }
                                .buttonStyle(.plain)
                                if index < model.conversations.count - 1 {
                                    Rectangle().fill(Theme.line).frame(height: 1).padding(.leading, 80)
                                }
                            }
                        }
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous).stroke(Theme.line))
                        if model.hasMore {
                            Button("Load older messages") { model.loadOlder() }
                                .buttonStyle(.designGlass)
                        }
                    }
                    .padding(Design.gutter)
                }
                .refreshable { await model.load() }
            }
        }
        .nativeScreenChrome("Messages")
        .toolbar {
            ToolbarItem(placement: .principal) { BarTitle(text: "Messages") }
        }
        .opensSiteLinks($link, in: stack)
        .onAppear(perform: model.startIfNeeded)
    }
}

private struct ConversationRow: View {
    let conversation: Conversation
    let me: String?
    let photo: String?

    var body: some View {
        HStack(spacing: 14) {
            MemberAvatar(name: conversation.otherName, photoPath: photo, size: 52)
                .overlay(Circle().stroke(conversation.unread > 0 ? Theme.red : .clear, lineWidth: 2).padding(-3))
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(conversation.otherName)
                        .font(.system(size: 16, weight: conversation.unread > 0 ? .bold : .semibold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    if let last = conversation.last {
                        Text(FeedDate.ago(last.createdAt))
                            .font(.system(size: 12, weight: conversation.unread > 0 ? .semibold : .regular))
                            .foregroundStyle(conversation.unread > 0 ? Theme.red : Theme.muted)
                    }
                }
                HStack(spacing: 8) {
                    Text(preview)
                        .font(.system(size: 14, weight: conversation.unread > 0 ? .medium : .regular))
                        .foregroundStyle(conversation.unread > 0 ? Theme.ink.opacity(0.9) : Theme.muted)
                        .lineLimit(2)
                    Spacer(minLength: 0)
                    if conversation.unread > 0 {
                        Text("\(conversation.unread)")
                            .font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                            .frame(minWidth: 20, minHeight: 20)
                            .padding(.horizontal, 3)
                            .background(Theme.red, in: Capsule())
                            .accessibilityLabel("\(conversation.unread) unread")
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
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
    @State private var draft = ""
    @State private var sending = false
    @FocusState private var composing: Bool

    private var conversation: Conversation? {
        model.conversations.first { $0.otherId == memberID }
    }

    private var canSend: Bool {
        !sending && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func send() {
        guard canSend else { return }
        let text = draft
        draft = ""
        sending = true
        Task {
            if let problem = await model.send(to: memberID, body: text) {
                notice = problem
                draft = text
            }
            sending = false
        }
    }
    /// A thread opened from a profile carries no name until the mailbox loads.
    private var title: String {
        [name, conversation?.otherName, resolvedName].compactMap { $0 }.first { !$0.isEmpty } ?? "Message"
    }

    private var photo: String? { store.knownPhoto(for: memberID) }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 14) {
                    if let conversation, !conversation.messages.isEmpty {
                        ForEach(conversation.messages) { message in
                            MessageBubble(message: message, outgoing: message.senderId == model.me,
                                          name: title, photo: photo)
                                .id(message.id)
                        }
                    } else if !model.loading {
                        VStack(spacing: 12) {
                            RingAvatar(name: title, photoPath: photo, size: 72)
                            Text(title).font(.rooster(22)).foregroundStyle(Theme.ink)
                            Text("Say hello. Your messages with \(firstName) show up here.")
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.muted)
                                .multilineTextAlignment(.center)
                        }
                        .padding(.top, 60)
                        .frame(maxWidth: .infinity)
                    }
                }
                .padding(.horizontal, Design.gutter)
                .padding(.vertical, 16)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onAppear {
                if let last = conversation?.last { proxy.scrollTo(last.id, anchor: .bottom) }
            }
            .onChange(of: conversation?.messages.count) { _, _ in
                guard let last = conversation?.last else { return }
                withAnimation(.snappy) { proxy.scrollTo(last.id, anchor: .bottom) }
            }
        }
        .background(Theme.background)
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        .nativeScreenChrome(title)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Button { link = "/profile.html?id=\(memberID)" } label: {
                    HStack(spacing: 10) {
                        MemberAvatar(name: title, photoPath: photo, size: 32)
                        Text(title)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(title), open their profile")
            }
        }
        .onAppear {
            model.startIfNeeded()
            if let conversation { model.markRead(conversation) }
        }
        .task {
            guard name.isEmpty, conversation == nil, resolvedName == nil else { return }
            let api = FeedAPI(base: store.baseURL)
            resolvedName = try? await api.get("/api/profile?id=\(ProfileModel.encode(memberID))", as: ProfileResponse.self).profile.name
        }
        .notice($notice)
        .opensSiteLinks($link, in: stack)
    }

    private var firstName: String {
        title.split(separator: " ").first.map(String.init) ?? title
    }

    /// The concept's composer: one rounded field with the red send button inside it.
    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("", text: $draft, prompt: Text("Message \(firstName)…").foregroundStyle(Theme.muted), axis: .vertical)
                .textFieldStyle(.plain)
                .font(.system(size: 16))
                .foregroundStyle(Theme.ink)
                .lineLimit(1...5)
                .tint(Theme.red)
                .focused($composing)
                .padding(.leading, 18)
                .padding(.vertical, 12)
            Button(action: send) {
                Group {
                    if sending {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: "paperplane.fill").font(.system(size: 16, weight: .bold))
                    }
                }
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(canSend || sending ? Theme.red : Theme.red.opacity(0.35), in: Circle())
                .shadow(color: Theme.red.opacity(canSend ? 0.45 : 0), radius: 10, y: 3)
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .padding(4)
            .accessibilityLabel("Send")
        }
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(composing ? Theme.red.opacity(0.5) : Color.white.opacity(0.08)))
        .padding(.horizontal, Design.gutter)
        .padding(.top, 8)
        // The floating tab bar sits over tab content rather than insetting it.
        .padding(.bottom, Design.tabBarClearance)
        .background(Theme.background)
    }
}

/// One message: yours red on the right, theirs dark glass on the left with their photo, the time
/// beneath, as in the concept's MONA thread.
private struct MessageBubble: View {
    let message: Mailbox.Message
    let outgoing: Bool
    let name: String
    let photo: String?
    @EnvironmentObject private var store: ShellStore
    @State private var showsPhoto = false

    private var shape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(topLeadingRadius: 20, bottomLeadingRadius: outgoing ? 20 : 6,
                               bottomTrailingRadius: outgoing ? 6 : 20, topTrailingRadius: 20, style: .continuous)
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if outgoing {
                Spacer(minLength: 48)
            } else {
                MemberAvatar(name: name, photoPath: photo, size: 30)
                    .padding(.bottom, 20)
                    .accessibilityHidden(true)
            }
            VStack(alignment: outgoing ? .trailing : .leading, spacing: 5) {
                bubble
                Text(FeedDate.ago(message.createdAt))
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 4)
            }
            if !outgoing { Spacer(minLength: 48) }
        }
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let subject = message.subject, !subject.isEmpty, subject != "New message", subject != "Reply",
               !(subject == "Photo" && message.photo != nil) {
                Text(subject).font(.system(size: 12, weight: .bold)).foregroundStyle(outgoing ? .white.opacity(0.8) : Theme.muted)
            }
            if let photo = message.photo, let url = store.siteURL(photo.url) {
                Button { showsPhoto = true } label: {
                    RemoteImage(url: url, size: 260, contentMode: .fit) {
                        ProgressView().tint(Theme.red).frame(width: 220, height: 160)
                    }
                    .frame(maxWidth: 240)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Photo from \(outgoing ? "you" : name). Opens full screen")
                .fullScreenCover(isPresented: $showsPhoto) {
                    ZStack(alignment: .topTrailing) {
                        Color.black.ignoresSafeArea()
                        RemoteImage(url: url, size: 1200, contentMode: .fit) { ProgressView().tint(.white) }
                        Button { showsPhoto = false } label: {
                            Image(systemName: "xmark").font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                                .frame(width: 40, height: 40).background(.white.opacity(0.18), in: Circle())
                        }
                        .padding(16)
                        .accessibilityLabel("Close")
                    }
                }
            }
            if let video = message.video, let url = store.siteURL(video.url) {
                PrivateVideo(url: url)
                    .frame(width: 240, height: 320)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            if let body = message.body?.trimmingCharacters(in: .whitespacesAndNewlines), !body.isEmpty {
                Text(body)
                    .font(.system(size: 16))
                    .foregroundStyle(outgoing ? .white : Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, message.body?.isEmpty == false ? 16 : 6)
        .padding(.vertical, message.body?.isEmpty == false ? 11 : 6)
        .background(outgoing ? Theme.red : Theme.raised, in: shape)
        .overlay(shape.stroke(outgoing ? Color.clear : Color.white.opacity(0.08)))
        .shadow(color: outgoing ? Theme.red.opacity(0.25) : .clear, radius: 10, y: 4)
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
