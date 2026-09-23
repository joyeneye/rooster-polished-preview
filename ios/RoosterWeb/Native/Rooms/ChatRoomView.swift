import SwiftUI

/// /api/member-chat (member-chat.mts:13, 156-193) and /api/chat-room-presence
/// (chat-room-presence.mts:122-166).
struct ChatPage: Decodable {
    struct Message: Decodable, Hashable, Identifiable {
        let id: String
        let memberId: String
        let name: String
        let body: String
        let createdAt: String
    }
    let room: String?
    let messages: [Message]
    let next: String?
}

struct ChatPresence: Decodable {
    let inside: Int?
    let ownerInside: Bool?
}

@MainActor
final class ChatRoomModel: ObservableObject {
    @Published private(set) var messages: [ChatPage.Message] = []
    @Published private(set) var inside: Int?
    @Published private(set) var ownerInside = false
    @Published private(set) var failure: FeedError?
    @Published private(set) var started = false

    private let api: FeedAPI
    private var poll: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?
    /// One seat per visit, like the browser's (chat-glow.js:64-80).
    private let seat = UUID().uuidString

    init(api: FeedAPI) {
        self.api = api
    }

    /// The room only keeps the last 60 seconds (member-chat.mts:11), so it polls while on screen.
    func start() {
        guard poll == nil else { return }
        startHeartbeat()
        poll = Task {
            while !Task.isCancelled {
                await refresh()
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    func stop() {
        poll?.cancel()
        poll = nil
        heartbeat?.cancel()
        heartbeat = nil
        let api = api, seat = seat
        Task.detached {
            struct Ignored: Decodable {}
            _ = try? await api.post("/api/chat-room-presence", body: ["session_id": seat, "state": "left"], as: Ignored.self)
        }
    }

    /// Counts this member in the room, every 15 seconds (chat-room-presence.mts:104-120).
    private func startHeartbeat() {
        guard heartbeat == nil else { return }
        heartbeat = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                struct Ignored: Decodable {}
                _ = try? await api.post("/api/chat-room-presence", body: ["session_id": seat, "state": "inside"], as: Ignored.self)
                try? await Task.sleep(for: .seconds(15))
            }
        }
    }

    /// Says something in the room. It appears once the site's moderation approves it
    /// (member-chat.mts:231-273): 201 approved, 202 held, 422 refused.
    func say(_ body: String) async -> String? {
        let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        struct Sent: Decodable { let status: String?; let published: Bool? }
        do {
            let sent = try await api.post("/api/member-chat/send",
                                          body: ["body": String(text.prefix(500)), "request_id": UUID().uuidString],
                                          as: Sent.self)
            await refresh()
            if sent.published == true { return nil }
            return sent.status == "pending" ? "Held for a moment while it's checked." : "That message wasn't allowed in the room."
        } catch let error as FeedError {
            return error.message
        } catch {
            return "That didn't send. Try again."
        }
    }

    func refresh() async {
        #if DEBUG
        if let fixture = NativeFixtures.chat() {
            messages = fixture.messages.sorted { $0.createdAt < $1.createdAt }
            inside = 4
            started = true
            return
        }
        #endif
        do {
            async let page = api.get("/api/member-chat?limit=50", as: ChatPage.self)
            async let presence = try? api.get("/api/chat-room-presence", as: ChatPresence.self)
            let (chat, room) = try await (page, presence)
            messages = chat.messages.sorted { $0.createdAt < $1.createdAt }
            inside = room?.inside
            ownerInside = room?.ownerInside ?? false
            failure = nil
            started = true
        } catch let error as FeedError {
            failure = error
            started = true
        } catch {
            started = true
        }
    }
}

/// The Listening Room, native: everything said in the last minute, who is inside, and the
/// composer. Messages are moderated before they appear (member-chat.mts:231-273).
struct ChatRoomView: View {
    let stack: ShellTab
    @StateObject private var model: ChatRoomModel
    @State private var notice: String?
    @State private var link: String?
    @State private var draft = ""
    @State private var sending = false
    @EnvironmentObject private var session: SessionModel

    init(stack: ShellTab, api: FeedAPI) {
        self.stack = stack
        _model = StateObject(wrappedValue: ChatRoomModel(api: api))
    }


    var body: some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, Design.gutter)
                .padding(.top, 8)
                .padding(.bottom, 4)
            content
        }
        .background(Theme.background)
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        .nativeScreenChrome("Chat Room")
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("CHAT ROOM")
                    .font(.roosterDisplay(15, relativeTo: .headline))
                    .tracking(1)
                    .foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
            }
        }
        .notice($notice)
        .opensSiteLinks($link, in: stack)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    private var canSend: Bool {
        !sending && !draft.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func send() {
        guard canSend else { return }
        let text = draft
        draft = ""
        sending = true
        Task {
            if let message = await model.say(text) { notice = message }
            sending = false
        }
    }

    /// The concept's composer: one rounded field with the red send button inside it.
    private var composer: some View {
        HStack(spacing: 8) {
            TextField("", text: $draft, prompt: Text("Say something…").foregroundStyle(Theme.muted))
                .textFieldStyle(.plain)
                .font(.system(size: 16))
                .foregroundStyle(Theme.ink)
                .tint(Theme.red)
                .submitLabel(.send)
                .onSubmit(send)
                .padding(.leading, 18)
            Button(action: send) {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(canSend ? Theme.red : Theme.red.opacity(0.35), in: Circle())
                    .shadow(color: Theme.red.opacity(canSend ? 0.45 : 0), radius: 10, y: 3)
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .padding(4)
            .accessibilityLabel("Send")
        }
        .frame(minHeight: 48)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(Color.white.opacity(0.08)))
        .padding(.horizontal, Design.gutter)
        .padding(.top, 8)
        // The floating tab bar sits over tab content rather than insetting it.
        .padding(.bottom, Design.tabBarClearance)
        .background(Theme.background)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.red)
                .frame(width: 44, height: 44)
                .background(Theme.red.opacity(0.14), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text("The Listening Room").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                Text(insideLabel).font(.system(size: 13)).foregroundStyle(Theme.muted)
            }
            Spacer(minLength: 8)
            if model.ownerInside {
                LivePill(text: "J.WHITE IS IN", filled: false)
            }
        }
        .designCard(padding: 12, radius: 18)
    }

    private var insideLabel: String {
        guard let inside = model.inside else { return "Messages disappear after 60 seconds." }
        return "\(inside) in the room · gone after 60 seconds"
    }

    @ViewBuilder private var content: some View {
        if !model.started {
            ProgressView().controlSize(.large).tint(Theme.red).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let failure = model.failure, model.messages.isEmpty {
            ErrorState(message: failure.message) {
                if case .locked = failure { session.revalidate() }
                Task { await model.refresh() }
            }
            .frame(maxHeight: .infinity)
        } else if model.messages.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "ear").font(.system(size: 30)).foregroundStyle(Theme.muted)
                Text("Quiet in here right now.").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                Text("Anything said in the last minute shows up here.").font(.system(size: 14)).foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        ForEach(model.messages) { message in
                            HStack(alignment: .bottom, spacing: 10) {
                                Button { link = "/profile.html?id=\(message.memberId)" } label: {
                                    MemberAvatar(name: message.name, photoPath: nil, size: 32)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("\(message.name)'s profile")
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack(spacing: 6) {
                                        Text(message.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink)
                                        Text(FeedDate.ago(message.createdAt)).font(.system(size: 11)).foregroundStyle(Theme.muted)
                                    }
                                    Text(message.body)
                                        .font(.system(size: 15))
                                        .foregroundStyle(Theme.ink.opacity(0.92))
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 10)
                                .background(Theme.raised, in: UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 6,
                                                                                     bottomTrailingRadius: 18, topTrailingRadius: 18,
                                                                                     style: .continuous))
                                .overlay(UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 6,
                                                                bottomTrailingRadius: 18, topTrailingRadius: 18,
                                                                style: .continuous).stroke(Color.white.opacity(0.08)))
                                Spacer(minLength: 40)
                            }
                            .id(message.id)
                            .transition(.opacity)
                        }
                    }
                    .padding(.horizontal, Design.gutter)
                    .padding(.vertical, 14)
                }
                .defaultScrollAnchor(.bottom)
                .animation(.snappy, value: model.messages)
                .onChange(of: model.messages.last?.id) { _, last in
                    guard let last else { return }
                    withAnimation(.snappy) { proxy.scrollTo(last, anchor: .bottom) }
                }
            }
        }
    }
}
