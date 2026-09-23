import SwiftUI

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

/// The Review Room, native: the room, its queue, your submissions and their reviews, the lanes a
/// track can go in by, and sending one in. A track opens in the review layout (TrackReviewView).
struct ReviewRoomView: View {
    let stack: ShellTab
    @StateObject private var room: Loadable<ReviewRoom>
    @State private var tab = Tab.queue
    @State private var notice: String?
    @State private var submitting = false
    @State private var open: ReviewRoom.Track?
    @StateObject private var player = TrackPlayer()
    @EnvironmentObject private var store: ShellStore

    enum Tab { case queue, yours }

    init(stack: ShellTab, api: FeedAPI) {
        self.stack = stack
        _room = StateObject(wrappedValue: Loadable {
            #if DEBUG
            if let fixture = ReviewRoomFixtures.dashboard() ?? NativeFixtures.reviewRoom() { return fixture }
            #endif
            return try await api.get("/api/review-room/dashboard", as: ReviewRoom.self)
        })
    }

    private var queueCount: Int? {
        room.value.map { $0.stats?.waiting ?? $0.queue.count }
    }

    var body: some View {
        LoadableContent(loadable: room) { value in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    roomCard(value)
                    tabs(value)
                    tracks(value)
                    lanes(value)
                    Button { submitting = true } label: {
                        Label("Submit a track", systemImage: "arrow.up.circle.fill")
                    }
                    .buttonStyle(.designPrimary)
                    .padding(.top, 4)
                }
                .padding(.horizontal, Design.gutter)
                .padding(.top, 8)
                .padding(.bottom, Design.tabBarClearance + 8)
            }
            .refreshable { await room.load() }
        }
        .reviewRoomChrome(queue: queueCount)
        .notice($notice)
        .navigationDestination(item: $open) { track in
            TrackReviewView(track: track,
                            queue: queueCount,
                            reviewable: canReview(track),
                            api: FeedAPI(base: store.baseURL),
                            player: player) { message in
                notice = message
                Task { await room.load() }
            }
        }
        .sheet(isPresented: $submitting) {
            SubmitTrackSheet(api: FeedAPI(base: store.baseURL),
                             tiers: (room.value?.tiers ?? []).filter { $0.active != false },
                             roomSlug: room.value?.workspace?.slug) {
                notice = "Your track is in the queue."
                Task { await room.load() }
            }
        }
        #if DEBUG
        .task(id: room.value?.queue.first?.id) {
            guard let value = room.value, open == nil else { return }
            if let track = ReviewRoomFixtures.track(to: value) { open = track }
            if ReviewRoomFixtures.opensSubmit { submitting = true }
        }
        #endif
    }

    /// Scoring is for the room's admins, on tracks still in the queue (review-room.mts:69, 196).
    private func canReview(_ track: ReviewRoom.Track) -> Bool {
        guard let value = room.value, value.permissions?.admin == true, track.review == nil else { return false }
        return value.queue.contains { $0.id == track.id }
    }

    // MARK: Sections

    private func roomCard(_ value: ReviewRoom) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(value.workspace?.name?.nilIfEmpty ?? "Review Room")
                    .font(.roosterDisplay(19, relativeTo: .title2))
                    .foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
                if let bio = value.workspace?.bio?.nilIfEmpty {
                    Text(bio).font(.system(size: 14)).foregroundStyle(Theme.muted)
                }
            }
            HStack(spacing: 8) {
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
        .frame(maxWidth: .infinity, alignment: .leading)
        .designCard()
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.roosterDisplay(18)).foregroundStyle(Theme.ink).lineLimit(1).minimumScaleFactor(0.6)
            Text(label.uppercased()).font(.system(size: 10, weight: .semibold)).tracking(1).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: Design.tileRadius, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func tabs(_ value: ReviewRoom) -> some View {
        HStack(spacing: 4) {
            tabButton(.queue, "Queue", value.queue.count)
            tabButton(.yours, "Yours", value.submissions.count)
        }
        .padding(4)
        .background(Theme.surface, in: Capsule())
        .overlay(Capsule().stroke(Theme.line))
    }

    private func tabButton(_ which: Tab, _ title: String, _ count: Int) -> some View {
        let selected = tab == which
        return Button {
            withAnimation(.snappy) { tab = which }
        } label: {
            HStack(spacing: 6) {
                Text(title).font(.system(size: 14, weight: .semibold))
                Text("\(count)").font(.system(size: 12, weight: .bold)).monospacedDigit()
                    .foregroundStyle(selected ? Theme.red : Theme.muted)
            }
            .foregroundStyle(selected ? Theme.ink : Theme.muted)
            .frame(maxWidth: .infinity, minHeight: 36)
            .background(selected ? Theme.raised : .clear, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    @ViewBuilder private func tracks(_ value: ReviewRoom) -> some View {
        let list = tab == .queue ? value.queue : value.submissions
        if list.isEmpty {
            Text(tab == .queue ? "Nothing is waiting for a review." : "You haven't submitted a track yet.")
                .font(.system(size: 15)).foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .designCard()
        } else {
            VStack(spacing: 10) {
                ForEach(list) { track in
                    Button { open = track } label: {
                        ReviewTrackCard(track: track, playing: player.playingID == track.publicId)
                    }
                    .buttonStyle(PressableStyle())
                }
            }
        }
    }

    @ViewBuilder private func lanes(_ value: ReviewRoom) -> some View {
        if let tiers = value.tiers?.filter({ $0.active != false }), !tiers.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Eyebrow(text: "Lanes")
                ForEach(tiers) { tier in
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(tier.name?.nilIfEmpty ?? tier.code.capitalized)
                                .font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                            if let description = tier.description?.nilIfEmpty {
                                Text(description).font(.system(size: 13)).foregroundStyle(Theme.muted)
                            }
                        }
                        Spacer()
                        Text(Money.string(tier.priceCents, currency: "USD") ?? "Free")
                            .font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.ink)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .designCard()
        }
    }
}

/// A track in the queue or your submissions: its sleeve, title, artist, chips, and where it
/// stands (its place in line, or its score once reviewed).
private struct ReviewTrackCard: View {
    let track: ReviewRoom.Track
    let playing: Bool

    var body: some View {
        HStack(spacing: 14) {
            TrackCover(track: track, size: 64)
                .overlay(alignment: .bottomTrailing) {
                    if playing {
                        Image(systemName: "waveform").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                            .frame(width: 22, height: 22).background(Theme.red, in: Circle())
                            .offset(x: 5, y: 5)
                    }
                }
            VStack(alignment: .leading, spacing: 4) {
                Text(track.title?.nilIfEmpty ?? "Untitled")
                    .font(.roosterDisplay(14, relativeTo: .headline)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(track.artistName?.nilIfEmpty ?? "Unknown artist")
                    .font(.system(size: 14)).foregroundStyle(Theme.muted).lineLimit(1)
                HStack(spacing: 6) {
                    ForEach([track.genre, track.mood].compactMap { $0?.nilIfEmpty }, id: \.self) { chip in
                        Text(chip).font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.ink.opacity(0.8))
                            .lineLimit(1)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Theme.raised, in: Capsule())
                            .fixedSize()
                    }
                }
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 4) {
                if track.featured == true {
                    Label("Featured", systemImage: "star.fill")
                        .labelStyle(.iconOnly)
                        .font(.system(size: 12)).foregroundStyle(Theme.red)
                }
                if let score = track.review?.overallScore {
                    Text("\(score)").font(.roosterDisplay(20)).foregroundStyle(Theme.ink)
                    Text("/ 10").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.muted)
                } else if let position = track.queuePosition {
                    Text(position == 1 ? "Up next" : "#\(position)")
                        .font(.system(size: 12, weight: .bold)).foregroundStyle(position == 1 ? Theme.red : Theme.muted)
                }
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.muted)
            }
        }
        .designCard(padding: 12)
        .accessibilityElement(children: .combine)
    }
}
