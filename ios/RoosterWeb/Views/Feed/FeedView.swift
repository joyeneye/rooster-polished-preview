import SwiftUI

/// The WYD tab, laid out the way jwhitedidit.net lays out its home page at phone width:
/// the ROOSTER bar with Search, "What's happening?", your Top 8 inner circle, the create row,
/// then Following · For You · Live pinned over a stage of full-bleed posts.
struct FeedView: View {
    @EnvironmentObject private var store: ShellStore
    @EnvironmentObject private var session: SessionModel
    @ObservedObject var model: FeedModel
    @StateObject private var topEight: TopEightModel
    @State private var browser: BrowserDestination?
    @State private var commenting: FeedPost?
    @State private var notice: String?
    @State private var editingTopEight = false
    @State private var topHeight: CGFloat = 0
    @State private var barHeight: CGFloat = 120
    @State private var offset: CGFloat = 0
    @State private var activeIndex: Int?

    init(model: FeedModel) {
        self.model = model
        _topEight = StateObject(wrappedValue: TopEightModel(api: FeedAPI(base: ShellConfig.baseURL)))
    }

    var body: some View {
        NavigationStack(path: store.path(for: .wyd)) {
            page
                .background(SiteColor.page)
                .safeAreaInset(edge: .top, spacing: 0) {
                    WYDHeader { store.push(.search, in: .wyd) }
                }
                .toolbar(.hidden, for: .navigationBar)
                .overlay(alignment: .top) {
                    if let notice {
                        Notice(text: notice)
                            .padding(.top, 12)
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
        .onAppear(perform: model.startIfNeeded)
        .task { if topEight.value == nil { await topEight.load() } }
    }

    private var page: some View {
        GeometryReader { geometry in
            let panel = max(360, geometry.size.height - barHeight)
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    VStack(spacing: 0) {
                        VStack(spacing: 0) {
                            Color.clear.frame(height: 0).id("pageTop")
                                .onGeometryChange(for: CGFloat.self) { $0.frame(in: .named("wyd")).minY } action: { minY in
                                    offset = -minY
                                    track(panel: panel)
                                }
                            WYDIntro()
                            InnerCircleCard(model: topEight, open: open) { editingTopEight = true }
                            CreateRow(post: { store.creating = .post },
                                      song: { store.creating = .song },
                                      photo: { store.creating = .photo },
                                      room: { store.switchTo(.rooms) })
                        }
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { topHeight = $0 }

                        LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                            Section {
                                stage(panel: panel)
                            } header: {
                                StageBar(model: model) { store.switchTo(.rooms) }
                                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { barHeight = $0 }
                            }
                        }
                    }
                }
                .coordinateSpace(.named("wyd"))
                .scrollTargetBehavior(StageSnap(start: topHeight, page: panel))
                .scrollIndicators(.hidden)
                .refreshable {
                    await model.load()
                    await topEight.load()
                }
                .onChange(of: model.items.first?.id) { _, first in
                    // A new lane or a fresh post: settle on its first panel if you were in the stage.
                    // Only once the page has measured itself and you are down in the posts —
                    // otherwise the first load would scroll straight past "What's happening?".
                    guard let first, topHeight > 0, offset >= topHeight - 2 else { return }
                    withAnimation(.snappy) { proxy.scrollTo(first, anchor: .bottom) }
                }
            }
        }
    }

    @ViewBuilder private func stage(panel: CGFloat) -> some View {
        switch model.status {
        case .loading where model.items.isEmpty:
            ProgressView().controlSize(.large).tint(Theme.red).frame(maxWidth: .infinity).frame(height: panel)
        case .locked(let message):
            FailedLane(message: message) { session.revalidate(); Task { await model.load() } }.frame(height: panel)
        case .failed(let message) where model.items.isEmpty:
            FailedLane(message: message) { Task { await model.load() } }.frame(height: panel)
        default:
            ForEach(Array(model.items.enumerated()), id: \.element.id) { index, item in
                FeedCard(item: item, isActive: activeIndex == index, soundOn: $model.soundOn, actions: actions)
                    .frame(height: panel)
                    .id(item.id)
                    .onAppear { model.loadMoreIfNeeded(after: item) }
            }
            CaughtUp(isLoading: model.isLoadingMore, following: model.lane == .following)
                .frame(height: 120)
        }
    }

    /// Which post is on the stage, from how far the page has scrolled. The first one only plays
    /// once it has mostly come up under the lanes, as on the site (community-home.js:497-525).
    private func track(panel: CGFloat) {
        guard panel > 1, !model.items.isEmpty else { return }
        let position = (offset - topHeight) / panel
        let index: Int? = position < -0.45 ? nil : min(max(Int(position.rounded()), 0), model.items.count - 1)
        guard index != activeIndex else { return }
        activeIndex = index
        if let index {
            model.activeID = model.items[index].id
            UISelectionFeedbackGenerator().selectionChanged()
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
            motionPaused: model.motionPaused
        )
    }

    /// Site links go where a tap on the site would: another tab, a pushed page, or the in-app browser.
    private func open(_ link: String) {
        if let external = store.open(link, from: .wyd) {
            browser = BrowserDestination(url: external)
        }
    }
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
            .background(Color(hex: 0x241A1C, opacity: 0.94), in: Capsule())
            .shadow(color: .black.opacity(0.2), radius: 12, y: 6)
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
                .font(.system(size: 16, weight: .bold))
                .buttonStyle(.borderedProminent)
                .tint(Theme.red)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .background(Theme.red.opacity(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.4 : 1),
                                in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .disabled(sending || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(20)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Theme.background)
        .onAppear { focused = true }
    }
}
