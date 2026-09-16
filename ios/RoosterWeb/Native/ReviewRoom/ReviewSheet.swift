import SwiftUI

/// Answering a track in your queue (review-room.mts:191-231). Every category is scored 1 to 10;
/// the overall is worked out by the site, not sent from here.
struct ReviewSheet: View {
    let api: FeedAPI
    let track: ReviewRoom.Track
    let done: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var songwriting = 7
    @State private var production = 7
    @State private var originality = 7
    @State private var replay = 7
    @State private var feedback = ""
    @State private var publicly = true
    @State private var passed = true
    @State private var sending = false
    @State private var notice: String?

    private var ready: Bool {
        !sending && feedback.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(track.title?.nilIfEmpty ?? "Untitled").font(.system(size: 17, weight: .bold)).foregroundStyle(Theme.ink)
                        Text(track.artistName?.nilIfEmpty ?? "Unknown artist").font(.system(size: 14)).foregroundStyle(Theme.muted)
                    }
                }

                Section("Scores") {
                    score("Songwriting", $songwriting)
                    score("Production", $production)
                    score("Originality", $originality)
                    score("Replay value", $replay)
                }

                Section("What you'd tell them") {
                    TextField("Be useful. They'll read every word.", text: $feedback, axis: .vertical)
                        .lineLimit(4...12)
                    Text("\(feedback.count)/4000")
                        .font(.system(size: 12))
                        .foregroundStyle(feedback.count > 4000 ? Theme.red : Theme.muted)
                }

                Section {
                    Toggle("Show this review publicly", isOn: $publicly).tint(Theme.red)
                    Toggle("Passing it", isOn: $passed).tint(Theme.red)
                } footer: {
                    Text(publicly ? "It shows on your room's public page." : "Only the artist sees it.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .tint(Theme.red)
            .navigationTitle("Review")
            .navigationBarTitleDisplayMode(.inline)
            .notice($notice)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(sending ? "Sending…" : "Send") { send() }
                        .bold()
                        .disabled(!ready || feedback.count > 4000)
                }
            }
        }
    }

    private func score(_ title: String, _ value: Binding<Int>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(title).font(.system(size: 15)).foregroundStyle(Theme.ink)
                Spacer()
                Text("\(value.wrappedValue)").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.red)
            }
            Slider(value: Binding(get: { Double(value.wrappedValue) },
                                  set: { value.wrappedValue = Int($0.rounded()) }),
                   in: 1...10, step: 1)
                .tint(Theme.red)
        }
        .padding(.vertical, 2)
    }

    private func send() {
        sending = true
        struct Done: Decodable { let ok: Bool? }
        Task {
            defer { sending = false }
            do {
                _ = try await api.post("/api/review-room/action",
                                       body: ["submission_id": track.id,
                                              "action": "review",
                                              "feedback": feedback.trimmingCharacters(in: .whitespacesAndNewlines),
                                              "visibility": publicly ? "public" : "private",
                                              "decision": passed ? "approved" : "rejected",
                                              "scores": ["songwriting": songwriting,
                                                         "production": production,
                                                         "originality": originality,
                                                         "replay": replay]],
                                       as: Done.self)
                dismiss()
                done()
            } catch let error as FeedError {
                notice = error.message
            } catch {
                notice = "That review didn't send. Try again."
            }
        }
    }
}
