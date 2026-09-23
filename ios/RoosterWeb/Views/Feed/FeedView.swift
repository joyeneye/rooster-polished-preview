import SwiftUI

/// The WYD tab as the world-class concept draws it (design/world-class-concept/home.png):
/// ROOSTER with Search, MONA and the inbox; WYD with the feed picker; your inner circle; then the
/// feed as full-bleed cards, with whoever is live right now after the first post.
struct FeedView: View {
    @EnvironmentObject private var store: ShellStore
    @EnvironmentObject private var session: SessionModel
    @ObservedObject var model: FeedModel
    @StateObject private var topEight: TopEightModel
    @StateObject private var live: LiveNowModel
    @StateObject private var player = HomeSongPlayer()
    @State private var browser: BrowserDestination?
    @State private var commenting: FeedPost?
    @State private var notice: String?
    @State private var editingTopEight = false
    @State private var showingCircle = false
    @State private var activeID: String?
    @State private var tracker = ActiveCardTracker()
    @State private var viewport: CGFloat = 0

    init(model: FeedModel) {
        self.model = model
        _topEight = StateObject(wrappedValue: TopEightModel(api: FeedAPI(base: ShellConfig.baseURL)))
        _live = StateObject(wrappedValue: LiveNowModel(api: FeedAPI(base: ShellConfig.baseURL)))
    }

    var body: some View {
        NavigationStack(path: store.path(for: .wyd)) {
            page
                .background(Theme.background.ignoresSafeArea())
                // Cards scroll up under the status bar; keep the clock on the page colour.
                .overlay(alignment: .top) {
                    Theme.background.opacity(0.94)
                        .frame(height: 0)
                        .background(Theme.background.opacity(0.94).ignoresSafeArea(edges: .top))
                        .allowsHitTesting(false)
                }
                .toolbar(.hidden, for: .navigationBar)
                .overlay(alignment: .top) {
                    if let notice {
                        Notice(text: notice)
                            .padding(.top, 8)
                            .transition(.move(edge: .top).combined(with: .opacity))
                            .task(id: notice) {
                                try? await Task.sleep(for: .seconds(2.6))
                                withAnimation(.snappy) { self.notice = nil }
                            }
                    }
                }
                .navigationDestination(for: AppRoute.self) { route in
                    AppRouteView(route: route, stack: .wyd)
                }
        }
        .sheet(item: $browser) { destination in
            SafariView(url: destination.url).ignoresSafeArea()
        }
        .sheet(item: $commenting) { post in
            CommentSheet(post: post, model: model, sessionEnded: session.revalidate)
                .presentationDetents([.height(260)])
                .presentationCornerRadius(28)
        }
        .sheet(item: $store.creating) { kind in
            CreateSheet(kind: kind, actions: SiteActions(api: FeedAPI(base: store.baseURL))) { message, post in
                if let post { withAnimation(.snappy) { model.prepend(post) } }
                if let message { withAnimation(.snappy) { notice = message } }
            }
        }
        .sheet(isPresented: $editingTopEight) {
            TopEightEditor(model: topEight) { message in
                withAnimation(.snappy) { notice = message }
            }
        }
        .sheet(isPresented: $showingCircle) {
            InnerCircleSheet(model: topEight, live: live, open: open, openRoom: openRoom) {
                // The list closes first; the editor presents once it has gone.
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(450))
                    editingTopEight = true
                }
            }
        }
        .onAppear(perform: model.startIfNeeded)
        .onDisappear { player.stop() }
        .task {
            if topEight.value == nil { await topEight.load() }
            await live.load()
        }
        .onChange(of: player.failure) { _, failure in
            guard let failure else { return }
            withAnimation(.snappy) { notice = failure }
            player.clearFailure()
        }
    }

    private static let top = "home-top"
    private static let space = "home"

    private var page: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 0) {
                    HomeTopBar(unread: store.unread,
                               search: { store.push(.search, in: .wyd) },
                               mona: { store.showingMona = true },
                               inbox: store.openInbox)
                        .id(Self.top)
                    HomeIntro(model: model) { store.switchTo(.rooms) }
                        .padding(.top, 2)
                    InnerCircleRow(model: topEight, live: live, open: open, openRoom: openRoom,
                                   seeAll: { showingCircle = true }, edit: { editingTopEight = true })
                        .padding(.top, 6)
                    feed
                        .padding(.horizontal, Design.gutter)
                        .padding(.top, 12)
                }
                .padding(.bottom, 24)
            }
            .coordinateSpace(.named(Self.space))
            .scrollIndicators(.hidden)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { viewport = $0 }
            .refreshable {
                async let posts: Void = model.load()
                async let circle: Void = topEight.load()
                async let rooms: Void = live.load()
                _ = await (posts, circle, rooms)
            }
            // Re-tapping Home (popToRoot → scrollToTop) or a post you just made: back to the top.
            .onReceive(model.$activeID.dropFirst()) { id in
                guard id != nil else { return }
                withAnimation(.snappy) { proxy.scrollTo(Self.top, anchor: .top) }
            }
            #if DEBUG
            .onAppear {
                if NativeFixtures.enabled, UserDefaults.standard.string(forKey: "RoosterHomeSheet") == "circle" { showingCircle = true }
            }
            // `-RoosterHomeScrollTo post-9004` with fixtures: capture a card further down headless.
            .onChange(of: model.items.count) { _, count in
                guard NativeFixtures.enabled, count > 0,
                      let target = UserDefaults.standard.string(forKey: "RoosterHomeScrollTo") else { return }
                Task { @MainActor in
                    // Twice: the lazy stack only knows the true offset once the rows above are built.
                    for _ in 0..<2 {
                        try? await Task.sleep(for: .milliseconds(700))
                        proxy.scrollTo(target, anchor: .top)
                    }
                }
            }
            #endif
        }
    }

    @ViewBuilder private var feed: some View {
        switch model.status {
        case .loading where model.items.isEmpty:
            ProgressView().controlSize(.large).tint(Theme.red)
                .frame(maxWidth: .infinity).frame(height: 240)
        case .locked(let message):
            FailedLane(message: message) { session.revalidate(); Task { await model.load() } }
        case .failed(let message) where model.items.isEmpty:
            FailedLane(message: message) { Task { await model.load() } }
        default:
            LazyVStack(spacing: HomeLayout.feedSpacing) {
                ForEach(Array(model.items.enumerated()), id: \.element.id) { index, item in
                    FeedCard(item: item, isActive: activeID == item.id, soundOn: $model.soundOn, actions: actions, player: player)
                        .id(item.id)
                        .onGeometryChange(for: CGFloat.self) { $0.frame(in: .named(Self.space)).midY } action: { mid in
                            track(item.id, mid: mid)
                        }
                        .onAppear { model.loadMoreIfNeeded(after: item) }
                        .onDisappear { tracker.forget(item.id) }
                    if index == 0, let room = live.featured {
                        liveNow(room)
                    }
                }
                if model.items.isEmpty, let room = live.featured {
                    liveNow(room)
                }
                CaughtUp(isLoading: model.isLoadingMore, following: model.lane == .following)
                    .frame(height: 120)
            }
        }
    }

    private func liveNow(_ room: LiveRooms.Room) -> some View {
        LiveNowCard(label: "LIVE NOW", title: room.title, hostName: room.hostName, hostPhoto: room.hostPhotoUrl,
                    listening: room.listenerCount ?? room.participantCount) { openRoom(room) }
    }

    /// The card nearest the middle of the screen is the one whose clip plays.
    private func track(_ id: String, mid: CGFloat) {
        guard viewport > 0 else { return }
        if let nearest = tracker.update(id, mid: mid, centre: viewport / 2), nearest != activeID {
            activeID = nearest
        }
    }

    private var actions: FeedActions {
        FeedActions(
            open: open,
            toggle: { action, post in
                Task {
                    do {
                        try await model.toggle(action, on: post)
                    } catch FeedError.locked {
                        session.revalidate()
                    } catch let error as FeedError {
                        UINotificationFeedbackGenerator().notificationOccurred(.warning)
                        withAnimation(.snappy) { notice = error.message }
                    } catch {}
                }
            },
            comment: { commenting = $0 },
            delete: { post in
                Task {
                    if let failure = await model.delete(post, using: SiteActions(api: FeedAPI(base: store.baseURL))) {
                        withAnimation(.snappy) { notice = failure.message }
                    } else {
                        withAnimation(.snappy) { notice = "Your post is deleted." }
                    }
                }
            },
            motionPaused: model.motionPaused,
            toggleMotion: { model.motionPaused.toggle() }
        )
    }

    private func openRoom(_ room: LiveRooms.Room) {
        store.push(.native(.liveRoom(key: room.key)), in: .wyd)
    }

    /// Site links go where a tap on the site would: another tab, a pushed page, or the in-app browser.
    private func open(_ link: String) {
        if let external = store.open(link, from: .wyd) {
            browser = BrowserDestination(url: external)
        }
    }
}

/// Where each card's middle is, kept outside SwiftUI state so scrolling doesn't redraw the feed;
/// only a change of the nearest card does.
private final class ActiveCardTracker {
    private var mids: [String: CGFloat] = [:]

    func update(_ id: String, mid: CGFloat, centre: CGFloat) -> String? {
        mids[id] = mid
        return mids.min { abs($0.value - centre) < abs($1.value - centre) }?.key
    }

    func forget(_ id: String) { mids[id] = nil }
}

/// A brief message when an action didn't go through (the preview refuses writes, for one).
private struct Notice: View {
    let text: String

    var body: some View {
        Label(text, systemImage: "exclamationmark.circle.fill")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .designGlass(radius: 22)
            .shadow(color: .black.opacity(0.35), radius: 12, y: 6)
            .padding(.horizontal, 20)
            .accessibilityAddTraits(.updatesFrequently)
    }
}

private struct FailedLane: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "wifi.exclamationmark").font(.system(size: 34, weight: .semibold)).foregroundStyle(Theme.muted)
            Text(message).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink).multilineTextAlignment(.center)
            Button("Try again", action: retry)
                .buttonStyle(.designPrimary)
                .frame(maxWidth: 200)
        }
        .padding(32)
        .frame(maxWidth: .infinity)
        .designCard(padding: 0)
    }
}

private struct CaughtUp: View {
    let isLoading: Bool
    let following: Bool

    var body: some View {
        VStack(spacing: 6) {
            if isLoading {
                ProgressView().tint(Theme.red)
            } else {
                Image(systemName: "checkmark.circle.fill").font(.system(size: 22)).foregroundStyle(Theme.red)
                Text("You're caught up").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.ink)
                Text(following ? "Add people to your roster to see more here." : "Check back for the next drop.")
                    .font(.system(size: 13)).foregroundStyle(Theme.muted)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// Reply to a post (PATCH action: comment).
private struct CommentSheet: View {
    let post: FeedPost
    @ObservedObject var model: FeedModel
    let sessionEnded: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var sending = false
    @State private var error: FeedError?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Reply to \(post.author.name)").font(.rooster(20)).foregroundStyle(Theme.ink)
                Spacer()
                Text("\(post.counts.comments) replies").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
            }
            TextField("Say something…", text: $text, axis: .vertical)
                .lineLimit(2...4)
                .focused($focused)
                .padding(14)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line))
            if let error {
                Text(error.message).font(.system(size: 13)).foregroundStyle(Theme.red)
            }
            Button {
                sending = true
                Task {
                    do {
                        try await model.comment(text, on: post)
                        dismiss()
                    } catch let failure as FeedError {
                        if case .locked = failure { sessionEnded() }
                        error = failure
                    } catch {}
                    sending = false
                }
            } label: {
                Text(sending ? "Sending…" : "Reply")
            }
            .buttonStyle(DesignPrimaryButtonStyle(height: 48))
            .opacity(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.45 : 1)
            .disabled(sending || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(20)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Theme.background)
        .onAppear { focused = true }
    }
}
