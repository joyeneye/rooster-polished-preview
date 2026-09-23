import AVFoundation
import SwiftUI

/// What a card asks the feed to do.
struct FeedActions {
    var open: (String) -> Void
    var toggle: (String, FeedPost) -> Void
    var comment: (FeedPost) -> Void
    /// "Delete my post", only offered when the site says the post is yours.
    var delete: (FeedPost) -> Void = { _ in }
    /// "Pause motion" stops video everywhere in the feed.
    var motionPaused: Bool = false
    var toggleMotion: () -> Void = {}
}

struct FeedCard: View {
    let item: FeedItem
    let isActive: Bool
    @Binding var soundOn: Bool
    let actions: FeedActions
    @ObservedObject var player: HomeSongPlayer

    var body: some View {
        switch item {
        case .promo(let promo) where promo.campaign:
            CastingCard(promo: promo, open: actions.open)
        case .promo(let promo):
            PromoCard(promo: promo, isActive: isActive && !actions.motionPaused, soundOn: $soundOn, open: actions.open)
        case .news(let story):
            NewsCard(story: story, open: actions.open)
        case .post(let post):
            switch post.surface {
            case .text:
                TextPostCard(post: post, actions: actions, soundOn: $soundOn)
            case .room:
                LiveNowCard(label: post.metadata.medium == "video" ? "LIVE VIDEO" : "LIVE ROOM",
                            title: post.metadata.title ?? post.body ?? "Live on ROOSTER",
                            hostName: post.metadata.hostName ?? post.author.name,
                            hostPhoto: post.author.photoUrl,
                            listening: post.metadata.listeners) {
                    actions.open("/live.html?room=\(post.roomId ?? "")")
                }
            case .video, .photo, .audio:
                MediaPostCard(post: post, isActive: isActive, soundOn: $soundOn, actions: actions, player: player)
            }
        }
    }
}

// MARK: - Card frame

/// A 20pt card whose content fills a fixed aspect, cropped to the card.
private struct MediaFrame<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        Color.clear
            .aspectRatio(HomeLayout.mediaAspect, contentMode: .fit)
            .overlay { content }
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }
}

/// Dark at the bottom so white type reads over any photo, a little at the top for the menu.
private struct CardScrim: View {
    var body: some View {
        VStack(spacing: 0) {
            LinearGradient(colors: [.black.opacity(0.45), .clear], startPoint: .top, endPoint: .bottom)
                .frame(height: 90)
            Spacer(minLength: 0)
            LinearGradient(colors: [.clear, .black.opacity(0.55), .black.opacity(0.88)], startPoint: .top, endPoint: .bottom)
                .frame(maxHeight: .infinity)
                .layoutPriority(1)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Member posts

/// A photo, clip or song: the media full-bleed in the card, the author and caption bottom-left,
/// a now-playing chip for songs, and the action rail down the right.
private struct MediaPostCard: View {
    let post: FeedPost
    let isActive: Bool
    @Binding var soundOn: Bool
    let actions: FeedActions
    @ObservedObject var player: HomeSongPlayer
    @EnvironmentObject private var store: ShellStore
    @State private var confirmingDelete = false

    var body: some View {
        MediaFrame {
            ZStack(alignment: .bottomLeading) {
                // Pinned to the card's frame: a filled photo must not grow the stack.
                Color.clear.overlay { media }.clipped()
                CardScrim()
                VStack(alignment: .leading, spacing: 12) {
                    AuthorBlock(post: post, open: actions.open, showsBody: showsCaption)
                    if post.surface == .audio {
                        SongChip(post: post, player: player, open: actions.open)
                    }
                }
                .padding(.leading, 12)
                .padding(.trailing, post.surface == .audio ? 62 : 70)
                .padding(.bottom, 12)
            }
            .overlay(alignment: .bottomTrailing) {
                ActionRail(post: post, actions: actions)
                    .padding(.trailing, 8)
                    .padding(.bottom, 12)
            }
            .overlay(alignment: .topTrailing) {
                HStack(spacing: 0) {
                    if post.surface == .video {
                        SoundButton(soundOn: $soundOn)
                    }
                    PostMenu(post: post, actions: actions, soundOn: $soundOn, confirmingDelete: $confirmingDelete)
                }
                .padding(.top, 4)
                .padding(.trailing, 4)
            }
        }
        .confirmDelete(post: post, isPresented: $confirmingDelete, delete: actions.delete)
    }

    /// A song post's body is usually its title, already on the chip.
    private var showsCaption: Bool {
        guard let body = post.body, !body.isEmpty else { return false }
        return !(post.surface == .audio && body == post.metadata.title)
    }

    @ViewBuilder private var media: some View {
        switch post.surface {
        case .video:
            ZStack {
                SiteImage(path: post.media.first?.thumbnailUrl)
                if let path = post.media.first?.url, let url = store.siteURL(path) {
                    LoopingVideo(url: url, isPlaying: isActive && !actions.motionPaused, isMuted: !soundOn)
                }
            }
            .accessibilityLabel(post.media.first?.alt ?? "Clip from \(post.author.name)")
        case .photo:
            SiteImage(path: post.media.first?.url)
                .accessibilityLabel(post.media.first?.alt ?? "Photo by \(post.author.name)")
        default:
            SiteImage(path: post.metadata.artworkUrl ?? post.media.first?.thumbnailUrl ?? post.author.photoUrl)
                .accessibilityHidden(true)
        }
    }
}

/// Avatar, name, when, caption.
private struct AuthorBlock: View {
    let post: FeedPost
    let open: (String) -> Void
    var showsBody = true
    var onMedia = true

    var body: some View {
        HStack(alignment: showsBody ? .top : .center, spacing: 10) {
            Button { open(post.profilePath) } label: {
                MemberAvatar(name: post.author.name, photoPath: post.author.photoUrl, size: 40)
                    .overlay(Circle().stroke(.white.opacity(0.9), lineWidth: 2))
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("\(post.author.name)'s profile")

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Button { open(post.profilePath) } label: {
                        Text(post.author.name)
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(onMedia ? .white : Theme.ink)
                            .lineLimit(1)
                    }
                    .buttonStyle(.plain)
                    Text(FeedDate.ago(post.publishedAt))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(onMedia ? .white.opacity(0.7) : Theme.muted)
                        .accessibilityLabel("Posted \(FeedDate.ago(post.publishedAt)) ago")
                }
                if showsBody, let body = post.body, !body.isEmpty {
                    Text(body)
                        .font(.system(size: onMedia ? 15 : 17))
                        .foregroundStyle(onMedia ? .white.opacity(0.92) : Theme.ink)
                        .lineLimit(onMedia ? 2 : 8)
                        .lineSpacing(onMedia ? 0 : 3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if onMedia, let location = post.metadata.location {
                    Label(location, systemImage: "mappin.and.ellipse")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)
                }
            }
        }
        .shadow(color: onMedia ? .black.opacity(0.35) : .clear, radius: 6, y: 2)
    }
}

/// Heart · comments · share · save, down the right edge of a media card.
private struct ActionRail: View {
    let post: FeedPost
    let actions: FeedActions
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        VStack(spacing: 8) {
            RailButton(symbol: post.viewer.liked ? "heart.fill" : "heart", label: "YEP", count: post.counts.likes,
                       tint: post.viewer.liked ? Theme.red : .white) { actions.toggle("like", post) }
            RailButton(symbol: "bubble.left", label: "Comments", count: post.counts.comments, tint: .white) { actions.comment(post) }
            if let url = store.siteURL(post.profilePath) {
                ShareLink(item: url) {
                    RailGlyph(symbol: "arrowshape.turn.up.right", count: nil, tint: .white)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("Share")
            }
            RailButton(symbol: post.viewer.bookmarked ? "bookmark.fill" : "bookmark", label: post.viewer.bookmarked ? "Saved" : "Save",
                       count: nil, tint: .white) { actions.toggle("bookmark", post) }
        }
        .padding(.vertical, 8)
        .frame(width: 50)
        .background(.black.opacity(0.32), in: Capsule())
        .overlay(Capsule().stroke(.white.opacity(0.08)))
    }
}

private struct RailButton: View {
    let symbol: String
    let label: String
    let count: Int?
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            action()
        } label: {
            RailGlyph(symbol: symbol, count: count, tint: tint)
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
        .accessibilityValue(count.map { "\($0)" } ?? "")
    }
}

private struct RailGlyph: View {
    let symbol: String
    let count: Int?
    let tint: Color

    var body: some View {
        VStack(spacing: 3) {
            Image(systemName: symbol)
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(tint)
                .frame(height: 24)
                .contentTransition(.symbolEffect(.replace))
            if let count {
                Text(Compact.string(count))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .contentTransition(.numericText())
            }
        }
        .frame(width: 44, height: count == nil ? 36 : 44)
        .contentShape(Rectangle())
    }
}

/// Now playing: cover, title, artist, the waveform, play.
private struct SongChip: View {
    let post: FeedPost
    @ObservedObject var player: HomeSongPlayer
    let open: (String) -> Void
    @EnvironmentObject private var store: ShellStore

    private var playing: Bool { player.playingID == post.id }
    private var songsPage: String { post.profilePath + (post.profilePath.contains("?") ? "&" : "?") + "view=songs" }
    private var streamURL: URL? { post.media.first.flatMap { store.siteURL($0.url) } }

    var body: some View {
        HStack(spacing: 10) {
            Button { open(songsPage) } label: {
                HStack(spacing: 10) {
                    SiteImage(path: post.metadata.artworkUrl ?? post.media.first?.thumbnailUrl ?? post.author.photoUrl)
                        .frame(width: 38, height: 38)
                        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(post.metadata.title ?? post.body ?? "Shared song")
                            .font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                        Text(post.metadata.artist ?? post.author.name)
                            .font(.system(size: 12)).foregroundStyle(.white.opacity(0.7))
                    }
                    .lineLimit(1)
                    .frame(minWidth: 70, alignment: .leading)
                }
            }
            .buttonStyle(.plain)
            .layoutPriority(1)
            .accessibilityLabel("\(post.metadata.title ?? "Song") by \(post.metadata.artist ?? post.author.name)")
            .accessibilityHint("Opens their songs")

            WaveformBars(seed: Int(post.id) ?? 7, progress: playing ? player.progress : 0, bars: 22, height: 22)
                .frame(minWidth: 40, maxWidth: 96)

            Button {
                if let streamURL { player.toggle(id: post.id, url: streamURL) } else { open(songsPage) }
            } label: {
                Image(systemName: playing ? "pause.fill" : "play.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .background(.white.opacity(0.14), in: Circle())
                    .overlay(Circle().stroke(.white.opacity(0.18)))
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel(playing ? "Pause" : "Play \(post.metadata.title ?? "song")")
        }
        .padding(.leading, 6)
        .padding(.trailing, 2)
        .frame(height: 52)
        .designGlass(radius: 14)
    }
}

/// Sound for clips and promos, which play muted until you ask.
private struct SoundButton: View {
    @Binding var soundOn: Bool

    var body: some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            soundOn.toggle()
        } label: {
            Image(systemName: soundOn ? "speaker.wave.2.fill" : "speaker.slash.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(.black.opacity(0.35), in: Circle())
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(soundOn ? "Mute" : "Turn sound on")
    }
}

/// The card's "…": motion, sound, repost, connect, profile, and delete on your own posts.
private struct PostMenu: View {
    let post: FeedPost
    let actions: FeedActions
    @Binding var soundOn: Bool
    @Binding var confirmingDelete: Bool
    var onMedia = true

    var body: some View {
        Menu {
            Button { actions.toggle("repost", post) } label: {
                Label(post.viewer.reposted ? "Undo repost (\(Compact.string(post.counts.reposts)))" : "Repost (\(Compact.string(post.counts.reposts)))",
                      systemImage: "arrow.2.squarepath")
            }
            Button { actions.open(post.profilePath) } label: {
                Label("Open \(post.author.name)'s profile", systemImage: "person.crop.circle")
            }
            if post.author.id != "roster" && !post.viewer.canDelete {
                Button { actions.open(post.profilePath + "#friend-space") } label: {
                    Label("Connect with \(post.author.name)", systemImage: "person.badge.plus")
                }
            }
            Section {
                Button(action: actions.toggleMotion) {
                    Label(actions.motionPaused ? "Play motion" : "Pause motion",
                          systemImage: actions.motionPaused ? "play.circle" : "pause.circle")
                }
                Button { soundOn.toggle() } label: {
                    Label(soundOn ? "Mute clips" : "Turn sound on", systemImage: soundOn ? "speaker.slash" : "speaker.wave.2")
                }
            }
            if post.viewer.canDelete {
                Section {
                    Button(role: .destructive) { confirmingDelete = true } label: {
                        Label("Delete my post", systemImage: "trash")
                    }
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(onMedia ? .white : Theme.muted)
                .shadow(color: onMedia ? .black.opacity(0.4) : .clear, radius: 4)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel("More for this post")
    }
}

private extension View {
    func confirmDelete(post: FeedPost, isPresented: Binding<Bool>, delete: @escaping (FeedPost) -> Void) -> some View {
        confirmationDialog("Delete this post?", isPresented: isPresented, titleVisibility: .visible) {
            Button("Delete my post", role: .destructive) { delete(post) }
        } message: {
            Text("It comes off WYD for everyone. This can't be undone.")
        }
    }
}

/// Words only: the author on top, the post, and the actions in a row underneath.
private struct TextPostCard: View {
    let post: FeedPost
    let actions: FeedActions
    @Binding var soundOn: Bool
    @EnvironmentObject private var store: ShellStore
    @State private var confirmingDelete = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                AuthorBlock(post: post, open: actions.open, showsBody: false, onMedia: false)
                Spacer(minLength: 4)
                PostMenu(post: post, actions: actions, soundOn: $soundOn, confirmingDelete: $confirmingDelete, onMedia: false)
                    .padding(.top, -6).padding(.trailing, -10)
            }
            Text(post.body ?? "")
                .font(.system(size: 17))
                .foregroundStyle(Theme.ink)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
            if let location = post.metadata.location {
                Label(location, systemImage: "mappin.and.ellipse")
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.muted)
            }
            HStack(spacing: 18) {
                inline(post.viewer.liked ? "heart.fill" : "heart", "YEP", post.counts.likes,
                       tint: post.viewer.liked ? Theme.red : Theme.ink) { actions.toggle("like", post) }
                inline("bubble.left", "Comments", post.counts.comments, tint: Theme.ink) { actions.comment(post) }
                inline("arrow.2.squarepath", "Repost", post.counts.reposts,
                       tint: post.viewer.reposted ? Theme.red : Theme.ink) { actions.toggle("repost", post) }
                Spacer(minLength: 0)
                if let url = store.siteURL(post.profilePath) {
                    ShareLink(item: url) {
                        Image(systemName: "arrowshape.turn.up.right").font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(Theme.ink).frame(width: 36, height: 36)
                    }
                    .buttonStyle(PressableStyle())
                    .accessibilityLabel("Share")
                }
                Button { actions.toggle("bookmark", post) } label: {
                    Image(systemName: post.viewer.bookmarked ? "bookmark.fill" : "bookmark").font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Theme.ink).frame(width: 36, height: 36)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel(post.viewer.bookmarked ? "Saved" : "Save")
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .designCard(padding: 16)
        .confirmDelete(post: post, isPresented: $confirmingDelete, delete: actions.delete)
    }

    private func inline(_ symbol: String, _ label: String, _ count: Int, tint: Color, action: @escaping () -> Void) -> some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            action()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: symbol).font(.system(size: 18, weight: .semibold)).foregroundStyle(tint)
                    .contentTransition(.symbolEffect(.replace))
                Text(Compact.string(count)).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.muted)
                    .contentTransition(.numericText())
            }
            .frame(minHeight: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
        .accessibilityValue("\(count)")
    }
}

// MARK: - House ads

/// A ROOSTER house ad: looping footage full-bleed, the offer over the bottom.
private struct PromoCard: View {
    let promo: Promo
    let isActive: Bool
    @Binding var soundOn: Bool
    let open: (String) -> Void
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        MediaFrame {
            ZStack(alignment: .bottomLeading) {
                Color.clear.overlay {
                    ZStack {
                        SiteImage(path: promo.poster)
                        if let video = promo.video, let url = store.siteURL(video) {
                            LoopingVideo(url: url, isPlaying: isActive, isMuted: !soundOn)
                        }
                    }
                }
                .clipped()
                .accessibilityHidden(true)
                CardScrim()
                VStack(alignment: .leading, spacing: 6) {
                    Eyebrow(text: "ROOSTER preview", color: Theme.red)
                    Text(promo.title)
                        .font(.roosterDisplay(20, relativeTo: .title2))
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(promo.copy)
                        .font(.system(size: 14))
                        .foregroundStyle(.white.opacity(0.85))
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 10) {
                        Button { open(promo.href) } label: {
                            Text(promo.action)
                        }
                        .buttonStyle(DesignPrimaryButtonStyle(height: 44))
                        .frame(maxWidth: 220)
                        Spacer(minLength: 0)
                        SoundButton(soundOn: $soundOn)
                    }
                    .padding(.top, 6)
                }
                .padding(16)
            }
            .overlay(alignment: .topTrailing) {
                Text("SPONSORED · \(promo.category.uppercased())")
                    .font(.system(size: 11, weight: .heavy))
                    .tracking(0.8)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .designGlass(radius: 12)
                    .padding(12)
            }
        }
    }
}

/// The open casting campaign: the poster, then the call and its button.
private struct CastingCard: View {
    let promo: Promo
    let open: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Eyebrow(text: "\(promo.sponsor ?? "ROOSTER") · \(promo.category)", color: Theme.red)
                .padding(.horizontal, 16).padding(.vertical, 12)
            SiteImage(path: promo.poster, contentMode: .fit)
                .frame(maxWidth: .infinity)
                .frame(maxHeight: 360)
                .background(Theme.background)
                .accessibilityLabel("\(promo.copy) Apply on ROOSTER.")
            VStack(alignment: .leading, spacing: 8) {
                Text(promo.title)
                    .font(.roosterDisplay(20, relativeTo: .title2))
                    .foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(promo.copy)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                Button { open(promo.href) } label: { Text(promo.action) }
                    .buttonStyle(.designPrimary)
                    .padding(.top, 6)
            }
            .padding(16)
        }
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous).stroke(Theme.line))
    }
}

// MARK: - Headlines

/// A music or sports headline, with the way out to the original story.
private struct NewsCard: View {
    let story: Story
    let open: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Eyebrow(text: story.isSports ? "Sports news" : "Music news", color: Theme.red)
                Spacer()
                RoosterMark(size: 22, light: true).opacity(0.35)
            }
            Text("\(story.source)  ·  \(FeedDate.storyDate(story.publishedAt))")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.muted)
            Text(story.title)
                .font(.rooster(22))
                .foregroundStyle(Theme.ink)
                .lineLimit(5)
                .fixedSize(horizontal: false, vertical: true)
            Button { open(story.url) } label: {
                HStack(spacing: 6) {
                    Text("Read on \(story.source)")
                    Image(systemName: "arrow.up.right").font(.system(size: 13, weight: .bold))
                }
            }
            .buttonStyle(DesignGlassButtonStyle(height: 44))
            .padding(.top, 4)
            Text("Headline from \(story.source). Opens the original story.")
                .font(.system(size: 11))
                .foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            LinearGradient(colors: [Theme.red.opacity(0.22), Theme.surface, Theme.surface], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous).stroke(Theme.line))
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Song playback

/// Plays one shared song at a time from its card's chip.
@MainActor
final class HomeSongPlayer: ObservableObject {
    @Published private(set) var playingID: String?
    @Published private(set) var progress: Double = 0
    /// Set when a song could not be played, so the feed can say so.
    @Published private(set) var failure: String?
    private var player: AVPlayer?
    private var timeObserver: Any?
    private var statusWatch: NSKeyValueObservation?
    private var endWatch: NSObjectProtocol?

    func toggle(id: String, url: URL) {
        if playingID == id {
            stop()
            return
        }
        stop()
        failure = nil
        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.2, preferredTimescale: 600), queue: .main) { [weak self] time in
            MainActor.assumeIsolated {
                guard let self, let duration = self.player?.currentItem?.duration.seconds, duration.isFinite, duration > 0 else { return }
                self.progress = min(1, max(0, time.seconds / duration))
            }
        }
        statusWatch = item.observe(\.status) { [weak self] item, _ in
            guard item.status == .failed else { return }
            Task { @MainActor in
                self?.stop()
                self?.failure = "That song can't play here. Open it from their songs."
            }
        }
        endWatch = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.stop() }
        }
        self.player = player
        playingID = id
        progress = 0
        player.play()
    }

    func stop() {
        player?.pause()
        if let timeObserver { player?.removeTimeObserver(timeObserver) }
        if let endWatch { NotificationCenter.default.removeObserver(endWatch) }
        timeObserver = nil
        endWatch = nil
        statusWatch = nil
        player = nil
        playingID = nil
        progress = 0
    }

    func clearFailure() { failure = nil }
}
