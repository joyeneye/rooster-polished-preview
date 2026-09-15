import AVFoundation
import SwiftUI
import WebKit

/// /api/review-room/dashboard (review-room.mts:84-136).
struct ReviewRoom: Decodable {
    struct Workspace: Decodable { let slug: String?; let name: String?; let bio: String? }
    struct Permissions: Decodable { let reviewer: Bool?; let admin: Bool? }
    struct Stats: Decodable { let waiting: Int?; let reviewed: Int?; let revenueCents: Int?; let pendingCents: Int? }
    struct Tier: Decodable, Hashable, Identifiable {
        let code: String
        let name: String?
        let description: String?
        let priceCents: Int?
        let priorityWeight: Int?
        let active: Bool?
        var id: String { code }
    }
    struct Review: Decodable, Hashable {
        struct Scores: Decodable, Hashable {
            let songwriting: Int?
            let production: Int?
            let originality: Int?
            let replay: Int?
        }
        let overallScore: Int?
        let scores: Scores?
        let feedback: String?
        let visibility: String?
        let decision: String?
        let publishedAt: String?
    }
    struct Track: Decodable, Hashable, Identifiable {
        let id: Int
        let publicId: String
        let artistName: String?
        let title: String?
        let genre: String?
        let mood: String?
        let tags: [String]?
        let songInfo: String?
        let tierCode: String?
        let status: String?
        let sourceType: String?
        let sourceUrl: String?
        let audioUrl: String?
        let featured: Bool?
        let queueStatus: String?
        let queuePosition: Int?
        let createdAt: String?
        let roomName: String?
        let review: Review?
    }

    let workspace: Workspace?
    let permissions: Permissions?
    let stats: Stats?
    let tiers: [Tier]?
    let queue: [Track]
    let submissions: [Track]
}

/// The Review Room, native: the queue, your submissions and their reviews. Submitting a track and
/// publishing a review are writes, so they are coming soon.
struct ReviewRoomView: View {
    let stack: ShellTab
    @StateObject private var room: Loadable<ReviewRoom>
    @State private var tab = "queue"
    @State private var notice: String?
    @State private var playing: ReviewRoom.Track?
    @StateObject private var player = TrackPlayer()
    @EnvironmentObject private var store: ShellStore

    init(stack: ShellTab, api: FeedAPI) {
        self.stack = stack
        _room = StateObject(wrappedValue: Loadable {
            #if DEBUG
            if let fixture = NativeFixtures.reviewRoom() { return fixture }
            #endif
            return try await api.get("/api/review-room/dashboard", as: ReviewRoom.self)
        })
    }

    var body: some View {
        LoadableContent(loadable: room) { value in
            List {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(value.workspace?.name?.nilIfEmpty ?? "Review Room").font(.rooster(24)).foregroundStyle(Theme.ink)
                        if let bio = value.workspace?.bio?.nilIfEmpty {
                            Text(bio).font(.system(size: 14)).foregroundStyle(Theme.muted)
                        }
                        HStack(spacing: 0) {
                            stat("\(value.stats?.waiting ?? value.queue.count)", "Waiting")
                            stat("\(value.stats?.reviewed ?? 0)", "Reviewed")
                            if value.permissions?.admin == true, let revenue = value.stats?.revenueCents {
                                stat(Money.string(revenue, currency: "USD") ?? "—", "Settled")
                            }
                        }
                        if let slug = value.workspace?.slug?.nilIfEmpty {
                            Text("Room code \(slug)").font(.roosterMono(11)).foregroundStyle(Theme.muted)
                        }
                    }
                    .padding(.vertical, 6)
                    .listRowBackground(Theme.surface)
                }

                Section {
                    Picker("Show", selection: $tab) {
                        Text("Queue").tag("queue")
                        Text("Yours").tag("yours")
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)

                    let tracks = tab == "queue" ? value.queue : value.submissions
                    if tracks.isEmpty {
                        Text(tab == "queue" ? "Nothing is waiting for a review." : "You haven't submitted a track yet.")
                            .font(.system(size: 15)).foregroundStyle(Theme.muted)
                    }
                    ForEach(tracks) { track in
                        Button { playing = track } label: { TrackRow(track: track, playing: player.playingID == track.publicId) }
                            .buttonStyle(.plain)
                    }
                }

                if let tiers = value.tiers?.filter({ $0.active != false }), !tiers.isEmpty {
                    Section("Lanes") {
                        ForEach(tiers) { tier in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(tier.name?.nilIfEmpty ?? tier.code.capitalized).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                                    if let description = tier.description?.nilIfEmpty {
                                        Text(description).font(.system(size: 13)).foregroundStyle(Theme.muted)
                                    }
                                }
                                Spacer()
                                Text(Money.string(tier.priceCents, currency: "USD") ?? "Free")
                                    .font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.ink)
                            }
                        }
                    }
                }

                Section {
                    Button { notice = "Submitting a track from the app is coming soon." } label: {
                        Label("Submit a track", systemImage: "arrow.up.circle.fill").foregroundStyle(Theme.red)
                    }
                    .listRowBackground(Theme.surface)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .refreshable { await room.load() }
        }
        .nativeScreenChrome("Review Room")
        .notice($notice)
        .sheet(item: $playing) { track in
            TrackSheet(track: track, player: player, comingSoon: { notice = $0 })
                .presentationDetents([.medium, .large])
                .presentationCornerRadius(28)
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.rooster(20)).foregroundStyle(Theme.ink)
            Text(label).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct TrackRow: View {
    let track: ReviewRoom.Track
    let playing: Bool

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(LinearGradient(colors: [Theme.red, Theme.orange], startPoint: .topLeading, endPoint: .bottomTrailing))
                Image(systemName: playing ? "waveform" : "play.fill").font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
            }
            .frame(width: 42, height: 42)
            VStack(alignment: .leading, spacing: 2) {
                Text(track.title?.nilIfEmpty ?? "Untitled").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                Text([track.artistName, track.genre].compactMap { $0?.nilIfEmpty }.joined(separator: " · "))
                    .font(.system(size: 13)).foregroundStyle(Theme.muted).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                if let review = track.review, let score = review.overallScore {
                    Text("\(score)/10").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.ink)
                } else if let position = track.queuePosition {
                    Text(position == 1 ? "Up next" : "#\(position)").font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.muted)
                }
                if track.featured == true {
                    Text("FEATURED").font(.roosterMono(8)).tracking(0.8).foregroundStyle(.white)
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(Theme.red, in: Capsule())
                }
            }
        }
        .padding(.vertical, 2)
    }
}

private struct TrackSheet: View {
    let track: ReviewRoom.Track
    @ObservedObject var player: TrackPlayer
    let comingSoon: (String) -> Void
    @EnvironmentObject private var store: ShellStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(track.title?.nilIfEmpty ?? "Untitled").font(.rooster(24)).foregroundStyle(Theme.ink)
                        Text([track.artistName, track.genre, track.mood].compactMap { $0?.nilIfEmpty }.joined(separator: " · "))
                            .font(.system(size: 14)).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.ink)
                            .frame(width: 34, height: 34).background(Theme.surface, in: Circle())
                    }
                    .accessibilityLabel("Close")
                }

                if let audio = track.audioUrl?.nilIfEmpty, let url = store.siteURL(audio) {
                    Button {
                        Task { await player.toggle(id: track.publicId, url: url) }
                    } label: {
                        HStack {
                            if player.loadingID == track.publicId {
                                ProgressView().tint(.white)
                            } else {
                                Image(systemName: player.playingID == track.publicId ? "pause.fill" : "play.fill")
                            }
                            Text(player.playingID == track.publicId ? "Pause" : "Play the track")
                        }
                        .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .background(Theme.red, in: Capsule())
                    }
                    .buttonStyle(PressableStyle())
                } else if let link = track.sourceUrl?.nilIfEmpty, let url = URL(string: link) {
                    Link(destination: url) {
                        Label("Open streaming link", systemImage: "arrow.up.right")
                            .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity, minHeight: 50)
                            .background(Theme.red, in: Capsule())
                    }
                }

                if let info = track.songInfo?.nilIfEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("WHAT TO LISTEN FOR").font(.roosterMono(10)).tracking(1.2).foregroundStyle(Theme.red)
                        Text(info).font(.system(size: 15)).foregroundStyle(Theme.ink)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }

                if let review = track.review {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("THE REVIEW").font(.roosterMono(10)).tracking(1.2).foregroundStyle(Theme.red)
                        if let score = review.overallScore {
                            Text("\(score)/10").font(.rooster(30)).foregroundStyle(Theme.ink)
                        }
                        if let scores = review.scores {
                            HStack(spacing: 10) {
                                score("Songwriting", scores.songwriting)
                                score("Production", scores.production)
                                score("Originality", scores.originality)
                                score("Replay", scores.replay)
                            }
                        }
                        if let feedback = review.feedback?.nilIfEmpty {
                            Text(feedback).font(.system(size: 15)).foregroundStyle(Theme.ink.opacity(0.9))
                        }
                        if let decision = review.decision?.nilIfEmpty {
                            Text(decision.capitalized).font(.system(size: 13, weight: .bold))
                                .foregroundStyle(decision == "approve" ? Color(hex: 0x2F7A45) : Theme.red)
                        }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                } else {
                    Button { comingSoon("Reviewing from the app is coming soon.") } label: {
                        Label("Write a review", systemImage: "square.and.pencil")
                            .font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.red)
                            .frame(maxWidth: .infinity, minHeight: 46)
                            .overlay(Capsule().stroke(Theme.red.opacity(0.4)))
                    }
                }
            }
            .padding(20)
        }
        .background(Theme.background)
    }

    private func score(_ label: String, _ value: Int?) -> some View {
        VStack(spacing: 2) {
            Text(value.map(String.init) ?? "—").font(.rooster(18)).foregroundStyle(Theme.ink)
            Text(label).font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
    }
}

/// Review Room audio is served whole, with no byte ranges (review-room.mts:267), so the app
/// downloads the file with the member's session and plays it from disk.
@MainActor
final class TrackPlayer: ObservableObject {
    @Published private(set) var playingID: String?
    @Published private(set) var loadingID: String?
    private var player: AVPlayer?
    private var files: [String: URL] = [:]

    func toggle(id: String, url: URL) async {
        if playingID == id {
            player?.pause()
            playingID = nil
            return
        }
        player?.pause()
        if let file = files[id] {
            play(id: id, file: file)
            return
        }
        loadingID = id
        defer { loadingID = nil }
        var request = URLRequest(url: url, timeoutInterval: 60)
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
            .filter { $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) == url.host }
        for (field, value) in HTTPCookie.requestHeaderFields(with: cookies) { request.setValue(value, forHTTPHeaderField: field) }
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) == true else { return }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("review-\(id).m4a")
        guard (try? data.write(to: file, options: .atomic)) != nil else { return }
        files[id] = file
        play(id: id, file: file)
    }

    private func play(id: String, file: URL) {
        let player = AVPlayer(url: file)
        self.player = player
        player.play()
        playingID = id
    }
}
