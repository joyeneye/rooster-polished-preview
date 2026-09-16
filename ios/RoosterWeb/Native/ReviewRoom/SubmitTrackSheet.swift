import SwiftUI
import UniformTypeIdentifiers

/// Sending a track in for review (review-room.mts:138-189). The site takes an MP3 or WAV
/// up to 12 MB, but the app reaches it through the bridge, and Vercel refuses a request
/// body over 4.5 MB — so a bigger track has to come in as a link instead.
struct SubmitTrackSheet: View {
    let api: FeedAPI
    let tiers: [ReviewRoom.Tier]
    let roomSlug: String?
    let sent: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var artist = ""
    @State private var genre = ""
    @State private var mood = ""
    @State private var about = ""
    @State private var tags = ""
    @State private var link = ""
    @State private var tier = ""
    @State private var picking = false
    @State private var track: (name: String, data: Data)?
    @State private var sending = false
    @State private var notice: String?

    /// api/preview.js MAX_UPLOAD. Anything bigger cannot reach the site from the app.
    private static let ceiling = 4 * 1024 * 1024

    private var ready: Bool {
        !sending && !tier.isEmpty
            && [title, artist, genre].allSatisfy { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            && (track != nil || !link.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("The track") {
                    TextField("Title", text: $title)
                    TextField("Artist name", text: $artist)
                    TextField("Genre", text: $genre)
                    TextField("Mood (optional)", text: $mood)
                }

                Section {
                    if let track {
                        HStack {
                            Label(track.name, systemImage: "waveform")
                                .font(.system(size: 14)).foregroundStyle(Theme.ink).lineLimit(1)
                            Spacer()
                            Button("Remove") { self.track = nil }
                                .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.red)
                        }
                        Text(size(track.data.count)).font(.system(size: 12)).foregroundStyle(Theme.muted)
                    } else {
                        Button { picking = true } label: {
                            Label("Choose an MP3 or WAV", systemImage: "square.and.arrow.up")
                                .foregroundStyle(Theme.red)
                        }
                        TextField("…or paste a secure streaming link", text: $link)
                            .keyboardType(.URL).textInputAutocapitalization(.never)
                    }
                } header: {
                    Text("The music")
                } footer: {
                    Text("Files up to 4 MB send from the app. A longer or higher-quality track is better as a link.")
                }

                if tiers.count > 1 {
                    Section("How it goes in") {
                        Picker("Tier", selection: $tier) {
                            ForEach(tiers) { option in
                                Text(label(option)).tag(option.code)
                            }
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                    }
                }

                Section("Anything else (optional)") {
                    TextField("Tell them about the song…", text: $about, axis: .vertical).lineLimit(2...6)
                    TextField("Tags, separated by commas", text: $tags)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .tint(Theme.red)
            .navigationTitle("Send a track")
            .navigationBarTitleDisplayMode(.inline)
            .notice($notice)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(sending ? "Sending…" : "Send") { submit() }.bold().disabled(!ready)
                }
            }
            .fileImporter(isPresented: $picking,
                          allowedContentTypes: [.mp3, .wav, .audio],
                          allowsMultipleSelection: false) { result in
                choose(result)
            }
            .task { if tier.isEmpty { tier = tiers.first?.code ?? "free" } }
        }
    }

    private func label(_ option: ReviewRoom.Tier) -> String {
        let name = option.name?.nilIfEmpty ?? option.code.capitalized
        guard let cents = option.priceCents, cents > 0 else { return "\(name) · free" }
        return "\(name) · \(Money.string(cents, currency: "USD") ?? "")"
    }

    private func size(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }

    private func choose(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result, let url = urls.first else { return }
        // A file out of the picker is security-scoped; without this the read comes back empty.
        let opened = url.startAccessingSecurityScopedResource()
        defer { if opened { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            notice = "That file couldn't be read."
            return
        }
        guard data.count <= Self.ceiling else {
            notice = "That track is \(size(data.count)). Send one under 4 MB, or paste a link instead."
            return
        }
        track = (url.lastPathComponent, data)
    }

    private func submit() {
        sending = true
        var fields = [
            "tier": tier,
            "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
            "artist_name": artist.trimmingCharacters(in: .whitespacesAndNewlines),
            "genre": genre.trimmingCharacters(in: .whitespacesAndNewlines),
            "mood": mood.trimmingCharacters(in: .whitespacesAndNewlines),
            "song_info": about.trimmingCharacters(in: .whitespacesAndNewlines),
            "tags": tags.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
        if let roomSlug, !roomSlug.isEmpty { fields["room_slug"] = roomSlug }
        if track == nil { fields["stream_url"] = link.trimmingCharacters(in: .whitespacesAndNewlines) }

        struct Accepted: Decodable { let ok: Bool?; let publicId: String? }
        Task {
            defer { sending = false }
            do {
                _ = try await api.upload("/api/review-room/submit",
                                         fields: fields,
                                         file: track?.data,
                                         fileField: "audio",
                                         filename: track?.name ?? "track.mp3",
                                         contentType: (track?.name ?? "").lowercased().hasSuffix(".wav")
                                             ? "audio/wav" : "audio/mpeg",
                                         as: Accepted.self)
                dismiss()
                sent()
            } catch let error as FeedError {
                notice = error.message
            } catch {
                notice = "That didn't send. Try again."
            }
        }
    }
}
