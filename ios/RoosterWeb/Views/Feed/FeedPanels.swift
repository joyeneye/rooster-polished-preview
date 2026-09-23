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
}

struct FeedCard: View {
    let item: FeedItem
    let isActive: Bool
    @Binding var soundOn: Bool
    let actions: FeedActions

    var body: some View {
        Group {
            switch item {
            case .promo(let promo) where promo.campaign:
                CastingCard(promo: promo, open: actions.open)
            case .promo(let promo):
                PromoCard(promo: promo, isActive: isActive, soundOn: $soundOn, open: actions.open)
            case .news(let story):
                NewsCard(story: story, isActive: isActive, open: actions.open)
            case .post(let post):
                PostCard(post: post, isActive: isActive, soundOn: $soundOn, actions: actions)
            }
        }
        .clipped()
    }
}

// MARK: - Casting call

/// The open casting campaign: poster art between a sponsor strip and a gold call to action
/// (.roster-casting-ad in slots.css).
private struct CastingCard: View {
    let promo: Promo
    let open: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            Text("\(promo.sponsor ?? "ROOSTER") · \(promo.category)")
                .font(.roosterMono(10))
                .tracking(1.4)
                .foregroundStyle(Color(hex: 0xFFE4A1))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
                .background(Color(hex: 0x26171F))
                .overlay(alignment: .bottom) { Color(hex: 0xE5B953, opacity: 0.25).frame(height: 1) }

            SiteImage(path: promo.poster, contentMode: .fit)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel("\(promo.copy) Apply on ROOSTER.")

            VStack(spacing: 6) {
                Text(promo.title)
                    .font(.rooster(23))
                    .foregroundStyle(Color(hex: 0xFFF5DC))
                Text(promo.copy)
                    .font(.system(size: 13))
                    .foregroundStyle(Color(hex: 0xF5E8DB))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Button { open(promo.href) } label: {
                    Text(promo.action)
                        .font(.system(size: 15, weight: .heavy))
                        .foregroundStyle(Color(hex: 0x3B1524))
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(Color(hex: 0xFFDC85), in: Capsule())
                }
                .buttonStyle(PressableStyle())
                .padding(.top, 6)
            }
            .padding(.horizontal, 18)
            .padding(.top, 14)
            .padding(.bottom, 18)
            .background(LinearGradient(colors: [Color(hex: 0x391820), Color(hex: 0x25171E)], startPoint: .topLeading, endPoint: .bottomTrailing))
            .overlay(alignment: .top) { Color(hex: 0xE5B953, opacity: 0.38).frame(height: 1) }
        }
        .background(Color(hex: 0x20131D))
    }
}

// MARK: - House ads

/// A ROOSTER house ad: looping footage under a red glass card (.roster-starter-promo).
private struct PromoCard: View {
    let promo: Promo
    let isActive: Bool
    @Binding var soundOn: Bool
    let open: (String) -> Void
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        ZStack(alignment: .bottom) {
            Color(hex: 0x090708)
            GeometryReader { geometry in
                ZStack {
                    SiteImage(path: promo.poster)
                    if let video = promo.video, let url = store.siteURL(video) {
                        LoopingVideo(url: url, isPlaying: isActive, isMuted: !soundOn)
                    }
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
                .clipped()
            }
            .accessibilityHidden(true)

            LinearGradient(colors: [.black.opacity(0.35), .clear, .clear, .black.opacity(0.35)], startPoint: .top, endPoint: .bottom)
                .allowsHitTesting(false)

            VStack {
                // The footage carries its own ROOSTER watermark top-left, so only the disclosure sits here.
                HStack(alignment: .center) {
                    Spacer()
                    Text("SPONSORED · \(promo.category)")
                        .font(.system(size: 11, weight: .heavy))
                        .tracking(0.9)
                        .foregroundStyle(Color(hex: 0xFFF6E8))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(.black.opacity(0.42), in: Capsule())
                }
                Spacer()
            }
            .padding(18)

            VStack(alignment: .leading, spacing: 6) {
                Text("ROOSTER PREVIEW")
                    .font(.roosterMono(10))
                    .tracking(1.6)
                    .foregroundStyle(Color(hex: 0xFFD56A))
                Text(promo.title)
                    .font(.rooster(28))
                    .foregroundStyle(Color(hex: 0xFFF9F2))
                    .fixedSize(horizontal: false, vertical: true)
                Text(promo.copy)
                    .font(.system(size: 15))
                    .foregroundStyle(Color(hex: 0xFFF4EF))
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 10) {
                    Button { open(promo.href) } label: {
                        Text(promo.action)
                            .font(.system(size: 15, weight: .heavy))
                            .foregroundStyle(Color(hex: 0x9F142D))
                            .padding(.horizontal, 22)
                            .frame(minHeight: 46)
                            .background(.white, in: Capsule())
                    }
                    .buttonStyle(PressableStyle())
                    Spacer()
                    SoundButton(soundOn: $soundOn)
                }
                .padding(.top, 8)
            }
            .padding(20)
            .background(
                LinearGradient(colors: [Color(hex: 0x71071F, opacity: 0.93), Color(hex: 0xD22F30, opacity: 0.91), Color(hex: 0xEB7E27, opacity: 0.91)],
                               startPoint: .topLeading, endPoint: .bottomTrailing),
                in: RoundedRectangle(cornerRadius: 22, style: .continuous)
            )
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(.white.opacity(0.2)))
            .shadow(color: .black.opacity(0.3), radius: 22, y: 12)
            .padding(14)
        }
    }
}

private struct SoundButton: View {
    @Binding var soundOn: Bool

    var body: some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            soundOn.toggle()
        } label: {
            Image(systemName: soundOn ? "speaker.wave.2.fill" : "speaker.slash.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .background(.black.opacity(0.28), in: Circle())
                .overlay(Circle().stroke(.white.opacity(0.35)))
                .contentTransition(.symbolEffect(.replace))
        }
        .accessibilityLabel(soundOn ? "Mute" : "Turn sound on")
    }
}

// MARK: - Headlines

/// A music or sports headline card (.slots-news-panel).
private struct NewsCard: View {
    let story: Story
    let isActive: Bool
    let open: (String) -> Void

    private var sports: Bool { story.isSports }
    private var ink: Color { sports ? Color(hex: 0x4A2420) : Color(hex: 0xFFF9F2) }
    private var soft: Color { sports ? Color(hex: 0x773C2F) : Color(hex: 0xFFF1C9) }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: sports ? [Color(hex: 0xF8E9CA), Color(hex: 0xFFC875)] : [Color(hex: 0xA41332), Color(hex: 0xC92D3B), Color(hex: 0xDA6639)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            NewsArt(sports: sports, isActive: isActive)
                .allowsHitTesting(false)

            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(sports ? "SPORTS NEWS" : "MUSIC NEWS")
                        .font(.system(size: 11, weight: .black))
                        .tracking(1.5)
                        .foregroundStyle(sports ? Color(hex: 0x9D2234) : Color(hex: 0xFFF9F2))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(sports ? Color(hex: 0xFFF5DF) : Color(hex: 0x4E0415, opacity: 0.25), in: Capsule())
                        .overlay(Capsule().stroke(sports ? Color(hex: 0xAC423C) : Color(hex: 0xFFC665)))
                    Spacer()
                    if sports {
                        RoosterMark(size: 26, light: true)
                            .padding(7)
                            .background(Color(hex: 0xB72337), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    } else {
                        // roster-mark-light.svg, as on the site: the gradient mark disappears on red.
                        RoosterMark(size: 34, light: true)
                    }
                }

                Spacer(minLength: 24)

                Text("\(story.source)  ·  \(FeedDate.storyDate(story.publishedAt))")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(soft)
                    .padding(.bottom, 12)
                Text(story.title)
                    .font(.rooster(30))
                    .foregroundStyle(ink)
                    .lineLimit(6)
                    .minimumScaleFactor(0.7)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 22)
                Button { open(story.url) } label: {
                    HStack(spacing: 6) {
                        Text("Read on \(story.source)")
                        Image(systemName: "arrow.up.right").font(.system(size: 13, weight: .bold))
                    }
                    .font(.system(size: 15, weight: .heavy))
                    .foregroundStyle(sports ? .white : Color(hex: 0x9D1432))
                    .padding(.horizontal, 22)
                    .frame(minHeight: 48)
                    .background(sports ? Color(hex: 0xAF2637) : Color(hex: 0xFFF5DF), in: Capsule())
                }
                .buttonStyle(PressableStyle())
                Text("Headline from \(story.source). Opens the original story.")
                    .font(.system(size: 11))
                    .foregroundStyle(soft.opacity(0.9))
                    .padding(.top, 12)
            }
            .padding(.horizontal, 22)
            .padding(.top, 22)
            .padding(.bottom, 26)
        }
        .accessibilityElement(children: .contain)
    }
}

/// The record and equalizer (music) or court and ball (sports) behind a headline.
private struct NewsArt: View {
    let sports: Bool
    let isActive: Bool

    var body: some View {
        GeometryReader { geometry in
            let w = geometry.size.width, h = geometry.size.height
            if sports {
                ZStack {
                    Path { path in
                        path.move(to: CGPoint(x: w * 0.12, y: h * 0.26))
                        path.addLine(to: CGPoint(x: w * 1.1, y: h * 0.08))
                        path.move(to: CGPoint(x: w * 0.12, y: h * 0.26))
                        path.addLine(to: CGPoint(x: w * 0.2, y: h * 0.56))
                        path.move(to: CGPoint(x: w * 0.6, y: h * 0.15))
                        path.addLine(to: CGPoint(x: w * 0.68, y: h * 0.56))
                    }
                    .stroke(Color(hex: 0xC46B45), lineWidth: 3)
                    Ellipse()
                        .stroke(Color(hex: 0xC46B45), lineWidth: 3)
                        .frame(width: w * 0.24, height: h * 0.2)
                        .rotationEffect(.degrees(-12))
                        .position(x: w * 0.66, y: h * 0.36)
                    ZStack {
                        Circle().fill(Color(hex: 0xF2A65A))
                        Circle().stroke(Color(hex: 0xC46B45), lineWidth: 3)
                        Path { path in
                            path.move(to: CGPoint(x: w * 0.13, y: 0)); path.addLine(to: CGPoint(x: w * 0.13, y: w * 0.26))
                            path.move(to: CGPoint(x: 0, y: w * 0.13)); path.addLine(to: CGPoint(x: w * 0.26, y: w * 0.13))
                        }
                        .stroke(Color(hex: 0xC46B45), lineWidth: 3)
                    }
                    .frame(width: w * 0.26, height: w * 0.26)
                    .rotationEffect(.degrees(isActive ? 25 : 0))
                    .animation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true), value: isActive)
                    .position(x: w * 0.27, y: h * 0.34)
                }
                .opacity(0.35)
                .mask(LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black, location: 0.38), .init(color: .clear, location: 0.58)],
                                     startPoint: .top, endPoint: .bottom))
            } else {
                ZStack {
                    ForEach(0..<7) { ring in
                        Circle()
                            .stroke(.white.opacity(0.13), lineWidth: 2)
                            .frame(width: w * (0.3 + CGFloat(ring) * 0.13), height: w * (0.3 + CGFloat(ring) * 0.13))
                    }
                    .position(x: w * 0.8, y: h * 0.3)
                    .rotationEffect(.degrees(isActive ? 360 : 0), anchor: UnitPoint(x: 0.8, y: 0.3))
                    .animation(isActive ? .linear(duration: 18).repeatForever(autoreverses: false) : .default, value: isActive)

                    Circle()
                        .fill(Color(hex: 0xFFB2A0, opacity: 0.25))
                        .frame(width: w * 0.14, height: w * 0.14)
                        .position(x: w * 0.8, y: h * 0.3)

                    TimelineView(.animation(minimumInterval: 1 / 30, paused: !isActive)) { context in
                        let t = context.date.timeIntervalSinceReferenceDate
                        HStack(alignment: .center, spacing: w * 0.022) {
                            ForEach(0..<12) { bar in
                                Capsule()
                                    .fill(Color(hex: 0xFF8A7A, opacity: 0.45))
                                    .frame(width: w * 0.024, height: h * (0.08 + 0.09 * CGFloat(abs(sin(t * 2.2 + Double(bar) * 0.7)))))
                            }
                        }
                    }
                    .position(x: w * 0.33, y: h * 0.3)
                }
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Member posts

/// A member's post as a full card: media, the action rail and the author (stagePanelMarkup).
/// One WYD post as the site draws it on the stage (stagePanelMarkup, community-home.js:344):
/// full-bleed, media letterboxed on near-black rather than cropped, the author and caption under a
/// scrim, the author's ringed avatar above a dark five-button bar, and "Delete my post" on your own.
private struct PostCard: View {
    let post: FeedPost
    let isActive: Bool
    @Binding var soundOn: Bool
    let actions: FeedActions
    @EnvironmentObject private var store: ShellStore
    @State private var confirmingDelete = false

    private var onMedia: Bool { post.surface == .video || post.surface == .photo }
    private var quiet: Bool { post.surface == .text }
    private var ink: Color { quiet ? Color(hex: 0x111113) : .white }
    /// The bar sits higher on video panels, clear of the player (slots.css:52).
    private var railBottom: CGFloat { post.surface == .video ? 48 : 10 }

    var body: some View {
        ZStack(alignment: .bottom) {
            surface
            if !quiet {
                LinearGradient(colors: [Color(hex: 0x0C0C0E, opacity: 0.82), Color(hex: 0x0C0C0E, opacity: 0)],
                               startPoint: .bottom, endPoint: .top)
                    .frame(height: 260)
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .allowsHitTesting(false)
            }
            info
                .padding(.leading, 72).padding(.trailing, 16)
                .padding(.bottom, railBottom + 72)
                .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 12) {
                avatar.padding(.leading, 4)
                rail
            }
            .padding(.horizontal, 10)
            .padding(.bottom, railBottom)
        }
        .overlay(alignment: .topLeading) {
            if post.viewer.canDelete {
                Button { confirmingDelete = true } label: {
                    Text("Delete my post")
                        .font(.rooster(15, weight: .regular)).foregroundStyle(.white)
                        .padding(.horizontal, 14).frame(minHeight: 44)
                        .background(Color(hex: 0xC7092E), in: Capsule())
                        .overlay(Capsule().stroke(.white, lineWidth: 2))
                        .shadow(color: .black.opacity(0.35), radius: 7, y: 4)
                }
                .buttonStyle(.plain)
                .padding(12)
            }
        }
        .background(quiet ? (store.theme == .dark ? Color(hex: 0x151518) : .white) : Color(hex: 0x101013))
        .confirmationDialog("Delete this post?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete my post", role: .destructive) { actions.delete(post) }
        } message: {
            Text("It comes off WYD for everyone. This can't be undone.")
        }
    }

    @ViewBuilder private var surface: some View {
        switch post.surface {
        case .video:
            ZStack {
                SiteImage(path: post.media.first?.thumbnailUrl, contentMode: .fit)
                if let path = post.media.first?.url, let url = store.siteURL(path) {
                    LoopingVideo(url: url, isPlaying: isActive && !actions.motionPaused, isMuted: !soundOn, gravity: .resizeAspect)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .photo:
            SiteImage(path: post.media.first?.url, contentMode: .fit)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel(post.media.first?.alt ?? "Photo by \(post.author.name)")
        case .audio:
            SongSurface(post: post, open: actions.open)
        case .room:
            RoomSurface(post: post, open: actions.open)
        case .text:
            Text(post.body ?? "")
                .font(.rooster(15, weight: .regular)).lineSpacing(7)
                .foregroundStyle(store.theme == .dark ? Color(hex: 0xF7F7F8) : Color(hex: 0x111113))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                .padding(.horizontal, 20).padding(.top, 24).padding(.bottom, 150)
        }
    }

    private var info: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Button { actions.open(post.profilePath) } label: {
                    Text(post.author.name).font(.rooster(15, weight: .semibold)).tracking(-0.15)
                }
                .buttonStyle(.plain)
                if post.author.id != "roster" && !post.viewer.canDelete {
                    Button { actions.open(post.profilePath + "#friend-space") } label: {
                        Text("Connect")
                            .font(.rooster(13)).foregroundStyle(Color(hex: 0x111113))
                            .padding(.horizontal, 11).frame(minHeight: 34)
                            .background(.white, in: Capsule())
                            .shadow(color: .black.opacity(0.22), radius: 8, y: 4)
                    }
                    .buttonStyle(.plain)
                }
            }
            if !quiet, let body = post.body, !body.isEmpty {
                Text(body).font(.rooster(15, weight: .regular)).lineSpacing(4).lineLimit(3)
            }
            Text("\(post.author.kind.capitalized) · \(FeedDate.ago(post.publishedAt))")
                .font(.roosterMono(12, bold: false))
            if let location = post.metadata.location {
                Text("⌖ \(location)").font(.rooster(12, weight: .regular))
            }
        }
        .foregroundStyle(quiet && store.theme != .dark ? Color(hex: 0x111113) : .white)
    }

    /// The avatar in its red-orange-gold ring (roster-home.css:1446-1456).
    private var avatar: some View {
        Button { actions.open(post.profilePath) } label: {
            SiteImage(path: post.author.photoUrl ?? "/roster-icon-192.png")
                .frame(width: 44, height: 44)
                .clipShape(Circle())
                .overlay(Circle().stroke(.white, lineWidth: 2))
                .padding(2)
                .background(LinearGradient(colors: [Color(hex: 0xCE0633), Color(hex: 0xFF7A3D), Color(hex: 0xFFBF46)],
                                           startPoint: .leading, endPoint: .trailing), in: Circle())
                .shadow(color: .black.opacity(0.26), radius: 10, y: 6)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(post.author.name)'s profile")
    }

    /// YEP · Comments · Repost · Save · Share, in the dark bar (slots.css:53-54).
    private var rail: some View {
        HStack(spacing: 2) {
            RailButton(symbol: post.viewer.liked ? "heart.fill" : "heart", label: "YEP", count: post.counts.likes,
                       active: post.viewer.liked) { actions.toggle("like", post) }
            RailButton(symbol: "bubble.left", label: "Comments", count: post.counts.comments, active: false) { actions.comment(post) }
            RailButton(symbol: "arrow.2.squarepath", label: "Repost", count: post.counts.reposts,
                       active: post.viewer.reposted) { actions.toggle("repost", post) }
            RailButton(symbol: post.viewer.bookmarked ? "bookmark.fill" : "bookmark", label: "Save", count: nil,
                       active: post.viewer.bookmarked) { actions.toggle("bookmark", post) }
            if let url = store.siteURL(post.profilePath) {
                ShareLink(item: url) {
                    RailLabel(symbol: "arrowshape.turn.up.right", label: "Share", count: nil, active: false)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(6)
        .background(Color(hex: 0x121011, opacity: 0.82), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(.white.opacity(0.22)))
        .shadow(color: .black.opacity(0.28), radius: 16, y: 12)
    }
}

private struct RailButton: View {
    let symbol: String
    let label: String
    let count: Int?
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            action()
        } label: {
            RailLabel(symbol: symbol, label: label, count: count, active: active)
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
        .accessibilityValue(count.map { "\($0)" } ?? "")
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

private struct RailLabel: View {
    let symbol: String
    let label: String
    let count: Int?
    let active: Bool

    var body: some View {
        VStack(spacing: 1) {
            Image(systemName: symbol)
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(active ? Color(hex: 0xFF4D6D) : .white)
                .frame(height: 21)
                .symbolEffect(.bounce, value: active)
            Text(label).font(.rooster(10)).foregroundStyle(.white)
            if let count {
                Text(Compact.string(count)).font(.rooster(10, weight: .regular))
                    .foregroundStyle(.white.opacity(0.74))
                    .contentTransition(.numericText())
            }
        }
        .frame(maxWidth: .infinity, minHeight: 54)
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// A shared song: artwork, title and a play button to the artist's music (songMarkup).
private struct SongSurface: View {
    let post: FeedPost
    let open: (String) -> Void

    var body: some View {
        let art = post.media.first?.thumbnailUrl ?? post.metadata.artworkUrl ?? post.author.photoUrl
        ZStack {
            SiteImage(path: art).blur(radius: 40).overlay(Color.black.opacity(0.45))
            VStack(spacing: 18) {
                SiteImage(path: art)
                    .frame(width: 210, height: 210)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .shadow(color: .black.opacity(0.4), radius: 24, y: 12)
                VStack(spacing: 4) {
                    Text(post.metadata.title ?? post.body ?? "Shared song").font(.rooster(26))
                    Text(post.metadata.artist ?? post.author.name).font(.system(size: 15, weight: .semibold)).opacity(0.8)
                    Label("\(Compact.string(post.metadata.playCount ?? post.counts.views)) listens", systemImage: "play.fill")
                        .font(.system(size: 12, weight: .bold))
                        .opacity(0.7)
                        .padding(.top, 2)
                }
                .foregroundStyle(.white)
                Button { open(post.profilePath + (post.profilePath.contains("?") ? "&" : "?") + "view=songs") } label: {
                    Label("Listen", systemImage: "play.fill")
                        .font(.system(size: 16, weight: .heavy))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 28)
                        .frame(minHeight: 50)
                        .background(Theme.red, in: Capsule())
                }
                .buttonStyle(PressableStyle())
            }
            .padding(.bottom, 120)
        }
    }
}

/// A live room post with a Join button (roomMarkup).
private struct RoomSurface: View {
    let post: FeedPost
    let open: (String) -> Void

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: 0x2A0E17), Color(hex: 0x6E0B24), Theme.red], startPoint: .top, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 10) {
                Text("● LIVE \(post.metadata.medium == "video" ? "VIDEO" : "ROOM")")
                    .font(.roosterMono(12))
                    .foregroundStyle(Color(hex: 0xFFD56A))
                Text(post.metadata.title ?? post.body ?? "Live on ROOSTER")
                    .font(.rooster(32))
                    .foregroundStyle(.white)
                Text("\(post.metadata.hostName ?? post.author.name) · \(Compact.string(post.metadata.speakers ?? 1)) speakers · \(Compact.string(post.metadata.listeners ?? 0)) listening")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.8))
                Button { open("/live.html?room=\(post.roomId ?? "")") } label: {
                    Text("Join")
                        .font(.system(size: 16, weight: .heavy))
                        .foregroundStyle(Theme.red)
                        .padding(.horizontal, 34)
                        .frame(minHeight: 50)
                        .background(.white, in: Capsule())
                }
                .buttonStyle(PressableStyle())
                .padding(.top, 8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
            .padding(.bottom, 120)
        }
    }
}
