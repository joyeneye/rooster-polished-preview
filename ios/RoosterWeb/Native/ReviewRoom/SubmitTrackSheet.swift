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
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    card("The track") {
                        field("Title", $title)
                        field("Artist name", $artist)
                        HStack(spacing: 10) {
                            field("Genre", $genre)
                            field("Mood (optional)", $mood)
                        }
                    }

                    card("The music") {
                        if let track {
                            HStack(spacing: 12) {
                                Image(systemName: "waveform")
                                    .font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                                    .frame(width: 40, height: 40)
                                    .background(Theme.red, in: RoundedRectangle(cornerRadius: Design.tileRadius, style: .continuous))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(track.name).font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                                    Text(size(track.data.count)).font(.system(size: 12)).foregroundStyle(Theme.muted)
                                }
                                Spacer()
                                Button("Remove") { self.track = nil }
                                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.red)
                            }
                        } else {
                            Button { picking = true } label: {
                                Label("Choose an MP3 or WAV", systemImage: "square.and.arrow.up")
                            }
                            .buttonStyle(.designGlass)
                            Text("or").font(.system(size: 13)).foregroundStyle(Theme.muted)
                                .frame(maxWidth: .infinity)
                            field("Paste a secure streaming link", $link, url: true)
                        }
                        Text("Files up to 4 MB send from the app. A longer or higher-quality track is better as a link.")
                            .font(.system(size: 12)).foregroundStyle(Theme.muted)
                    }

                    if tiers.count > 1 {
                        card("How it goes in") {
                            ForEach(tiers) { option in
                                lane(option)
                            }
                        }
                    }

                    card("Anything else (optional)") {
                        TextField("", text: $about, prompt: Text("Tell them about the song…").foregroundStyle(Theme.muted), axis: .vertical)
                            .lineLimit(2...6)
                            .reviewField(minHeight: 80)
                        field("Tags, separated by commas", $tags)
                    }
                }
                .padding(.horizontal, Design.gutter)
                .padding(.top, 8)
                .padding(.bottom, 16)
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Button(action: submit) {
                    if sending {
                        ProgressView().tint(.white)
                    } else {
                        Label("Send for review", systemImage: "paperplane.fill")
                    }
                }
                .buttonStyle(.designPrimary)
                .disabled(!ready)
                .opacity(ready || sending ? 1 : 0.5)
                .padding(.horizontal, Design.gutter)
                .padding(.vertical, 10)
                .background(Theme.background)
            }
            .background(Theme.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("SEND A TRACK").font(.roosterDisplay(16, relativeTo: .headline)).tracking(1.5)
                        .foregroundStyle(Theme.ink)
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }.foregroundStyle(Theme.ink)
                }
            }
            .notice($notice)
            .fileImporter(isPresented: $picking,
                          allowedContentTypes: [.mp3, .wav, .audio],
                          allowsMultipleSelection: false) { result in
                choose(result)
            }
            .task { if tier.isEmpty { tier = tiers.first?.code ?? "free" } }
        }
        .presentationBackground(Theme.background)
    }

    // MARK: Pieces

    private func card<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow(text: title)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .designCard(padding: 14)
    }

    private func field(_ prompt: String, _ text: Binding<String>, url: Bool = false) -> some View {
        TextField("", text: text, prompt: Text(prompt).foregroundStyle(Theme.muted))
            .keyboardType(url ? .URL : .default)
            .textInputAutocapitalization(url ? .never : .words)
            .autocorrectionDisabled(url)
            .reviewField()
    }

    private func lane(_ option: ReviewRoom.Tier) -> some View {
        let chosen = tier == option.code
        return Button { tier = option.code } label: {
            HStack(spacing: 12) {
                Image(systemName: chosen ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 18)).foregroundStyle(chosen ? Theme.red : Theme.muted)
                VStack(alignment: .leading, spacing: 2) {
                    Text(option.name?.nilIfEmpty ?? option.code.capitalized)
                        .font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                    if let description = option.description?.nilIfEmpty {
                        Text(description).font(.system(size: 12)).foregroundStyle(Theme.muted)
                    }
                }
                Spacer()
                Text(price(option)).font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.ink)
            }
            .padding(12)
            .background(chosen ? Theme.red.opacity(0.1) : Theme.raised.opacity(0.5),
                        in: RoundedRectangle(cornerRadius: Design.tileRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Design.tileRadius, style: .continuous)
                .stroke(chosen ? Theme.red.opacity(0.6) : Theme.line))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }

    private func price(_ option: ReviewRoom.Tier) -> String {
        guard let cents = option.priceCents, cents > 0 else { return "Free" }
        return Money.string(cents, currency: "USD") ?? ""
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
