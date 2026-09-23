import SwiftUI

/// MONA, the assistant in the site's dock (mona-chat.mts, roster-utility.js). The server keeps
/// no history, so the conversation lives here and the last few turns go up with each question.
@MainActor
final class MonaModel: ObservableObject {
    struct Turn: Identifiable, Equatable {
        enum Role: String { case user, assistant }
        let id = UUID()
        let role: Role
        var text: String
        /// When it was said, for the time under the bubble.
        let at = Date()
    }

    /// A next step offered under the conversation; tapping one asks it.
    struct Suggestion: Identifiable, Hashable {
        let title: String
        let symbol: String
        let prompt: String
        var id: String { title }
    }

    /// The chips under the conversation ("YOU MIGHT ALSO WANT TO:"), in one place.
    static let suggestions: [Suggestion] = [
        Suggestion(title: "Write a caption", symbol: "pencil", prompt: "Write a caption for my next post."),
        Suggestion(title: "Find collaborators", symbol: "person.2", prompt: "Who on ROOSTER should I work with next?"),
        Suggestion(title: "Pitch to playlists", symbol: "music.note.list", prompt: "Help me pitch my latest song to playlists."),
        Suggestion(title: "Plan a release", symbol: "calendar", prompt: "Help me plan the release of my next song."),
    ]

    /// The most a question can be (mona-conversation.mts:5).
    static let questionLimit = 1200

    @Published private(set) var turns: [Turn] = []
    @Published private(set) var thinking = false
    @Published private(set) var status = "Updating…"
    @Published private(set) var failed: String?

    private let api: FeedAPI
    private var asking: Task<Void, Never>?
    private var lastQuestion: String?

    init(api: FeedAPI) { self.api = api }

    /// The panel's status line (roster-utility.js:26); the context itself is not shown.
    func refreshContext() async {
        struct Context: Decodable { let updatedAt: String? }
        status = "Updating context…"
        do {
            _ = try await api.get("/api/mona/context", as: Context.self)
            status = "Updated just now"
        } catch FeedError.locked {
            status = "Sign in to use your private MONA context."
        } catch {
            status = "Context refresh unavailable. MONA rechecks when you ask."
        }
    }

    /// The site keeps 1,200 characters a question and refuses any earlier turn over 1,600
    /// (mona-conversation.mts:5-6) — the web panel keeps 4,000 and breaks after a long answer,
    /// so history is trimmed to what the server accepts.
    static func history(from turns: [Turn]) -> [[String: String]] {
        turns.suffix(6).map { ["role": $0.role.rawValue, "text": String($0.text.prefix(1600))] }
    }

    /// Reads the NDJSON reply: a meta line, the answer in delta lines, then done.
    static func answer(from data: Data) -> String {
        struct Event: Decodable { let type: String; let text: String? }
        return String(decoding: data, as: UTF8.self)
            .split(whereSeparator: \.isNewline)
            .compactMap { try? FeedAPI.decoder.decode(Event.self, from: Data($0.utf8)) }
            .filter { $0.type == "delta" }
            .compactMap(\.text)
            .joined()
    }

    func ask(_ raw: String) {
        let message = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty, !thinking else { return }
        let history = Self.history(from: turns)
        turns.append(Turn(role: .user, text: String(message.prefix(Self.questionLimit))))
        lastQuestion = message
        failed = nil
        thinking = true
        asking = Task {
            defer { thinking = false }
            do {
                let data = try await api.postForData("/api/mona/chat",
                                                     body: ["message": String(message.prefix(Self.questionLimit)),
                                                            "history": history, "surface": "/", "route": "/"],
                                                     accept: "application/x-ndjson")
                guard !Task.isCancelled else { return }
                let answer = Self.answer(from: data)
                if answer.isEmpty {
                    failed = "MONA returned no answer."
                } else {
                    turns.append(Turn(role: .assistant, text: answer))
                    status = "Updated just now"
                }
            } catch let error as FeedError {
                if !Task.isCancelled { failed = error.message }
            } catch {
                if !Task.isCancelled { failed = "MONA's live connection is unavailable. No action was taken." }
            }
        }
    }

    func stop() {
        asking?.cancel()
        asking = nil
        thinking = false
        failed = "Stopped. Your message is ready to retry."
    }

    /// Asks the last question again, without adding it twice.
    func retry() {
        guard let question = lastQuestion else { return }
        if turns.last?.role == .user { turns.removeLast() }
        ask(question)
    }

    #if DEBUG
    /// Under -RoosterFixtures the simulator can't sign in, so the panel opens on a sample
    /// exchange instead of asking the network.
    func seedFixtureIfNeeded() {
        guard NativeFixtures.enabled, turns.isEmpty else { return }
        turns = [Turn(role: .user, text: MonaFixtures.question), Turn(role: .assistant, text: MonaFixtures.answer)]
        status = "Updated just now"
    }
    #endif
}

/// The panel as design/world-class-concept/mona.png draws it: a header with the orb, red
/// bubbles for you, glass bubbles for MONA, next-step chips, and a pill composer.
struct MonaView: View {
    @ObservedObject var model: MonaModel
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ""
    @State private var hint: String?
    @FocusState private var typing: Bool

    private var canSend: Bool {
        !model.thinking && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            conversation
            composer
        }
        .background(Theme.background.ignoresSafeArea())
        .presentationBackground(Theme.background)
        .presentationDragIndicator(.hidden)
        .task {
            #if DEBUG
            if NativeFixtures.enabled { model.seedFixtureIfNeeded(); return }
            #endif
            await model.refreshContext()
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 14) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close MONA")
            MonaOrb(size: 62, active: model.thinking)
                .padding(.trailing, 4)
            VStack(alignment: .leading, spacing: 3) {
                Text("MONA")
                    .font(.roosterDisplay(24, relativeTo: .title))
                    .tracking(1)
                    .foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
                Text("Your studio assistant")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.muted)
                Text(model.status)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.muted.opacity(0.75))
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, 8).padding(.trailing, Design.gutter)
        .padding(.top, 12).padding(.bottom, 6)
    }

    // MARK: Conversation

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if model.turns.isEmpty && !model.thinking {
                        Text("Ask about your music, your page, or what to do next. MONA knows ROOSTER and what's on your roster.")
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.muted)
                            .padding(.top, 8)
                    }
                    ForEach(model.turns) { turn in
                        Group {
                            if turn.role == .user { userBubble(turn) } else { monaBubble(turn) }
                        }
                        .id(turn.id)
                    }
                    if model.thinking {
                        thinkingBubble.id("thinking")
                    }
                    if let failed = model.failed {
                        failure(failed)
                    }
                    if !model.thinking {
                        suggestions.padding(.top, 4)
                    }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(.horizontal, Design.gutter)
                .padding(.top, 10).padding(.bottom, 16)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: model.turns.count) { _, _ in
                withAnimation(.snappy) { proxy.scrollTo(model.turns.last?.id, anchor: .top) }
            }
            .onChange(of: model.thinking) { _, now in
                if now { withAnimation(.snappy) { proxy.scrollTo("thinking", anchor: .bottom) } }
            }
        }
    }

    private func time(_ date: Date) -> some View {
        Text(date.formatted(date: .omitted, time: .shortened))
            .font(.system(size: 12))
            .foregroundStyle(Theme.muted)
    }

    private func userBubble(_ turn: MonaModel.Turn) -> some View {
        HStack {
            Spacer(minLength: 64)
            VStack(alignment: .trailing, spacing: 7) {
                Text(turn.text)
                    .font(.system(size: 16))
                    .foregroundStyle(.white)
                    .textSelection(.enabled)
                    .padding(.horizontal, 18).padding(.vertical, 13)
                    .background(Theme.red, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .shadow(color: Theme.red.opacity(0.3), radius: 12, y: 4)
                time(turn.at)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("You: \(turn.text)")
    }

    private func monaBubble(_ turn: MonaModel.Turn) -> some View {
        HStack(alignment: .top, spacing: 12) {
            MonaOrb(size: 30).padding(.top, 4)
            VStack(alignment: .leading, spacing: 7) {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(Array(MonaReply.blocks(turn.text).enumerated()), id: \.offset) { _, block in
                        switch block {
                        case .text(let text):
                            Text(MonaReply.attributed(text))
                                .font(.system(size: 16)).lineSpacing(3)
                                .foregroundStyle(Theme.ink)
                        case .heading(let text):
                            Text(text).font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.ink)
                        case .item(let title, let detail, let symbol):
                            MonaItemRow(title: title, detail: detail, symbol: symbol)
                        }
                    }
                }
                .textSelection(.enabled)
                .padding(.horizontal, 18).padding(.vertical, 16)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color.white.opacity(0.1)))
                time(turn.at)
            }
            Spacer(minLength: 24)
        }
        .accessibilityElement(children: .combine)
    }

    private var thinkingBubble: some View {
        HStack(alignment: .center, spacing: 12) {
            MonaOrb(size: 30, active: true)
            HStack(spacing: 10) {
                ThinkingDots()
                Text("Searching and thinking…").font(.system(size: 15)).foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 16).padding(.vertical, 13)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color.white.opacity(0.1)))
            Spacer(minLength: 0)
            Button("Stop") { model.stop() }
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 14).frame(minHeight: 36)
                .background(Theme.raised, in: Capsule())
                .overlay(Capsule().stroke(Theme.line))
        }
    }

    private func failure(_ message: String) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Theme.red)
            Text(message).font(.system(size: 14)).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button("Retry") { model.retry() }
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16).frame(minHeight: 36)
                .background(Theme.red, in: Capsule())
        }
        .designCard(padding: 14, radius: 18)
    }

    private var suggestions: some View {
        VStack(alignment: .leading, spacing: 12) {
            Eyebrow(text: model.turns.isEmpty ? "Try asking:" : "You might also want to:")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(MonaModel.suggestions) { suggestion in
                        Button { model.ask(suggestion.prompt) } label: {
                            HStack(spacing: 8) {
                                Image(systemName: suggestion.symbol)
                                    .font(.system(size: 15, weight: .medium))
                                    .foregroundStyle(Theme.red)
                                Text(suggestion.title)
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundStyle(Theme.ink)
                            }
                            .padding(.horizontal, 14).frame(minHeight: 48)
                            .background(Theme.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color.white.opacity(0.14)))
                        }
                        .buttonStyle(PressableStyle())
                        .accessibilityHint("Asks MONA")
                    }
                }
                .padding(.horizontal, Design.gutter)
            }
            .padding(.horizontal, -Design.gutter)
        }
    }

    // MARK: Composer

    private var composer: some View {
        VStack(alignment: .trailing, spacing: 6) {
            if let hint {
                Text(hint)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 8)
                    .transition(.opacity)
                    .task(id: hint) {
                        try? await Task.sleep(for: .seconds(3))
                        withAnimation { self.hint = nil }
                    }
            }
            HStack(spacing: 8) {
                TextField("", text: $draft, prompt: Text("Ask MONA anything").foregroundStyle(Theme.muted), axis: .vertical)
                    .font(.system(size: 17))
                    .foregroundStyle(Theme.ink)
                    .tint(Theme.red)
                    .lineLimit(1...5)
                    .focused($typing)
                    .submitLabel(.send)
                    .onSubmit(send)
                    .onChange(of: draft) { _, text in
                        if text.count > MonaModel.questionLimit { draft = String(text.prefix(MonaModel.questionLimit)) }
                    }
                    .padding(.leading, 20)
                    .padding(.vertical, 12)
                // Speaking goes through the keyboard's own dictation; this opens it and says so.
                Button {
                    typing = true
                    withAnimation { hint = "Tap the mic on your keyboard to talk to MONA." }
                } label: {
                    Image(systemName: "mic")
                        .font(.system(size: 19))
                        .foregroundStyle(Theme.muted)
                        .frame(width: 36, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dictate")
                RedCircleButton(symbol: "paperplane.fill", size: 46, label: "Send", action: send)
                    .disabled(!canSend)
                    .opacity(canSend ? 1 : 0.5)
                    .padding(.trailing, 5).padding(.vertical, 5)
            }
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).stroke(Color.white.opacity(0.12)))
            if draft.count > MonaModel.questionLimit - 200 {
                Text("\(draft.count.formatted())/\(MonaModel.questionLimit.formatted())")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(draft.count >= MonaModel.questionLimit ? Theme.red : Theme.muted)
                    .padding(.trailing, 12)
            }
        }
        .padding(.horizontal, Design.gutter)
        .padding(.top, 8).padding(.bottom, 10)
    }

    private func send() {
        guard canSend else { return }
        model.ask(draft)
        draft = ""
    }
}

/// Three dots that pulse in turn while MONA works.
private struct ThinkingDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 20, paused: reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(Theme.red)
                        .frame(width: 6, height: 6)
                        .opacity(reduceMotion ? 0.8 : 0.35 + 0.65 * max(0, sin(t * 4 - Double(index) * 0.8)))
                }
            }
        }
        .accessibilityHidden(true)
    }
}
