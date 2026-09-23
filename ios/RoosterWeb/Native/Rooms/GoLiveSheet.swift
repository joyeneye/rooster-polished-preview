import SwiftUI

/// Starting a room (roster-live.mts:264-299). A host runs one room at a time — creating
/// ends any other room they were hosting, which also covers a double tap on Go live.
struct GoLiveSheet: View {
    let api: FeedAPI
    /// Handed the new room's key once the site has made it.
    let started: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var about = ""
    @State private var video = false
    @State private var starting = false
    @State private var notice: String?

    /// roster-live.mts:112-118 and :128-134.
    private var titleIsGood: Bool {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.count >= 3 && trimmed.count <= 60
    }

    private var canStart: Bool { !starting && titleIsGood && about.count <= 140 }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 10) {
                        Eyebrow(text: "What's the room?")
                        TextField("", text: $title, prompt: Text("Give it a name").foregroundStyle(Theme.muted))
                            .modifier(GoLiveField())
                        Text("\(title.trimmingCharacters(in: .whitespacesAndNewlines).count)/60")
                            .font(.system(size: 12))
                            .foregroundStyle(titleIsGood || title.isEmpty ? Theme.muted : Theme.red)
                            .padding(.leading, 4)
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        Eyebrow(text: "Say more (optional)")
                        TextField("", text: $about, prompt: Text("What's happening in here…").foregroundStyle(Theme.muted), axis: .vertical)
                            .lineLimit(2...4)
                            .modifier(GoLiveField())
                        if about.count > 140 {
                            Text("Keep it to 140 characters.").font(.system(size: 12)).foregroundStyle(Theme.red).padding(.leading, 4)
                        }
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        Eyebrow(text: "Room")
                        HStack(spacing: 12) {
                            medium("Voice only", symbol: "mic.fill", isVideo: false)
                            medium("Video", symbol: "video.fill", isVideo: true)
                        }
                        Text("Anyone on the roster can see your room and come in.")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.muted)
                            .padding(.leading, 4)
                    }
                    Button { start() } label: {
                        ZStack {
                            Label("Go live", systemImage: "dot.radiowaves.left.and.right").opacity(starting ? 0 : 1)
                            if starting { ProgressView().tint(.white) }
                        }
                    }
                    .buttonStyle(.designPrimary)
                    .opacity(canStart || starting ? 1 : 0.45)
                    .disabled(!canStart)
                }
                .padding(Design.gutter)
            }
            .background(Theme.background)
            .tint(Theme.red)
            .navigationTitle("Go live")
            .navigationBarTitleDisplayMode(.inline)
            .notice($notice)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("GO LIVE").font(.roosterDisplay(15, relativeTo: .headline)).tracking(1).foregroundStyle(Theme.ink)
                }
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Start") { start() }
                        .bold()
                        .disabled(!canStart)
                }
            }
        }
        .presentationBackground(Theme.background)
    }

    private func medium(_ title: String, symbol: String, isVideo: Bool) -> some View {
        let selected = video == isVideo
        return Button {
            withAnimation(.snappy) { video = isVideo }
        } label: {
            VStack(spacing: 8) {
                Image(systemName: symbol).font(.system(size: 20, weight: .semibold))
                Text(title).font(.system(size: 15, weight: .semibold))
            }
            .foregroundStyle(selected ? Theme.ink : Theme.muted)
            .frame(maxWidth: .infinity, minHeight: 84)
            .background(selected ? Theme.red.opacity(0.14) : Theme.raised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(selected ? Theme.red : Theme.line, lineWidth: selected ? 1.5 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func start() {
        starting = true
        struct Started: Decodable {
            struct Room: Decodable { let key: String }
            let room: Room
        }
        Task {
            defer { starting = false }
            do {
                let made = try await api.post("/api/live/room",
                                              body: ["action": "create",
                                                     "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
                                                     "medium": video ? "video" : "audio",
                                                     "description": about.trimmingCharacters(in: .whitespacesAndNewlines)],
                                              as: Started.self)
                dismiss()
                started(made.room.key)
            } catch let error as FeedError {
                notice = error.message
            } catch {
                notice = "Your room didn't start. Try again."
            }
        }
    }
}

/// A raised input field, as on the sign-in screen.
private struct GoLiveField: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.system(size: 17))
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 16)
            .padding(.vertical, 15)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line))
    }
}
