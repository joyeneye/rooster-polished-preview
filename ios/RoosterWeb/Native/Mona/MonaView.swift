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
    }

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
        turns.append(Turn(role: .user, text: String(message.prefix(1200))))
        lastQuestion = message
        failed = nil
        thinking = true
        asking = Task {
            defer { thinking = false }
            do {
                let data = try await api.postForData("/api/mona/chat",
                                                     body: ["message": String(message.prefix(1200)),
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
}

/// The panel, as the site draws it (roster-utility.css): paper ground, a MONA header with Close,
/// a status line, soft bubbles with yours inset from the left, and the question box under them.
struct MonaView: View {
    @ObservedObject var model: MonaModel
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ""
    @FocusState private var typing: Bool

    private static let red = Color(hex: 0xB51234)
    private static let paper = Color(hex: 0xFFFDF9)
    private static let ink = Color(hex: 0x19181B)

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("MONA").font(.rooster(22)).foregroundStyle(Self.ink)
                Spacer()
                Button("Close") { dismiss() }
                    .font(.system(size: 14, weight: .bold)).foregroundStyle(Color(hex: 0x242126))
                    .padding(.horizontal, 14).frame(minHeight: 44)
                    .background(Color(hex: 0xEEEAE4), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            }
            .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 12)
            .overlay(alignment: .bottom) { Rectangle().fill(Color(hex: 0xE7E1DA)).frame(height: 1) }

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(model.status)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(model.failed == nil ? Color(hex: 0x706770) : Color(hex: 0x9D2828))
                        ForEach(model.turns) { turn in
                            Text(turn.text)
                                .font(.system(size: 14)).lineSpacing(4)
                                .foregroundStyle(Self.ink)
                                .textSelection(.enabled)
                                .padding(.horizontal, 14).padding(.vertical, 12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(turn.role == .user ? Color(hex: 0xF7DDE3) : Color(hex: 0xEEEBE6),
                                            in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                                .padding(.leading, turn.role == .user ? 34 : 0)
                                .id(turn.id)
                        }
                        if model.thinking {
                            Text("Searching and thinking…")
                                .font(.system(size: 14)).foregroundStyle(Color(hex: 0x706770))
                                .padding(.horizontal, 14).padding(.vertical, 12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color(hex: 0xEEEBE6), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                                .id("thinking")
                        }
                        if let failed = model.failed {
                            Text(failed).font(.system(size: 14)).foregroundStyle(Color(hex: 0x9D2828))
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 14)
                }
                .onChange(of: model.turns.count) { _, _ in
                    withAnimation(.snappy) { proxy.scrollTo(model.turns.last?.id, anchor: .bottom) }
                }
                .onChange(of: model.thinking) { _, now in
                    if now { withAnimation(.snappy) { proxy.scrollTo("thinking", anchor: .bottom) } }
                }
            }

            VStack(spacing: 9) {
                if model.thinking {
                    Button("Stop") { model.stop() }.buttonStyle(MonaSmallButton())
                } else if model.failed != nil {
                    Button("Retry") { model.retry() }.buttonStyle(MonaSmallButton())
                }
                TextField("What should we work on?", text: $draft, axis: .vertical)
                    .font(.system(size: 16)).lineLimit(3...6)
                    .focused($typing)
                    .foregroundStyle(Color(hex: 0x1D1B1F)).tint(Self.red)
                    .padding(12)
                    .frame(minHeight: 88, alignment: .topLeading)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(Color(hex: 0xCDC5BD)))
                    .onChange(of: draft) { _, text in if text.count > 1200 { draft = String(text.prefix(1200)) } }
                Button {
                    model.ask(draft)
                    draft = ""
                } label: {
                    Text("Ask MONA").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(Self.red, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                }
                .disabled(model.thinking || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .opacity(model.thinking || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.55 : 1)
            }
            .padding(.horizontal, 14).padding(.top, 14).padding(.bottom, 10)
        }
        .background(Self.paper.ignoresSafeArea())
        .environment(\.colorScheme, .light)
        .task { await model.refreshContext() }
    }
}

private struct MonaSmallButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .heavy)).foregroundStyle(Color(hex: 0x19181B))
            .padding(.horizontal, 14).frame(minHeight: 44)
            .opacity(configuration.isPressed ? 0.6 : 1)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
