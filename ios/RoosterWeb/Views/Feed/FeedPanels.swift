import SwiftUI

/// What a card asks the feed to do.
struct FeedActions {
    var open: (String) -> Void
    var toggle: (String, FeedPost) -> Void
    var comment: (FeedPost) -> Void
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
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .shadow(color: .black.opacity(0.08), radius: 14, y: 6)
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
private struct PostCard: View {
    let post: FeedPost
    let isActive: Bool
    @Binding var soundOn: Bool
    let actions: FeedActions
    @EnvironmentObject private var store: ShellStore

    private var onMedia: Bool { post.surface == .video || post.surface == .photo }
    private var ink: Color { onMedia || post.surface == .audio || post.surface == .room ? .white : Theme.ink }

    var body: some View {
        ZStack(alignment: .bottom) {
            surface
            if onMedia {
                LinearGradient(colors: [.clear, .clear, .black.opacity(0.65)], startPoint: .top, endPoint: .bottom)
                    .allowsHitTesting(false)
            }
            HStack(alignment: .bottom, spacing: 14) {
                info
                Spacer(minLength: 0)
                rail
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 18)
        }
        .background(onMedia || post.surface != .text ? Color(hex: 0x141213) : Theme.surface)
    }

    @ViewBuilder private var surface: some View {
        switch post.surface {
        case .video:
            GeometryReader { geometry in
                ZStack {
                    SiteImage(path: post.media.first?.thumbnailUrl)
                    if let path = post.media.first?.url, let url = store.siteURL(path) {
                        LoopingVideo(url: url, isPlaying: isActive, isMuted: !soundOn)
                    }
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
                .clipped()
            }
            .overlay(alignment: .topTrailing) { SoundButton(soundOn: $soundOn).padding(16) }
        case .photo:
            GeometryReader { geometry in
                SiteImage(path: post.media.first?.url)
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .clipped()
            }
            .accessibilityLabel(post.media.first?.alt ?? "Photo by \(post.author.name)")
        case .audio:
            SongSurface(post: post, open: actions.open)
        case .room:
            RoomSurface(post: post, open: actions.open)
        case .text:
            VStack {
                Spacer()
                Text(post.body ?? "")
                    .font(.rooster(28, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 24)
                    .padding(.trailing, 56)
                Spacer()
                Spacer()
            }
            .background(
                LinearGradient(colors: [Theme.surface, Theme.background], startPoint: .top, endPoint: .bottom)
            )
        }
    }

    private var info: some View {
        VStack(alignment: .leading, spacing: 6) {
            if post.isProfileClip {
                Label("New clip", systemImage: "play.fill")
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundStyle(Color(hex: 0xFFD56A))
            }
            HStack(spacing: 8) {
                Button { actions.open(post.profilePath) } label: {
                    Text(post.author.name).font(.system(size: 17, weight: .heavy))
                }
                .buttonStyle(.plain)
                if post.author.id != "roster" {
                    Button { actions.open(post.profilePath + "#friend-space") } label: {
                        Text("Connect")
                            .font(.system(size: 12, weight: .heavy))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .overlay(Capsule().stroke(ink.opacity(0.6)))
                    }
                    .buttonStyle(.plain)
                }
            }
            if onMedia, let body = post.body, !body.isEmpty {
                Text(body).font(.system(size: 15)).lineLimit(3)
            }
            HStack(spacing: 6) {
                Text("\(post.author.kind.capitalized) · \(FeedDate.ago(post.publishedAt))")
                if let location = post.metadata.location {
                    Label(location, systemImage: "mappin").labelStyle(.titleAndIcon)
                }
            }
            .font(.system(size: 13, weight: .medium))
            .opacity(0.8)
        }
        .foregroundStyle(ink)
        .shadow(color: onMedia ? .black.opacity(0.35) : .clear, radius: 4, y: 1)
    }

    private var rail: some View {
        VStack(spacing: 16) {
            Button { actions.open(post.profilePath) } label: {
                SiteImage(path: post.author.photoUrl ?? "/roster-icon-192.png")
                    .frame(width: 46, height: 46)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(.white, lineWidth: 2))
            }
            .accessibilityLabel("\(post.author.name)'s profile")
            RailButton(symbol: post.viewer.liked ? "heart.fill" : "heart", label: "YEP", count: post.counts.likes,
                       active: post.viewer.liked, ink: ink) { actions.toggle("like", post) }
            RailButton(symbol: "bubble.right.fill", label: "Comments", count: post.counts.comments, active: false, ink: ink) { actions.comment(post) }
            RailButton(symbol: "arrow.2.squarepath", label: "Repost", count: post.counts.reposts,
                       active: post.viewer.reposted, ink: ink) { actions.toggle("repost", post) }
            RailButton(symbol: post.viewer.bookmarked ? "bookmark.fill" : "bookmark", label: "Save", count: nil,
                       active: post.viewer.bookmarked, ink: ink) { actions.toggle("bookmark", post) }
            if let url = store.siteURL(post.profilePath) {
                ShareLink(item: url) {
                    RailLabel(symbol: "arrowshape.turn.up.right.fill", label: "Share", count: nil, active: false, ink: ink)
                }
            }
        }
    }
}

private struct RailButton: View {
    let symbol: String
    let label: String
    let count: Int?
    let active: Bool
    let ink: Color
    let action: () -> Void

    var body: some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            action()
        } label: {
            RailLabel(symbol: symbol, label: label, count: count, active: active, ink: ink)
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
    let ink: Color

    var body: some View {
        VStack(spacing: 3) {
            Image(systemName: symbol)
                .font(.system(size: 25, weight: .semibold))
                .foregroundStyle(active ? Theme.red : ink)
                .symbolEffect(.bounce, value: active)
                .shadow(color: .black.opacity(ink == .white ? 0.3 : 0), radius: 3, y: 1)
            Text(count.map(Compact.string) ?? label)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(ink)
                .contentTransition(.numericText())
        }
        .frame(minWidth: 48)
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
