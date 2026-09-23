import AVKit
import SwiftUI

/// A member's profile, native. With no id it is the signed-in member's own (the Me tab).
///
/// Laid out as design/world-class-concept/profile.png: cover, identity, counts, actions, Top 8,
/// Songs. Everything else the profile offers sits below the fold — booking pages, then a
/// Posts / Music / Photos / About switcher, the roster and the activity card — and the •••
/// menu over the cover carries More, Manager, Account and the edit and share actions.
struct ProfileView: View {
    @EnvironmentObject private var store: ShellStore
    @EnvironmentObject private var session: SessionModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.isPresented) private var isPushed
    @StateObject private var model: ProfileModel
    @StateObject private var player = SongPlayer()
    let stack: ShellTab

    @State private var notice: String?
    @State private var browser: BrowserDestination?
    @State private var viewingPhoto: AlbumPage.Photo?
    @State private var playingClip: ClipsList.Clip?
    @State private var editingProfile = false
    @State private var editingTopEight: TopEightModel?
    @State private var scrolledPastCover = false

    init(id: String?, initialTab: ProfileModel.Tab = .posts, stack: ShellTab, api: FeedAPI) {
        _model = StateObject(wrappedValue: ProfileModel(id: id, initialTab: initialTab, api: api))
        self.stack = stack
    }

    var body: some View {
        GeometryReader { proxy in
            let top = proxy.safeAreaInsets.top
            ZStack(alignment: .top) {
                Group {
                    if let bundle = model.bundle {
                        content(bundle, topInset: top)
                    } else if let failure = model.failure {
                        ErrorState(message: failure.message) {
                            if case .locked = failure { session.revalidate() }
                            Task { await model.load() }
                        }
                    } else {
                        ProgressView().controlSize(.large).tint(Theme.red)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                topBar(topInset: top)
            }
            .ignoresSafeArea(edges: .top)
        }
        .background(Theme.background.ignoresSafeArea())
        // The cover runs under the status bar, so the system bar is replaced by the concept's
        // own row (back, wordmark, •••). The title still names the back button of pushed screens.
        .navigationTitle(model.bundle?.profile.name ?? "")
        .toolbar(.hidden, for: .navigationBar)
        .notice($notice, topPadding: 56)
        .sheet(item: $browser) { SafariView(url: $0.url).ignoresSafeArea() }
        .sheet(isPresented: $editingProfile) {
            if let profile = model.bundle?.profile {
                EditPhotoStatusSheet(current: profile, actions: SiteActions(api: FeedAPI(base: store.baseURL))) { message in
                    notice = message
                    Task { await model.load() }
                }
            }
        }
        .sheet(item: $editingTopEight) { editor in
            TopEightEditor(model: editor) { message in
                notice = message
                Task { await model.load() }
            }
            .task { await editor.load() }
        }
        .task(id: model.bundle?.profile.id) {
            // The online line, now and every 45 seconds while this profile is showing.
            while !Task.isCancelled, model.bundle != nil {
                await model.refreshPresence()
                try? await Task.sleep(for: .seconds(45))
            }
        }
        .fullScreenCover(item: $viewingPhoto) { photo in
            PhotoViewer(photos: model.bundle?.album?.photos ?? [], selected: photo)
        }
        .fullScreenCover(item: $playingClip) { clip in
            ClipPlayer(clips: model.bundle?.clips ?? [], selected: clip)
        }
        .onAppear(perform: model.startIfNeeded)
    }

    // MARK: Top bar

    /// Back (when pushed), the wordmark, and the ••• menu. It gains a solid ground once the
    /// cover has scrolled away, and then shows whose page this is.
    private func topBar(topInset: CGFloat) -> some View {
        HStack(spacing: 12) {
            if isPushed {
                Button { dismiss() } label: { ProfileGlassCircle(symbol: "chevron.left") }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Back")
            }
            if scrolledPastCover, let name = model.bundle?.profile.name {
                Text(name.uppercased())
                    .font(.roosterDisplay(16, relativeTo: .headline))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                    .transition(.opacity)
            } else {
                RoosterWordmark(size: 20, color: .white)
                    .shadow(color: .black.opacity(0.5), radius: 6)
                    .transition(.opacity)
            }
            Spacer(minLength: 8)
            if let bundle = model.bundle { menu(bundle) }
        }
        .padding(.horizontal, Design.gutter)
        .frame(height: ProfileMetrics.topBar)
        .background(alignment: .bottom) {
            if scrolledPastCover {
                Rectangle().fill(.ultraThinMaterial)
                    .overlay(Theme.background.opacity(0.7))
                    .overlay(alignment: .bottom) { Theme.line.frame(height: 1) }
                    .frame(height: ProfileMetrics.topBar + topInset)
                    .transition(.opacity)
            }
        }
        .padding(.top, topInset)
        .animation(.easeOut(duration: 0.2), value: scrolledPastCover)
    }

    @ViewBuilder private func menu(_ bundle: ProfileBundle) -> some View {
        let shareURL = store.siteURL("/profile.html?id=\(bundle.profile.id)")
        Menu {
            if bundle.isMe {
                // More used to be this button on your own profile; it stays first.
                Button { store.selection = .more } label: { Label("More", systemImage: "line.3.horizontal") }
                Button { store.push(.native(.manager), in: stack) } label: { Label("Manager", systemImage: "briefcase") }
                Button { store.push(.native(.account), in: stack) } label: { Label("Account", systemImage: "person.crop.circle") }
                Divider()
                Button { editingProfile = true } label: { Label("Edit photo & status", systemImage: "camera") }
                Button { open("/members.html#member-profile-panel") } label: { Label("Edit full profile", systemImage: "pencil") }
                if bundle.topEight?.editable == true {
                    Button { editTopEight() } label: { Label("Edit Top 8", systemImage: "square.grid.2x2") }
                }
            } else if relationship(bundle) == "incoming" {
                Button { open("/members.html#friend-requests") } label: { Label("Review their request", systemImage: "person.badge.plus") }
            }
            if let website = bundle.profile.website {
                Button { open(website.absoluteString) } label: {
                    Label(bundle.isMe ? "Open my link" : "Open their link", systemImage: "link")
                }
            }
            if let shareURL {
                ShareLink(item: shareURL, subject: Text(bundle.profile.name)) {
                    Label("Share profile", systemImage: "square.and.arrow.up")
                }
            }
        } label: {
            ProfileGlassCircle(symbol: "ellipsis")
        }
        .accessibilityLabel(bundle.isMe ? "More, Manager and account" : "Profile options")
    }

    // MARK: Content

    private func content(_ bundle: ProfileBundle, topInset: CGFloat) -> some View {
        ScrollViewReader { reader in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header(bundle, topInset: topInset)

                    VStack(alignment: .leading, spacing: 24) {
                        if let room = bundle.liveRoom {
                            ProfileLiveBanner(room: room) { open("/live.html?room=\(room.key)") }
                        }
                        if let top = bundle.topEight {
                            TopEightGrid(topEight: top, open: open, edit: editTopEight)
                        }
                        songs(bundle) { withAnimation(.snappy) { model.tab = .music; reader.scrollTo("sections", anchor: .top) } }
                        if let businesses = bundle.bookings?.businesses, !businesses.isEmpty {
                            BookingsList(businesses: businesses, isMe: bundle.isMe, open: open)
                        }
                        VStack(alignment: .leading, spacing: 16) {
                            ProfileSectionPicker(selection: $model.tab)
                            tabContent(bundle).animation(.snappy, value: model.tab)
                        }
                        .id("sections")
                        if let friends = bundle.friends {
                            RosterStrip(name: bundle.profile.firstName, friends: friends, open: open)
                        }
                        if let visitors = bundle.visitors {
                            ActivityCard(visitors: visitors, open: open)
                        }
                    }
                    .padding(.horizontal, Design.gutter)
                    .padding(.top, 22)
                    .padding(.bottom, Design.tabBarClearance + 12)
                    Color.clear.frame(height: 1).id("end")
                }
            }
            .coordinateSpace(name: "profile")
            .modifier(CoverScrollTracker(past: $scrolledPastCover))
            .refreshable { await model.load() }
            .ignoresSafeArea(edges: .top)
            .solidTopEdge()
            #if DEBUG
            .task { await debugCapture(reader) }
            #endif
        }
    }

    #if DEBUG
    /// Capture hooks for the simulator (fixtures only): `-RoosterProfileTab music`,
    /// `-RoosterProfileScroll sections|end`, and `-RoosterProfilePush YES` to open another
    /// member's profile on top of your own.
    private func debugCapture(_ reader: ScrollViewProxy) async {
        guard NativeFixtures.enabled else { return }
        let defaults = UserDefaults.standard
        if !isPushed, defaults.bool(forKey: "RoosterProfilePush") {
            store.push(.native(.profile(id: "a1", tab: .posts)), in: stack)
            return
        }
        if let tab = defaults.string(forKey: "RoosterProfileTab").flatMap(ProfileModel.Tab.init(rawValue:)) { model.tab = tab }
        if let anchor = defaults.string(forKey: "RoosterProfileScroll") {
            try? await Task.sleep(for: .milliseconds(800))
            reader.scrollTo(anchor, anchor: anchor == "end" ? .bottom : .top)
        }
    }
    #endif

    /// Cover, identity, counts and the two actions.
    private func header(_ bundle: ProfileBundle, topInset: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 17) {
            ProfileIdentity(profile: bundle.profile, presence: model.presence)
            ProfileStats(items: stats(bundle))
            actions(bundle)
        }
        .padding(.horizontal, Design.gutter)
        .padding(.top, topInset + ProfileMetrics.topBar + 30)
        .background(alignment: .top) {
            ProfileCover(path: coverPath(bundle), height: topInset + ProfileMetrics.coverHeight)
        }
        .background {
            GeometryReader { geo in
                Color.clear.preference(key: ProfileScrollKey.self, value: geo.frame(in: .named("profile")).minY)
            }
        }
    }

    /// The member's own photos make the cover: the first album photo that isn't their avatar,
    /// else the avatar itself.
    private func coverPath(_ bundle: ProfileBundle) -> String? {
        let avatar = bundle.profile.photoUrl
        return bundle.album?.photos.first { $0.url != avatar }?.url ?? avatar
    }

    private func stats(_ bundle: ProfileBundle) -> [ProfileStats.Item] {
        [ProfileStats.Item(value: bundle.friends.map { Compact.string($0.count) } ?? "—", label: "Connections"),
         ProfileStats.Item(value: bundle.songs.map { Compact.string($0.songs.count) } ?? "—", label: "Songs"),
         ProfileStats.Item(value: bundle.visitors?.thisWeek.map(Compact.string) ?? "—", label: "Weekly visits")]
    }

    private func relationship(_ bundle: ProfileBundle) -> String {
        model.requestedState?.rawValue ?? bundle.friends?.relationship?.state ?? "none"
    }

    @ViewBuilder private func actions(_ bundle: ProfileBundle) -> some View {
        HStack(spacing: 12) {
            if bundle.isMe {
                Button { editingProfile = true } label: { Label("Edit profile", systemImage: "pencil") }
                    .buttonStyle(.designPrimary)
                if let url = store.siteURL("/profile.html?id=\(bundle.profile.id)") {
                    ShareLink(item: url, subject: Text(bundle.profile.name)) { Label("Share", systemImage: "square.and.arrow.up") }
                        .buttonStyle(.designGlass)
                }
            } else {
                switch relationship(bundle) {
                case "accepted":
                    Button {} label: { Label("Connected", systemImage: "checkmark") }
                        .buttonStyle(.designGlass).allowsHitTesting(false)
                case "outgoing":
                    Button {} label: { Label("Requested", systemImage: "clock") }
                        .buttonStyle(.designGlass).allowsHitTesting(false)
                case "incoming":
                    Button { open("/members.html#friend-requests") } label: { Label("Review request", systemImage: "person.badge.plus") }
                        .buttonStyle(.designPrimary)
                default:
                    Button { Task { notice = await model.connect() } } label: { Label("Connect", systemImage: "person.badge.plus") }
                        .buttonStyle(.designPrimary)
                }
                Button { open("/members.html?to=\(bundle.profile.id)#member-mail") } label: {
                    Label("Message", systemImage: "bubble.left")
                }
                .buttonStyle(.designGlass)
            }
        }
    }

    /// The first songs, with See all opening the Music section below.
    @ViewBuilder private func songs(_ bundle: ProfileBundle, seeAll: @escaping () -> Void) -> some View {
        let all = (bundle.songs?.songs ?? []) + (bundle.songs?.featuredSongs ?? []) + (bundle.songs?.catalogSongs ?? [])
        if !all.isEmpty || bundle.isMe {
            VStack(alignment: .leading, spacing: 12) {
                DesignSectionHeader(title: "Songs", action: all.count > 2 ? "See all" : nil, onAction: all.count > 2 ? seeAll : nil)
                if all.isEmpty {
                    Button { store.startCreating(.song) } label: { Label("Add your first song", systemImage: "music.note") }
                        .buttonStyle(.designGlass)
                } else {
                    ForEach(all.prefix(2)) { song in
                        ProfileSongRow(song: song, artist: MusicTab.artist(song, owner: bundle.profile.name),
                                       plays: MusicTab.plays(song, in: bundle.plays),
                                       playing: player.playingID == song.id) { tap(song) }
                    }
                }
            }
        }
    }

    @ViewBuilder private func tabContent(_ bundle: ProfileBundle) -> some View {
        switch model.tab {
        case .posts:
            PostsTab(bundle: bundle, play: { playingClip = $0 }, open: open,
                     create: { kind in store.startCreating(kind) }, room: { store.switchTo(.rooms) },
                     loadMoreWall: model.loadMoreWall, loadingMore: model.loadingMoreWall,
                     postToWall: { await model.postToWall($0) })
        case .music:
            MusicTab(bundle: bundle, player: player, tap: tap)
        case .photos:
            PhotosTab(album: bundle.album, view: { viewingPhoto = $0 })
        case .about:
            AboutTab(profile: bundle.profile, open: open)
        }
    }

    private func editTopEight() {
        editingTopEight = TopEightModel(api: FeedAPI(base: store.baseURL))
    }

    /// Uploaded songs play here; YouTube, Spotify and Apple Music links open in their player.
    private func tap(_ song: SongsList.Song) {
        if let path = song.url, let url = store.siteURL(path) {
            player.toggle(id: song.id, url: url)
        } else if let external = song.externalUrl ?? song.catalogVideoId.map({ "https://www.youtube.com/watch?v=\($0)" }) {
            open(external)
        }
    }

    private func open(_ link: String) {
        if let external = store.open(link, from: stack) { browser = BrowserDestination(url: external) }
    }
}

/// Whether the cover has scrolled up under the top bar. iOS 18 reads the scroll offset directly;
/// iOS 17 falls back to the header's position in the scroll view.
private struct CoverScrollTracker: ViewModifier {
    @Binding var past: Bool
    private let threshold = ProfileMetrics.coverHeight - ProfileMetrics.topBar

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentOffset.y + geometry.contentInsets.top > threshold
            } action: { _, now in
                past = now
            }
        } else {
            content.onPreferenceChange(ProfileScrollKey.self) { offset in
                let now = offset < -threshold
                if now != past { past = now }
            }
        }
    }
}

private struct ProfileScrollKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

// MARK: - Sections

/// Posts · Music · Photos · About.
private struct ProfileSectionPicker: View {
    @Binding var selection: ProfileModel.Tab
    @Namespace private var pill

    var body: some View {
        HStack(spacing: 4) {
            ForEach(ProfileModel.Tab.allCases) { tab in
                let selected = selection == tab
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    withAnimation(.snappy(duration: 0.25)) { selection = tab }
                } label: {
                    Text(tab.title)
                        .font(.system(size: 14, weight: selected ? .semibold : .medium))
                        .foregroundStyle(selected ? Theme.ink : Theme.muted)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background {
                            if selected {
                                Capsule().fill(Theme.raised)
                                    .overlay(Capsule().stroke(Color.white.opacity(0.1)))
                                    .matchedGeometryEffect(id: "pill", in: pill)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(4)
        .background(Theme.surface, in: Capsule())
        .overlay(Capsule().stroke(Theme.line))
    }
}

private struct ProfileLiveBanner: View {
    let room: LiveRooms.Room
    let join: () -> Void

    var body: some View {
        Button(action: join) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    LivePill(text: room.isVideo ? "LIVE · VIDEO" : "LIVE · AUDIO")
                    Text(room.title).font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.ink).lineLimit(1)
                    Text("\(room.participantCount ?? 0) in the room").font(.system(size: 13)).foregroundStyle(Theme.muted)
                }
                Spacer()
                Text(room.isVideo ? "Watch" : "Join")
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 18).frame(height: 38)
                    .background(Theme.red, in: Capsule())
            }
            .designCard(padding: 14)
            .overlay(RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous).stroke(Theme.red.opacity(0.5)))
        }
        .buttonStyle(PressableStyle())
    }
}

private struct BookingsList: View {
    let businesses: [ProfileBookings.Business]
    let isMe: Bool
    let open: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            DesignSectionHeader(title: isMe ? "Your booking pages" : "Book a service")
            ForEach(businesses) { business in
                Button { open(business.bookingUrl) } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "calendar.badge.clock").font(.system(size: 18)).foregroundStyle(Theme.red)
                            .frame(width: 42, height: 42)
                            .background(Theme.red.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(business.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                            if let count = business.servicesCount {
                                Text("\(count) service\(count == 1 ? "" : "s")").font(.system(size: 13)).foregroundStyle(Theme.muted)
                            }
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
                    }
                    .designCard(padding: 12, radius: 18)
                }
                .buttonStyle(PressableStyle())
            }
        }
    }
}

// MARK: - Tabs

private struct PostsTab: View {
    let bundle: ProfileBundle
    let play: (ClipsList.Clip) -> Void
    let open: (String) -> Void
    let create: (CreateKind) -> Void
    let room: () -> Void
    let loadMoreWall: () -> Void
    let loadingMore: Bool
    let postToWall: (String) async -> String

    private let columns = [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)]

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            if bundle.isMe {
                ProfileComposerCard(name: bundle.profile.name, photoPath: bundle.profile.photoUrl, create: create, room: room)
            }
            if bundle.clips.isEmpty {
                EmptyTab(symbol: "play.rectangle", text: bundle.isMe ? "Your posts and videos will show here." : "No posts or videos yet.")
            } else {
                LazyVGrid(columns: columns, spacing: 6) {
                    ForEach(bundle.clips) { clip in
                        Button { play(clip) } label: { ClipTile(clip: clip) }
                            .buttonStyle(PressableStyle())
                    }
                }
            }

            if let wall = bundle.wall {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        DesignSectionHeader(title: "\(bundle.profile.firstName)'s wall")
                        if let total = wall.total {
                            Text("\(total)").font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.muted)
                        }
                    }
                    if wall.canPost == true && !bundle.isMe {
                        WallComposer(name: bundle.profile.firstName, post: postToWall)
                    }
                    if wall.comments.isEmpty {
                        Text("No comments yet.").font(.system(size: 15)).foregroundStyle(Theme.muted)
                    }
                    ForEach(wall.comments.filter { $0.status != "pending" }) { comment in
                        WallCommentRow(comment: comment, open: open)
                    }
                    if wall.next != nil {
                        Button(action: loadMoreWall) {
                            HStack {
                                if loadingMore { ProgressView().tint(Theme.red) }
                                Text("Show more comments")
                            }
                        }
                        .buttonStyle(.designGlass)
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
            Theme.surface
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
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
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

/// Writing on someone's wall. What you write is screened before it appears
/// (member-wall.mts:213), so the reply says whether it went up or is waiting.
private struct WallComposer: View {
    let name: String
    let post: (String) async -> String
    @State private var draft = ""
    @State private var posting = false
    @State private var notice: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Say something to \(name)…", text: $draft, axis: .vertical)
                .lineLimit(2...5)
                .tint(Theme.red)
                .padding(12)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.line))
            HStack {
                if let notice {
                    Text(notice).font(.system(size: 13)).foregroundStyle(Theme.muted)
                }
                Spacer()
                Button {
                    let text = draft
                    posting = true
                    Task {
                        notice = await post(text)
                        posting = false
                        draft = ""
                    }
                } label: {
                    Text(posting ? "Posting…" : "Post")
                        .font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 18).frame(height: 36)
                        .background(canPost ? Theme.red : Theme.red.opacity(0.4), in: Capsule())
                }
                .disabled(!canPost)
            }
        }
    }

    private var canPost: Bool {
        !posting && draft.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
    }
}

private struct WallCommentRow: View {
    let comment: WallPage.Comment
    let open: (String) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button { if let url = comment.profileUrl { open(url) } } label: {
                ProfilePhoto(name: comment.name, path: comment.photoUrl, size: 40)
                    .frame(width: 40, height: 40).clipShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(comment.name)
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
        .designCard(padding: 14, radius: 18)
    }
}

private struct MusicTab: View {
    let bundle: ProfileBundle
    @ObservedObject var player: SongPlayer
    let tap: (SongsList.Song) -> Void

    var body: some View {
        let own = bundle.songs?.songs ?? []
        let featured = bundle.songs?.featuredSongs ?? []
        let catalog = bundle.songs?.catalogSongs ?? []
        VStack(alignment: .leading, spacing: 24) {
            if own.isEmpty && featured.isEmpty && catalog.isEmpty {
                EmptyTab(symbol: "music.note", text: "No songs on this page yet.")
            }
            if !own.isEmpty { section("Profile music", own) }
            if !featured.isEmpty { section("Featured from the community", featured) }
            if !catalog.isEmpty { section("The catalog", catalog) }
        }
    }

    private func section(_ title: String, _ songs: [SongsList.Song]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow(text: title)
            ForEach(songs) { song in
                ProfileSongRow(song: song, artist: Self.artist(song, owner: bundle.profile.name),
                               plays: Self.plays(song, in: bundle.plays),
                               playing: player.playingID == song.id) { tap(song) }
            }
        }
    }

    /// Who it is by, as far as the song says: the member it came from, the owner for an upload,
    /// else the service it lives on.
    static func artist(_ song: SongsList.Song, owner: String) -> String {
        if let name = song.origin?.name?.nilIfEmpty { return name }
        if song.source == "upload" { return owner }
        return song.providerName
    }

    static func plays(_ song: SongsList.Song, in counts: [String: Int]) -> Int? {
        counts[song.revision ?? ""] ?? counts[song.catalogVideoId ?? ""]
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
                                RemoteImage(url: store.siteURL(photo.url), size: 180) { Theme.surface }
                            }
                            .clipped()
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(photo.caption?.isEmpty == false ? photo.caption! : "Photo")
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: Design.tileRadius, style: .continuous))
        } else {
            EmptyTab(symbol: "photo.on.rectangle", text: "No photos yet.")
        }
    }
}

private struct AboutTab: View {
    let profile: MemberProfile
    let open: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let status = profile.status?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty {
                card(title: "Status", text: status)
            }
            if let about = profile.aboutMe?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty {
                card(title: "About me", text: about)
            }
            if let credits = profile.credentials?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty {
                card(title: "Credits", text: credits)
            }
            VStack(alignment: .leading, spacing: 12) {
                if let role = profile.roleLabel { row("briefcase.fill", role) }
                if let place = profile.locationLine { row("mappin.circle.fill", place) }
                if let since = profile.membership?.memberSince, let date = FeedDate.parse(since) {
                    row("calendar", "On the roster since \(date.formatted(.dateTime.month(.wide).year()))")
                }
                if let website = profile.website {
                    Button { open(website.absoluteString) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "link").font(.system(size: 14)).foregroundStyle(Theme.red).frame(width: 20)
                            Text(website.host ?? website.absoluteString).font(.system(size: 15)).foregroundStyle(Theme.ink).underline()
                        }
                    }
                    .buttonStyle(.plain)
                }
                if !profile.badges.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(profile.badges, id: \.self) { TagChip(text: $0) }
                    }
                    .padding(.top, 2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .designCard()
        }
    }

    private func card(title: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(text: title, color: Theme.red)
            Text(text).font(.system(size: 16)).foregroundStyle(Theme.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .designCard()
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
            Image(systemName: symbol).font(.system(size: 28, weight: .semibold)).foregroundStyle(Theme.muted.opacity(0.7))
            Text(text).font(.system(size: 15)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
    }
}

// MARK: - Roster and activity

private struct RosterStrip: View {
    let name: String
    let friends: FriendsList
    let open: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                DesignSectionHeader(title: "\(name)'s roster")
                Text("\(friends.count) name\(friends.count == 1 ? "" : "s")")
                    .font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.muted)
            }
            if friends.friends.isEmpty {
                Text("No one on this roster yet.").font(.system(size: 15)).foregroundStyle(Theme.muted)
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
                    .padding(.horizontal, Design.gutter)
                }
                .padding(.horizontal, -Design.gutter)
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
        ProfilePhoto(name: friend.memberName, path: photo, size: 58)
            .frame(width: 58, height: 58)
            .clipShape(Circle())
            .overlay(Circle().stroke(Theme.line))
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
            Eyebrow(text: "Profile activity")
            HStack {
                figure(visitors.today, "Today")
                figure(visitors.thisWeek, "This week")
                figure(visitors.allTime, "All time")
            }
            if let position = visitors.position {
                Button { open("/top25.html") } label: {
                    HStack {
                        Image(systemName: "trophy.fill")
                        Text("#\(position) on the ROOSTER Top Rosters").font(.system(size: 15, weight: .semibold))
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundStyle(Theme.gold)
                }
                .buttonStyle(.plain)
            }
            Text("Estimated unique visitors.").font(.system(size: 12)).foregroundStyle(Theme.muted)
        }
        .designCard(padding: 18)
    }

    private func figure(_ value: Int?, _ label: String) -> some View {
        VStack(spacing: 3) {
            Text(value.map(Compact.string) ?? "—").font(.roosterDisplay(22, relativeTo: .title2)).foregroundStyle(Theme.ink)
            Text(label).font(.system(size: 13)).foregroundStyle(Theme.muted)
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
    Button(action: action) { ProfileGlassCircle(symbol: "xmark", size: 40) }
        .buttonStyle(.plain)
        .padding(16)
        .accessibilityLabel("Close")
}
