import PhotosUI
import SwiftUI

// The parts of a profile below the header: the Top 8 grid, song rows and your own composer,
// drawn from DesignKit so they sit with the rest of the concept.

/// Where the online line stands (community.js:8).
enum Presence: Equatable {
    case checking, online, offline, unavailable
}

/// "TOP 8": a 4 × 2 grid of rounded photo tiles with first names (profile.png).
struct TopEightGrid: View {
    let topEight: TopEight
    let open: (String) -> Void
    let edit: () -> Void

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 4)

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            DesignSectionHeader(title: "Top 8",
                                action: topEight.editable == true ? "Edit" : nil,
                                onAction: topEight.editable == true ? edit : nil)
            if topEight.members.isEmpty {
                Text(topEight.editable == true ? "Choose your eight with Edit." : "No Top 8 picks yet.")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .designCard()
            } else {
                LazyVGrid(columns: columns, spacing: 10) {
                    ForEach(Array(topEight.members.prefix(8).enumerated()), id: \.element.id) { index, person in
                        Button { open(person.profileUrl ?? "/profile.html?id=\(person.id)") } label: {
                            tile(person)
                        }
                        .buttonStyle(PressableStyle())
                        .accessibilityLabel("Number \(index + 1), \(person.name)")
                    }
                }
                if topEight.mode == "community" {
                    Text(topEight.editable == true ? "Community picks · make it yours with Edit." : "Community picks")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.muted)
                }
            }
        }
    }

    private func tile(_ person: TopEight.Card) -> some View {
        Color.clear
            .aspectRatio(ProfileMetrics.tileAspect, contentMode: .fit)
            .overlay { ProfilePhoto(name: person.name, path: person.photoUrl, size: 180) }
            .overlay {
                LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .center, endPoint: .bottom)
            }
            .overlay(alignment: .bottomLeading) {
                Text(person.name.split(separator: " ").first.map(String.init) ?? person.name)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .padding(.horizontal, 8).padding(.bottom, 7)
            }
            .clipShape(RoundedRectangle(cornerRadius: Design.tileRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Design.tileRadius, style: .continuous).stroke(Color.white.opacity(0.1)))
    }
}

/// One song: art, title, "artist · plays", and the round play button (profile.png's SONGS).
struct ProfileSongRow: View {
    let song: SongsList.Song
    let artist: String
    let plays: Int?
    let playing: Bool
    let tap: () -> Void

    var body: some View {
        Button(action: tap) {
            HStack(spacing: 14) {
                SongArt(song: song)
                    .frame(width: ProfileMetrics.songArt, height: ProfileMetrics.songArt)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    Text(song.title?.nilIfEmpty ?? "Untitled")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        Text(artist)
                        if let plays {
                            Text("·")
                            Text("\(Compact.string(plays)) plays")
                        }
                    }
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                }
                Spacer(minLength: 8)
                Image(systemName: playing ? "pause.fill" : (song.url != nil ? "play.fill" : "arrow.up.right"))
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(Theme.raised, in: Circle())
                    .overlay(Circle().stroke(Color.white.opacity(0.08)))
            }
            .padding(.leading, 12).padding(.trailing, 14).padding(.vertical, 12)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.line))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(song.title ?? "Untitled"), \(artist)")
        .accessibilityHint(song.url != nil ? (playing ? "Pauses" : "Plays") : "Opens in \(song.providerName)")
    }
}

/// Song art. Songs carry no artwork, so YouTube songs use YouTube's own thumbnail and
/// everything else gets a tile drawn from the title, the same every time.
struct SongArt: View {
    let song: SongsList.Song

    var body: some View {
        if let thumbnail = Self.youTubeThumbnail(song) {
            RemoteImage(url: thumbnail, size: ProfileMetrics.songArt) { placeholder }
        } else {
            placeholder
        }
    }

    private var placeholder: some View {
        let seed = abs((song.title ?? song.id).unicodeScalars.reduce(7) { ($0 &* 31) &+ Int($1.value) })
        let angle = Double(seed % 360)
        return ZStack {
            LinearGradient(colors: [Theme.red, Theme.background], startPoint: .topLeading, endPoint: .bottomTrailing)
                .hueRotation(.degrees(angle.truncatingRemainder(dividingBy: 30) - 15))
            Image(systemName: "music.note").font(.system(size: 20, weight: .bold)).foregroundStyle(.white.opacity(0.85))
        }
        .accessibilityHidden(true)
    }

    static func youTubeThumbnail(_ song: SongsList.Song) -> URL? {
        var id = song.catalogVideoId
        if id == nil, song.provider == "youtube", let link = song.externalUrl, let url = URLComponents(string: link) {
            if url.host?.contains("youtu.be") == true {
                id = url.path.split(separator: "/").first.map(String.init)
            } else {
                id = url.queryItems?.first { $0.name == "v" }?.value
            }
        }
        guard let id, !id.isEmpty, id.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }) else { return nil }
        return URL(string: "https://i.ytimg.com/vi/\(id)/mqdefault.jpg")
    }
}

/// "Share something with your roster…" and Post · Song · Photo · Room, on your own profile.
struct ProfileComposerCard: View {
    let name: String
    let photoPath: String?
    let create: (CreateKind) -> Void
    let room: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Button { create(.post) } label: {
                HStack(spacing: 12) {
                    ProfilePhoto(name: name, path: photoPath, size: 40)
                        .frame(width: 40, height: 40).clipShape(Circle())
                    Text("Share something with your roster…")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.muted)
                    Spacer(minLength: 0)
                }
                .padding(8)
                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
            HStack(spacing: 8) {
                chip("Post", symbol: "square.and.pencil") { create(.post) }
                chip("Song", symbol: "music.note") { create(.song) }
                chip("Photo", symbol: "camera") { create(.photo) }
                chip("Room", symbol: "dot.radiowaves.left.and.right", action: room)
            }
        }
        .designCard(padding: 12)
    }

    private func chip(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: symbol).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.red)
                Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink)
            }
            .frame(maxWidth: .infinity, minHeight: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// "Edit photo & status" (profile-inline-editor.js): the status is required every time; the
/// photo is optional. The site screens the status, so it can come back held for review.
struct EditPhotoStatusSheet: View {
    let current: MemberProfile
    let actions: SiteActions
    let saved: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var status = ""
    @State private var photo: UIImage?
    @State private var picked: PhotosPickerItem?
    @State private var saving = false
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 16) {
                        Group {
                            if let photo {
                                Image(uiImage: photo).resizable().scaledToFill()
                            } else {
                                SiteImage(path: current.photoUrl ?? "/roster-icon-192.png")
                            }
                        }
                        .frame(width: 72, height: 72).clipShape(Circle())
                        PhotosPicker(selection: $picked, matching: .images) {
                            Text(photo == nil ? "Choose a new photo" : "Choose a different photo")
                        }
                    }
                } header: {
                    Text("Photo")
                }
                Section {
                    TextField("Your status", text: $status, axis: .vertical).lineLimit(1...4)
                    Text("\(status.count)/160").font(.system(size: 12))
                        .foregroundStyle(status.count > 160 ? Theme.red : Theme.muted)
                } header: {
                    Text("Status")
                } footer: {
                    Text("Keep it positive — ROOSTER checks every status before it goes up.")
                }
                if let problem { Section { Text(problem).foregroundStyle(Theme.red) } }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Edit photo & status")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(saving ? "Saving…" : "Save") { save() }.bold()
                        .disabled(saving || status.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || status.count > 160)
                }
            }
            .tint(Theme.red)
            .onAppear { status = current.status ?? "" }
            .onChange(of: picked) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self) { photo = UIImage(data: data) }
                    picked = nil
                }
            }
        }
    }

    private func save() {
        saving = true
        problem = nil
        Task {
            switch await actions.updateProfile(status: status, photo: photo) {
            case .success(let message):
                saved(message)
                dismiss()
            case .failure(let error):
                problem = error.message
            }
            saving = false
        }
    }
}
