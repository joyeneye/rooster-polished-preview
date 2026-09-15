import AVKit
import SwiftUI

/// A member's profile, native. With no id it is the signed-in member's own (the Me tab).
struct ProfileView: View {
    @EnvironmentObject private var store: ShellStore
    @EnvironmentObject private var session: SessionModel
    @StateObject private var model: ProfileModel
    let stack: ShellTab

    @State private var notice: String?
    @State private var browser: BrowserDestination?
    @State private var viewingPhoto: AlbumPage.Photo?
    @State private var playingClip: ClipsList.Clip?

    init(id: String?, initialTab: ProfileModel.Tab = .posts, stack: ShellTab, api: FeedAPI) {
        _model = StateObject(wrappedValue: ProfileModel(id: id, initialTab: initialTab, api: api))
        self.stack = stack
    }

    var body: some View {
        Group {
            if let bundle = model.bundle {
                content(bundle)
            } else if let failure = model.failure {
                ErrorState(message: failure.message) {
                    if case .locked = failure { session.revalidate() }
                    Task { await model.load() }
                }
                .frame(maxHeight: .infinity)
            } else {
                ProgressView().controlSize(.large).tint(Theme.red).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.background)
        .navigationTitle(model.bundle?.profile.name ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .notice($notice)
        .sheet(item: $browser) { SafariView(url: $0.url).ignoresSafeArea() }
        .fullScreenCover(item: $viewingPhoto) { photo in
            PhotoViewer(photos: model.bundle?.album?.photos ?? [], selected: photo)
        }
        .fullScreenCover(item: $playingClip) { clip in
            ClipPlayer(clips: model.bundle?.clips ?? [], selected: clip)
        }
        .onAppear(perform: model.startIfNeeded)
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            if let bundle = model.bundle, let url = store.siteURL("/profile.html?id=\(bundle.profile.id)") {
                ShareLink(item: url, subject: Text(bundle.profile.name)) {
                    Image(systemName: "square.and.arrow.up").font(.system(size: 16, weight: .semibold))
                }
                .accessibilityLabel("Share profile")
            }
        }
    }

    private func content(_ bundle: ProfileBundle) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: .sectionHeaders) {
                ProfileHero(bundle: bundle, open: open, comingSoon: { notice = ComingSoon.text })
                if let room = bundle.liveRoom {
                    LiveBanner(room: room) { open("/live.html?room=\(room.key)") }
                        .padding(.horizontal, 16).padding(.top, 14)
                }
                if let businesses = bundle.bookings?.businesses, !businesses.isEmpty {
                    BookingsStrip(businesses: businesses, isMe: bundle.isMe, open: open).padding(.top, 20)
                }
                if let top = bundle.topEight, !top.members.isEmpty {
                    TopEightStrip(topEight: top, open: open).padding(.top, 24)
                }
                Section {
                    tabContent(bundle)
                        .padding(.top, 16)
                        .animation(.snappy, value: model.tab)
                } header: {
                    ProfileTabs(selection: $model.tab, isMusic: bundle.profile.isMusic)
                        .padding(.top, 20)
                        .background(Theme.background)
                }
                if let friends = bundle.friends {
                    RosterStrip(name: bundle.profile.name, friends: friends, open: open).padding(.top, 28)
                }
                if let visitors = bundle.visitors {
                    ActivityCard(visitors: visitors, open: open).padding(.horizontal, 16).padding(.top, 24)
                }
                Spacer(minLength: 40)
            }
        }
        .refreshable { await model.load() }
        .solidTopEdge()
    }

    @ViewBuilder private func tabContent(_ bundle: ProfileBundle) -> some View {
        switch model.tab {
        case .posts:
            PostsTab(bundle: bundle, play: { playingClip = $0 }, open: open, loadMoreWall: model.loadMoreWall, loadingMore: model.loadingMoreWall)
        case .music:
            MusicTab(songs: bundle.songs, plays: bundle.plays, open: open)
        case .photos:
            PhotosTab(album: bundle.album, view: { viewingPhoto = $0 })
        case .about:
            AboutTab(profile: bundle.profile)
        }
    }

    private func open(_ link: String) {
        if let external = store.open(link, from: stack) { browser = BrowserDestination(url: external) }
    }
}

// MARK: - Hero

private struct ProfileHero: View {
    let bundle: ProfileBundle
    let open: (String) -> Void
    let comingSoon: () -> Void

    private var profile: MemberProfile { bundle.profile }

    var body: some View {
        VStack(spacing: 0) {
            LinearGradient(colors: [Color(hex: 0xCE0633), Color(hex: 0xE8402F), Color(hex: 0xFF9A4D)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
                .frame(height: 104)
                .overlay(alignment: .topTrailing) {
                    RoosterMark(size: 60, light: true).opacity(0.18).padding(18)
                }

            VStack(spacing: 10) {
                MemberAvatar(name: profile.name, photoPath: profile.photoUrl, size: 108)
                    .overlay(Circle().stroke(Theme.background, lineWidth: 5))
                    .padding(.top, -58)

                VStack(spacing: 4) {
                    HStack(spacing: 6) {
                        Text(profile.name).font(.rooster(28)).foregroundStyle(Theme.ink).multilineTextAlignment(.center)
                        if profile.verifiedOwner == true || profile.verified == true {
                            Image(systemName: "checkmark.seal.fill")
                                .font(.system(size: 20))
                                .foregroundStyle(profile.verifiedOwner == true ? Theme.gold : Theme.red)
                                .accessibilityLabel("Verified")
                        }
                    }
                    if let role = profile.roleLabel {
                        Text(role).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
                    }
                    if let place = profile.locationLine {
                        HStack(spacing: 3) {
                            Image(systemName: "mappin.circle.fill")
                            Text(place)
                        }
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.muted)
                    }
                }

                if !profile.badges.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(profile.badges, id: \.self) { badge in
                            Text(badge.uppercased())
                                .font(.roosterMono(9))
                                .tracking(0.8)
                                .foregroundStyle(Theme.red)
                                .padding(.horizontal, 9)
                                .padding(.vertical, 5)
                                .background(Theme.red.opacity(0.08), in: Capsule())
                        }
                    }
                }

                if let status = profile.status?.trimmingCharacters(in: .whitespacesAndNewlines), !status.isEmpty {
                    Text("“\(status)”")
                        .font(.system(size: 16, weight: .medium))
                        .italic()
                        .foregroundStyle(Theme.ink.opacity(0.85))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 12)
                        .padding(.top, 2)
                }

                stats.padding(.top, 6)
                actions.padding(.top, 8)
            }
            .padding(.horizontal, 16)
        }
    }

    private var stats: some View {
        HStack(spacing: 0) {
            stat(value: bundle.friends.map { Compact.string($0.count) } ?? "—", label: "On roster")
            Divider().frame(height: 28)
            stat(value: bundle.visitors?.thisWeek.map(Compact.string) ?? "—", label: "Visits this week")
            Divider().frame(height: 28)
            stat(value: bundle.visitors?.position.map { "#\($0)" } ?? "—", label: "Top Rosters")
        }
        .padding(.vertical, 10)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func stat(value: String, label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.rooster(20)).foregroundStyle(Theme.ink)
            Text(label).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var actions: some View {
        HStack(spacing: 10) {
            if bundle.isMe {
                primary("Edit profile", symbol: "pencil") { open("/members.html#member-profile-panel") }
                secondary("Account", symbol: "gearshape") { open("/members.html") }
            } else {
                let state = bundle.friends?.relationship?.state ?? "none"
                switch state {
                case "accepted": secondary("On your roster", symbol: "checkmark") {}
                case "outgoing": secondary("Requested", symbol: "clock") {}
                case "incoming": primary("Review request", symbol: "person.badge.plus") { open("/members.html#friend-requests") }
                default: primary("Add to roster", symbol: "plus", action: comingSoon)
                }
                secondary("Message", symbol: "bubble.left.fill") { open("/members.html?to=\(profile.id)#member-mail") }
            }
            if let website = profile.website {
                Button { open(website.absoluteString) } label: {
                    Image(systemName: "link").font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.ink)
                        .frame(width: 46, height: 46)
                        .background(Theme.surface, in: Circle())
                        .overlay(Circle().stroke(Color(uiColor: Theme.uiLine)))
                }
                .accessibilityLabel("Open their link")
            }
        }
    }

    private func primary(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 46)
                .background(Theme.red, in: Capsule())
        }
        .buttonStyle(PressableStyle())
    }

    private func secondary(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.ink)
                .frame(maxWidth: .infinity, minHeight: 46)
                .background(Theme.surface, in: Capsule())
                .overlay(Capsule().stroke(Color(uiColor: Theme.uiLine)))
        }
        .buttonStyle(PressableStyle())
    }
}

private struct LiveBanner: View {
    let room: LiveRooms.Room
    let join: () -> Void

    var body: some View {
        Button(action: join) {
            HStack(spacing: 12) {
                Circle().fill(.white).frame(width: 8, height: 8)
                    .padding(8)
                    .background(.white.opacity(0.2), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("LIVE NOW · \(room.isVideo ? "VIDEO" : "AUDIO ROOM")").font(.roosterMono(10)).tracking(1)
                    Text(room.title).font(.system(size: 16, weight: .bold)).lineLimit(1)
                    Text("\(room.participantCount ?? 0) in the room").font(.system(size: 12)).opacity(0.85)
                }
                Spacer()
                Text(room.isVideo ? "Watch" : "Join").font(.system(size: 14, weight: .heavy))
                    .padding(.horizontal, 16).frame(height: 36)
                    .background(.white, in: Capsule())
                    .foregroundStyle(Theme.red)
            }
            .foregroundStyle(.white)
            .padding(14)
            .background(LinearGradient(colors: [Theme.red, Color(hex: 0xE8402F)], startPoint: .leading, endPoint: .trailing),
                        in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(PressableStyle())
    }
}

private struct BookingsStrip: View {
    let businesses: [ProfileBookings.Business]
    let isMe: Bool
    let open: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading(eyebrow: "BOOK A SERVICE", title: isMe ? "Your booking pages" : "Book with them").padding(.horizontal, 20)
            ForEach(businesses) { business in
                Button { open(business.bookingUrl) } label: {
                    HStack {
                        Image(systemName: "calendar.badge.clock").font(.system(size: 20)).foregroundStyle(Theme.red)
                            .frame(width: 42, height: 42).background(Theme.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(business.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                            if let count = business.servicesCount {
                                Text("\(count) service\(count == 1 ? "" : "s")").font(.system(size: 13)).foregroundStyle(Theme.muted)
                            }
                        }
                        Spacer()
                        Image(systemName: "chevron.forward").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
                    }
                    .padding(12)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 16)
            }
        }
    }
}

private struct TopEightStrip: View {
    let topEight: TopEight
    let open: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading(eyebrow: topEight.mode == "community" ? "COMMUNITY PICKS" : "INNER CIRCLE", title: "Top 8 Roster")
                .padding(.horizontal, 20)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(Array(topEight.members.enumerated()), id: \.element.id) { index, member in
                        Button { open(member.profileUrl ?? "/profile.html?id=\(member.id)") } label: {
                            VStack(spacing: 6) {
                                MemberAvatar(name: member.name, photoPath: member.photoUrl, size: 66)
                                    .overlay(alignment: .topLeading) {
                                        Text("\(index + 1)")
                                            .font(.roosterMono(11))
                                            .foregroundStyle(.white)
                                            .frame(width: 22, height: 22)
                                            .background(Theme.red, in: Circle())
                                            .overlay(Circle().stroke(Theme.background, lineWidth: 2))
                                            .offset(x: -3, y: -3)
                                    }
                                Text(member.name).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink)
                                    .lineLimit(1).frame(width: 74)
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Number \(index + 1), \(member.name)")
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 4)
            }
        }
    }
}

private struct ProfileTabs: View {
    @Binding var selection: ProfileModel.Tab
    let isMusic: Bool
    @Namespace private var underline

    var body: some View {
        HStack(spacing: 0) {
            ForEach(ProfileModel.Tab.allCases) { tab in
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    withAnimation(.snappy(duration: 0.25)) { selection = tab }
                } label: {
                    VStack(spacing: 8) {
                        Text(tab.title)
                            .font(.system(size: 15, weight: selection == tab ? .bold : .semibold))
                            .foregroundStyle(selection == tab ? Theme.red : Theme.muted)
                        ZStack {
                            Capsule().fill(.clear).frame(height: 3)
                            if selection == tab {
                                Capsule().fill(Theme.red).frame(height: 3).matchedGeometryEffect(id: "tab", in: underline)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == tab ? .isSelected : [])
            }
        }
        .padding(.top, 10)
        .background(Theme.background)
        .overlay(alignment: .bottom) { Color(uiColor: Theme.uiLine).frame(height: 1) }
    }
}

// MARK: - Tabs

private struct PostsTab: View {
    let bundle: ProfileBundle
    let play: (ClipsList.Clip) -> Void
    let open: (String) -> Void
    let loadMoreWall: () -> Void
    let loadingMore: Bool

    private let columns = [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)]

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            if bundle.clips.isEmpty {
                EmptyTab(symbol: "play.rectangle", text: bundle.isMe ? "Your posts and videos will show here." : "No posts or videos yet.")
            } else {
                LazyVGrid(columns: columns, spacing: 6) {
                    ForEach(bundle.clips) { clip in
                        Button { play(clip) } label: { ClipTile(clip: clip) }
                            .buttonStyle(PressableStyle())
                    }
                }
                .padding(.horizontal, 12)
            }

            if let wall = bundle.wall {
                VStack(alignment: .leading, spacing: 12) {
                    SectionHeading(eyebrow: "COMMENT WALL", title: "\(bundle.profile.name)'s wall",
                                   trailing: wall.total.map { "\($0)" })
                        .padding(.horizontal, 20)
                    if wall.comments.isEmpty {
                        Text("No comments yet.").font(.system(size: 15)).foregroundStyle(Theme.muted).padding(.horizontal, 20)
                    }
                    ForEach(wall.comments.filter { $0.status != "pending" }) { comment in
                        WallCommentRow(comment: comment, open: open).padding(.horizontal, 16)
                    }
                    if wall.next != nil {
                        Button(action: loadMoreWall) {
                            HStack {
                                if loadingMore { ProgressView().tint(Theme.red) }
                                Text("Show more comments").font(.system(size: 15, weight: .semibold))
                            }
                            .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .tint(Theme.red)
                    }
                }
            }
        }
    }
}

private struct ClipTile: View {
    let clip: ClipsList.Clip
    @EnvironmentObject private var store: ShellStore
    @State private var poster: UIImage?

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Color(hex: 0x1A1416)
                .overlay {
                    if let poster {
                        Image(uiImage: poster).resizable().scaledToFill()
                    }
                }
                .clipped()
            LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .center, endPoint: .bottom)
            HStack(spacing: 3) {
                Image(systemName: "play.fill").font(.system(size: 10))
                if let duration = clip.duration { Text("0:\(String(format: "%02d", Int(duration.rounded())))") }
            }
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(.white)
            .padding(8)
        }
        .aspectRatio(9 / 14, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .task {
            guard poster == nil, let url = store.siteURL(clip.videoUrl) else { return }
            poster = await ClipPoster.shared.image(for: url)
        }
        .accessibilityLabel(clip.caption?.isEmpty == false ? clip.caption! : "Video")
    }
}

/// First frames for clip tiles; the clip JSON has no poster image.
actor ClipPoster {
    static let shared = ClipPoster()
    private let cache = NSCache<NSURL, UIImage>()

    func image(for url: URL) async -> UIImage? {
        if let cached = cache.object(forKey: url as NSURL) { return cached }
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 360, height: 560)
        guard let (image, _) = try? await generator.image(at: CMTime(seconds: 0.4, preferredTimescale: 600)) else { return nil }
        let result = UIImage(cgImage: image)
        cache.setObject(result, forKey: url as NSURL)
        return result
    }
}

private struct WallCommentRow: View {
    let comment: WallPage.Comment
    let open: (String) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button { if let url = comment.profileUrl { open(url) } } label: {
                MemberAvatar(name: comment.name, photoPath: comment.photoUrl, size: 40)
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Text(comment.name).font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.ink)
                    if comment.verifiedOwner == true || comment.verified == true {
                        Image(systemName: "checkmark.seal.fill").font(.system(size: 12))
                            .foregroundStyle(comment.verifiedOwner == true ? Theme.gold : Theme.red)
                    }
                    Spacer()
                    Text(FeedDate.ago(comment.createdAt)).font(.system(size: 12)).foregroundStyle(Theme.muted)
                }
                Text(comment.message).font(.system(size: 15)).foregroundStyle(Theme.ink.opacity(0.9))
            }
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

private struct MusicTab: View {
    let songs: SongsList?
    let plays: [String: Int]
    let open: (String) -> Void
    @StateObject private var player = SongPlayer()
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        let own = songs?.songs ?? []
        let featured = songs?.featuredSongs ?? []
        let catalog = songs?.catalogSongs ?? []
        VStack(alignment: .leading, spacing: 22) {
            if own.isEmpty && featured.isEmpty && catalog.isEmpty {
                EmptyTab(symbol: "music.note", text: "No songs on this page yet.")
            }
            if !own.isEmpty { songSection(title: "Profile Music", songs: own) }
            if !featured.isEmpty { songSection(title: "Featured from the community", songs: featured) }
            if !catalog.isEmpty { songSection(title: "The catalog", songs: catalog) }
        }
    }

    private func songSection(title: String, songs: [SongsList.Song]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading(eyebrow: nil, title: title).padding(.horizontal, 20)
            VStack(spacing: 0) {
                ForEach(Array(songs.enumerated()), id: \.element.id) { index, song in
                    Button { tap(song) } label: {
                        HStack(spacing: 14) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(LinearGradient(colors: [Theme.red, Theme.orange], startPoint: .topLeading, endPoint: .bottomTrailing))
                                Image(systemName: player.playingID == song.id ? "pause.fill" : (song.url != nil ? "play.fill" : "arrow.up.right"))
                                    .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                            }
                            .frame(width: 44, height: 44)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(song.title ?? "Untitled").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                                HStack(spacing: 6) {
                                    Text(song.origin?.name.map { "From \($0)" } ?? song.providerName)
                                    if let count = plays[song.revision ?? ""] ?? plays[song.catalogVideoId ?? ""] {
                                        Text("· \(Compact.string(count)) plays")
                                    }
                                }
                                .font(.system(size: 13)).foregroundStyle(Theme.muted).lineLimit(1)
                            }
                            Spacer()
                            Text("\(index + 1)").font(.roosterMono(12)).foregroundStyle(Theme.muted)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if index < songs.count - 1 { Divider().padding(.leading, 72) }
                }
            }
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .padding(.horizontal, 16)
        }
    }

    /// Uploaded songs play here; YouTube, Spotify and Apple Music links open in their player.
    private func tap(_ song: SongsList.Song) {
        if let path = song.url, let url = store.siteURL(path) {
            player.toggle(id: song.id, url: url)
        } else if let external = song.externalUrl ?? song.catalogVideoId.map({ "https://www.youtube.com/watch?v=\($0)" }) {
            open(external)
        }
    }
}

@MainActor
final class SongPlayer: ObservableObject {
    @Published private(set) var playingID: String?
    private var player: AVPlayer?

    func toggle(id: String, url: URL) {
        if playingID == id {
            player?.pause()
            playingID = nil
            return
        }
        player?.pause()
        let player = AVPlayer(url: url)
        self.player = player
        player.play()
        playingID = id
    }
}

private struct PhotosTab: View {
    let album: AlbumPage?
    let view: (AlbumPage.Photo) -> Void
    private let columns = [GridItem(.flexible(), spacing: 4), GridItem(.flexible(), spacing: 4), GridItem(.flexible(), spacing: 4)]
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        if let photos = album?.photos, !photos.isEmpty {
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(photos) { photo in
                    Button { view(photo) } label: {
                        // A square cell the image fills, so wide and tall photos crop instead of
                        // pushing the grid out of shape.
                        Color.clear
                            .aspectRatio(1, contentMode: .fit)
                            .overlay {
                                RemoteImage(url: store.siteURL(photo.url), size: 180) { Theme.muted.opacity(0.12) }
                            }
                            .clipped()
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(photo.caption?.isEmpty == false ? photo.caption! : "Photo")
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .padding(.horizontal, 12)
        } else {
            EmptyTab(symbol: "photo.on.rectangle", text: "No photos yet.")
        }
    }
}

private struct AboutTab: View {
    let profile: MemberProfile

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let about = profile.aboutMe?.trimmingCharacters(in: .whitespacesAndNewlines), !about.isEmpty {
                card(title: "About me", text: about)
            }
            if let credits = profile.credentials?.trimmingCharacters(in: .whitespacesAndNewlines), !credits.isEmpty {
                card(title: "Credits", text: credits)
            }
            VStack(alignment: .leading, spacing: 10) {
                if let role = profile.roleLabel { row("briefcase.fill", role) }
                if let place = profile.locationLine { row("mappin.circle.fill", place) }
                if let since = profile.membership?.memberSince, let date = FeedDate.parse(since) {
                    row("calendar", "On the roster since \(date.formatted(.dateTime.month(.wide).year()))")
                }
                if let website = profile.website { row("link", website.host ?? website.absoluteString) }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .padding(.horizontal, 16)
    }

    private func card(title: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased()).font(.roosterMono(10)).tracking(1.2).foregroundStyle(Theme.red)
            Text(text).font(.system(size: 16)).foregroundStyle(Theme.ink)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func row(_ symbol: String, _ text: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).font(.system(size: 14)).foregroundStyle(Theme.red).frame(width: 20)
            Text(text).font(.system(size: 15)).foregroundStyle(Theme.ink)
        }
    }
}

private struct EmptyTab: View {
    let symbol: String
    let text: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: symbol).font(.system(size: 30, weight: .semibold)).foregroundStyle(Theme.muted.opacity(0.7))
            Text(text).font(.system(size: 15)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
    }
}

// MARK: - Roster and activity

private struct RosterStrip: View {
    let name: String
    let friends: FriendsList
    let open: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading(eyebrow: "THE ROSTER", title: "\(name.split(separator: " ").first.map(String.init) ?? name)'s roster",
                           trailing: "\(friends.count) name\(friends.count == 1 ? "" : "s")")
                .padding(.horizontal, 20)
            if friends.friends.isEmpty {
                Text("No one on this roster yet.").font(.system(size: 15)).foregroundStyle(Theme.muted).padding(.horizontal, 20)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 14) {
                        ForEach(friends.friends.prefix(24)) { friend in
                            Button {
                                open(friend.memberId == "owner" ? "/profile.html?id=owner" : (friend.profileUrl ?? "/profile.html?id=\(friend.memberId)"))
                            } label: {
                                VStack(spacing: 6) {
                                    FriendAvatar(friend: friend)
                                    Text(friend.memberName).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink)
                                        .lineLimit(1).frame(width: 68)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 20)
                }
            }
        }
    }
}

/// The friends list carries names only; photos come from each member's profile.
private struct FriendAvatar: View {
    let friend: FriendsList.Friend
    @EnvironmentObject private var store: ShellStore
    @State private var photo: String?

    var body: some View {
        MemberAvatar(name: friend.memberName, photoPath: photo, size: 58)
            .task {
                guard photo == nil else { return }
                #if DEBUG
                if NativeFixtures.enabled { return }
                #endif
                let api = FeedAPI(base: store.baseURL)
                photo = try? await api.get("/api/profile?id=\(ProfileModel.encode(friend.memberId))", as: ProfileResponse.self).profile.photoUrl
            }
    }
}

private struct ActivityCard: View {
    let visitors: VisitorStats
    let open: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("PROFILE ACTIVITY").font(.roosterMono(10)).tracking(1.2).foregroundStyle(.white.opacity(0.8))
            HStack {
                figure(visitors.today, "Today")
                figure(visitors.thisWeek, "This week")
                figure(visitors.allTime, "All time")
            }
            if let position = visitors.position {
                Button { open("/top25.html") } label: {
                    HStack {
                        Image(systemName: "trophy.fill")
                        Text("#\(position) on the ROOSTER Top Rosters").font(.system(size: 15, weight: .bold))
                        Spacer()
                        Image(systemName: "chevron.forward").font(.system(size: 13, weight: .bold))
                    }
                    .foregroundStyle(Theme.gold)
                }
                .buttonStyle(.plain)
            }
            Text("Estimated unique visitors.").font(.system(size: 11)).foregroundStyle(.white.opacity(0.6))
        }
        .padding(18)
        .background(LinearGradient(colors: [Color(hex: 0x2A0E17), Color(hex: 0x4A0F22)], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func figure(_ value: Int?, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value.map(Compact.string) ?? "—").font(.rooster(26)).foregroundStyle(.white)
            Text(label).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Viewers

private struct PhotoViewer: View {
    let photos: [AlbumPage.Photo]
    @State var selected: AlbumPage.Photo
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            TabView(selection: $selected) {
                ForEach(photos) { photo in
                    VStack {
                        Spacer()
                        RemoteImage(url: store.siteURL(photo.url), size: 1200, contentMode: .fit) { ProgressView().tint(.white) }
                        Spacer()
                        if let caption = photo.caption, !caption.isEmpty {
                            Text(caption).font(.system(size: 15)).foregroundStyle(.white).padding()
                        }
                    }
                    .tag(photo)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: photos.count > 1 ? .always : .never))
            closeButton { dismiss() }
        }
    }
}

private struct ClipPlayer: View {
    let clips: [ClipsList.Clip]
    @State var selected: ClipsList.Clip
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            TabView(selection: $selected) {
                ForEach(clips) { clip in
                    ZStack(alignment: .bottomLeading) {
                        if let url = store.siteURL(clip.videoUrl) {
                            LoopingVideo(url: url, isPlaying: selected.id == clip.id, isMuted: false, gravity: .resizeAspect)
                        }
                        if let caption = clip.caption, !caption.isEmpty {
                            Text(caption).font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                                .shadow(radius: 4).padding(20).padding(.bottom, 20)
                        }
                    }
                    .tag(clip)
                    .ignoresSafeArea()
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()
            closeButton { dismiss() }
        }
    }
}

private func closeButton(_ action: @escaping () -> Void) -> some View {
    Button(action: action) {
        Image(systemName: "xmark").font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
            .frame(width: 40, height: 40).background(.white.opacity(0.18), in: Circle())
    }
    .padding(16)
    .accessibilityLabel("Close")
}
