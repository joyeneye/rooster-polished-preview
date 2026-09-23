import SwiftUI

/// One track in the Review Room (design/world-class-concept/review.png): the track, its waveform
/// and player, the four scores with the overall ring, the feedback, and Pass or Approve & Send.
///
/// A track that already has a review shows that review. Scoring is for the room's admins
/// (review-room.mts:69, 196), so anybody else sees the track and where it stands.
struct TrackReviewView: View {
    let track: ReviewRoom.Track
    let queue: Int?
    /// Whether this member may score it: a room admin, a queue track, not reviewed yet.
    let reviewable: Bool
    let api: FeedAPI
    @ObservedObject var player: TrackPlayer
    let sent: (String) -> Void
    @EnvironmentObject private var store: ShellStore
    @Environment(\.dismiss) private var dismiss

    @State private var songwriting = 7
    @State private var production = 7
    @State private var originality = 7
    @State private var replay = 7
    @State private var feedback = ""
    @State private var publicly = true
    @State private var sending = false
    @State private var confirmsPass = false
    @State private var notice: String?
    @FocusState private var writing: Bool

    private static let feedbackLimit = 4000

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(spacing: 12) {
                trackCard
                listenCard
                if let review = track.review {
                    scoresCard(review)
                    feedbackCard(review)
                } else if reviewable {
                    scoringCard
                    draftCard.id("feedback")
                } else {
                    waitingCard
                }
            }
            .padding(.horizontal, Design.gutter)
            .padding(.top, 8)
            .padding(.bottom, reviewable ? 16 : Design.tabBarClearance + 8)
        }
        .scrollDismissesKeyboard(.interactively)
        #if DEBUG
        .task {
            guard ReviewRoomFixtures.scrollsToFeedback else { return }
            try? await Task.sleep(for: .milliseconds(1200))
            proxy.scrollTo("feedback", anchor: .bottom)
        }
        #endif
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if reviewable { actions }
        }
        .reviewRoomChrome(queue: queue)
        .notice($notice)
        .task { await prepareAudio() }
        .confirmationDialog("Pass on this track?", isPresented: $confirmsPass, titleVisibility: .visible) {
            Button("Pass and send") { send(approved: false) }
            Button("Keep reviewing", role: .cancel) {}
        } message: {
            Text("\(track.artistName?.nilIfEmpty ?? "The artist") gets your scores and feedback with a pass.")
        }
    }

    // MARK: Track

    private var trackCard: some View {
        HStack(alignment: .top, spacing: 16) {
                TrackCover(track: track, size: 120)
                VStack(alignment: .leading, spacing: 6) {
                    Text(track.title?.nilIfEmpty ?? "Untitled")
                        .font(.roosterDisplay(20, relativeTo: .title2))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                        .accessibilityAddTraits(.isHeader)
                    Text(track.artistName?.nilIfEmpty ?? "Unknown artist")
                        .font(.system(size: 16)).foregroundStyle(Theme.muted)
                        .lineLimit(1)
                    let chips = ([track.genre, track.mood] + (track.tags ?? []).map { $0 })
                        .compactMap { $0?.nilIfEmpty }
                    if !chips.isEmpty {
                        // One line of chips; the ones that don't fit are left off rather than wrapped.
                        ChipFlow(spacing: 6) {
                            ForEach(chips, id: \.self) { TagChip(text: $0) }
                        }
                        .frame(maxHeight: 32, alignment: .top)
                        .clipped()
                        .padding(.top, 4)
                    }
                    if let standing {
                        Text(standing).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.muted)
                            .lineLimit(2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .designCard(padding: 14)
    }

    /// Where it stands: its place in the queue, its lane, whether it is featured.
    private var standing: String? {
        var parts: [String] = []
        if track.review == nil, let position = track.queuePosition {
            parts.append(position == 1 ? "Up next" : "#\(position) in the queue")
        }
        if let lane = track.tierCode?.nilIfEmpty { parts.append("\(lane.capitalized) lane") }
        if track.featured == true { parts.append("Featured") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    // MARK: Listening

    private var audioURL: URL? {
        track.audioUrl?.nilIfEmpty.flatMap { store.siteURL($0) }
    }

    @ViewBuilder private var listenCard: some View {
        if let url = audioURL {
            let loaded = player.loadedID == track.publicId
            let playing = player.playingID == track.publicId
            VStack(spacing: 8) {
                ReviewWaveform(levels: player.peaks[track.publicId],
                               placeholderSeed: track.id,
                               progress: loaded ? player.progress : 0,
                               scrub: loaded ? { player.seek(id: track.publicId, to: $0) } : nil)
                    .frame(height: 44)
                    .accessibilityValue(loaded ? "\(TrackTime.string(player.elapsed)) of \(TrackTime.string(player.duration))" : "Not loaded")
                ZStack {
                    HStack {
                        Text(TrackTime.string(loaded ? player.elapsed : 0))
                        Spacer()
                        Text(loaded && player.duration > 0 ? TrackTime.string(player.duration) : "–:––")
                    }
                    .font(.system(size: 13, weight: .medium)).monospacedDigit()
                    .foregroundStyle(Theme.muted)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .accessibilityHidden(true)

                    Button {
                        Task { await player.toggle(id: track.publicId, url: url) }
                    } label: {
                        ZStack {
                            Circle().fill(Theme.red)
                            if player.loadingID == track.publicId {
                                ProgressView().tint(.white)
                            } else {
                                Image(systemName: playing ? "pause.fill" : "play.fill")
                                    .font(.system(size: 22, weight: .bold))
                                    .foregroundStyle(.white)
                                    .offset(x: playing ? 0 : 2)
                            }
                        }
                        .frame(width: 50, height: 50)
                        .shadow(color: Theme.red.opacity(0.45), radius: 12, y: 4)
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityLabel(playing ? "Pause" : "Play \(track.title?.nilIfEmpty ?? "the track")")
                    .padding(.top, 4)
                }
                .frame(height: 54)
                if player.failedID == track.publicId {
                    Text("The audio didn't load. Tap play to try again.")
                        .font(.system(size: 13)).foregroundStyle(Theme.red)
                }
            }
            .designCard(padding: 14)
        } else if let link = track.sourceUrl?.nilIfEmpty, let url = URL(string: link) {
            VStack(alignment: .leading, spacing: 12) {
                Eyebrow(text: "Streaming link")
                Text("This one came in as a link, so it plays where it's hosted.")
                    .font(.system(size: 14)).foregroundStyle(Theme.muted)
                Link(destination: url) {
                    Label("Open the link", systemImage: "arrow.up.right")
                }
                .buttonStyle(.designGlass)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .designCard(padding: 16)
        } else {
            Text("No audio came with this submission.")
                .font(.system(size: 14)).foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .designCard(padding: 16)
        }
    }

    private func prepareAudio() async {
        guard let url = audioURL else { return }
        await player.prepare(id: track.publicId, url: url)
        #if DEBUG
        if ReviewRoomFixtures.opensFirstTrack, feedback.isEmpty {
            let draft = ReviewRoomFixtures.draft
            (songwriting, production, originality, replay) = (draft.scores[0], draft.scores[1], draft.scores[2], draft.scores[3])
            feedback = draft.feedback
            player.seek(id: track.publicId, to: 0.44)
        }
        #endif
    }

    // MARK: Scores

    private var average: Double {
        Double(songwriting + production + originality + replay) / 4
    }

    private var scoringCard: some View {
        scoresLayout(ring: average, rows: [("Songwriting", $songwriting), ("Production", $production),
                                           ("Originality", $originality), ("Replay value", $replay)],
                     enabled: true)
    }

    private func scoresCard(_ review: ReviewRoom.Review) -> some View {
        let scores = review.scores
        let values = [scores?.songwriting, scores?.production, scores?.originality, scores?.replay].map { $0 ?? 0 }
        let overall = review.overallScore.map(Double.init)
            ?? Double(values.reduce(0, +)) / 4
        return scoresLayout(ring: overall, rows: [("Songwriting", .constant(values[0])), ("Production", .constant(values[1])),
                                                  ("Originality", .constant(values[2])), ("Replay value", .constant(values[3]))],
                            enabled: false)
    }

    private func scoresLayout(ring: Double, rows: [(String, Binding<Int>)], enabled: Bool) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow(text: "Scores")
                ForEach(rows, id: \.0) { row in
                    HStack(spacing: 8) {
                        Text(row.0)
                            .font(.system(size: 14)).foregroundStyle(Theme.ink)
                            .lineLimit(1).minimumScaleFactor(0.85)
                            .frame(width: 88, alignment: .leading)
                        ScoreSlider(title: row.0, value: row.1, enabled: enabled)
                        Text("\(row.1.wrappedValue)")
                            .font(.system(size: 14, weight: .semibold)).monospacedDigit()
                            .foregroundStyle(Theme.ink)
                            .frame(width: 20, alignment: .trailing)
                            .accessibilityHidden(true)
                    }
                }
            }
            Rectangle().fill(Theme.line).frame(width: 1).padding(.vertical, 4)
            VStack(spacing: 10) {
                ScoreRing(value: ring, size: 88)
                Text("OVERALL SCORE")
                    .font(.system(size: 10, weight: .semibold)).tracking(1)
                    .foregroundStyle(Theme.muted)
                    .fixedSize()
            }
            .frame(width: 100)
        }
        .designCard(padding: 14)
    }

    // MARK: Feedback

    /// What the artist wrote when they sent it in, kept beside the feedback that answers it.
    @ViewBuilder private var artistNote: some View {
        if let info = track.songInfo?.nilIfEmpty {
            (Text("Artist's note  ").foregroundStyle(Theme.muted).bold() + Text(info).foregroundStyle(Theme.ink.opacity(0.9)))
                .font(.system(size: 13))
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var draftCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow(text: "Feedback")
            artistNote
            TextField("", text: $feedback,
                      prompt: Text("Be useful. They'll read every word.").foregroundStyle(Theme.muted),
                      axis: .vertical)
                .lineLimit(4...12)
                .focused($writing)
                .padding(.bottom, 14)
                .reviewField(minHeight: 120)
                .overlay(alignment: .bottomTrailing) {
                    Text("\(feedback.count)/\(Self.feedbackLimit)")
                        .font(.system(size: 11)).monospacedDigit()
                        .foregroundStyle(feedback.count > Self.feedbackLimit ? Theme.red : Theme.muted)
                        .padding(10)
                        .accessibilityLabel("\(feedback.count) of \(Self.feedbackLimit) characters")
                }
            Toggle(isOn: $publicly) {
                HStack(spacing: 10) {
                    Image(systemName: publicly ? "globe" : "lock.fill")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.muted)
                        .frame(width: 20)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Public review").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink)
                        Text(publicly ? "Shows on your room's public page." : "Only the artist sees it.")
                            .font(.system(size: 12)).foregroundStyle(Theme.muted)
                    }
                }
            }
            .tint(Theme.red)
        }
        .designCard(padding: 14)
    }

    private func feedbackCard(_ review: ReviewRoom.Review) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Eyebrow(text: "Feedback")
                Spacer()
                if let decision = review.decision?.nilIfEmpty {
                    let approved = decision.hasPrefix("approv")
                    StatusPill(text: approved ? "Approved" : "Passed", dot: approved ? Theme.green : Theme.red)
                }
            }
            artistNote
            Text(review.feedback?.nilIfEmpty ?? "No written feedback.")
                .font(.system(size: 15)).foregroundStyle(Theme.ink.opacity(0.9))
                .fixedSize(horizontal: false, vertical: true)
            Label(review.visibility == "private" ? "Only the artist sees this review." : "This review is public.",
                  systemImage: review.visibility == "private" ? "lock.fill" : "globe")
                .font(.system(size: 12)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .designCard(padding: 14)
    }

    private var waitingCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow(text: "Review")
            artistNote
            Text("Waiting for a review.").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
            Text("The room's reviewers score it and write back. You'll see it here when they do.")
                .font(.system(size: 14)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .designCard(padding: 14)
    }

    // MARK: Sending

    private var trimmed: String { feedback.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var ready: Bool { !sending && trimmed.count >= 2 && feedback.count <= Self.feedbackLimit }

    private var actions: some View {
        HStack(spacing: 12) {
            Button { confirmsPass = true } label: {
                Label("Pass", systemImage: "nosign")
            }
            .buttonStyle(.designGlass)
            Button { send(approved: true) } label: {
                if sending {
                    ProgressView().tint(.white)
                } else {
                    Label("Approve & Send", systemImage: "paperplane.fill")
                }
            }
            .buttonStyle(.designPrimary)
        }
        .disabled(!ready)
        .opacity(ready || sending ? 1 : 0.5)
        .accessibilityHint(ready ? "" : "Write your feedback first")
        .padding(.horizontal, Design.gutter)
        .padding(.top, 10)
        .padding(.bottom, Design.tabBarClearance - 6)
        .background(alignment: .top) {
            // Solid behind the buttons, with a short fade above so cards scroll away under it.
            VStack(spacing: 0) {
                LinearGradient(colors: [Theme.background.opacity(0), Theme.background], startPoint: .top, endPoint: .bottom)
                    .frame(height: 24)
                Theme.background
            }
            .padding(.top, -14)
            .ignoresSafeArea()
        }
    }

    /// review-room.mts:191-231: every score 1–10, feedback up to 4000, public or private,
    /// approved or rejected. The overall is worked out by the site.
    private func send(approved: Bool) {
        guard ready else { return }
        sending = true
        writing = false
        struct Done: Decodable { let ok: Bool? }
        Task {
            defer { sending = false }
            do {
                _ = try await api.post("/api/review-room/action",
                                       body: ["submission_id": track.id,
                                              "action": "review",
                                              "feedback": trimmed,
                                              "visibility": publicly ? "public" : "private",
                                              "decision": approved ? "approved" : "rejected",
                                              "scores": ["songwriting": songwriting,
                                                         "production": production,
                                                         "originality": originality,
                                                         "replay": replay]],
                                       as: Done.self)
                player.stop()
                dismiss()
                sent(approved ? "Approved and sent." : "Pass sent.")
            } catch let error as FeedError {
                notice = error.message
            } catch {
                notice = "That review didn't send. Try again."
            }
        }
    }
}
