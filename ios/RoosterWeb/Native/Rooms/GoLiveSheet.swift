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

    var body: some View {
        NavigationStack {
            Form {
                Section("What's the room?") {
                    TextField("Give it a name", text: $title)
                    Text("\(title.trimmingCharacters(in: .whitespacesAndNewlines).count)/60")
                        .font(.system(size: 12))
                        .foregroundStyle(titleIsGood || title.isEmpty ? Theme.muted : Theme.red)
                }
                Section("Say more (optional)") {
                    TextField("What's happening in here…", text: $about, axis: .vertical)
                        .lineLimit(2...4)
                    if about.count > 140 {
                        Text("Keep it to 140 characters.").font(.system(size: 12)).foregroundStyle(Theme.red)
                    }
                }
                Section {
                    Picker("Room", selection: $video) {
                        Text("Voice only").tag(false)
                        Text("Video").tag(true)
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    Text("Anyone on the roster can see your room and come in.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .tint(Theme.red)
            .navigationTitle("Go live")
            .navigationBarTitleDisplayMode(.inline)
            .notice($notice)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Start") { start() }
                        .bold()
                        .disabled(starting || !titleIsGood || about.count > 140)
                }
            }
        }
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
