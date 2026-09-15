import SwiftUI

/// The WYD tab, native: Following and For You as full-height cards you swipe through.
struct FeedView: View {
    @EnvironmentObject private var store: ShellStore
    @EnvironmentObject private var session: SessionModel
    @ObservedObject var model: FeedModel
    @State private var browser: BrowserDestination?
    @State private var commenting: FeedPost?
    @State private var notice: String?

    var body: some View {
        NavigationStack(path: store.path(for: .wyd)) {
            content
                .background(Theme.background)
                .safeAreaInset(edge: .top, spacing: 0) { LaneBar(model: model) }
                .overlay(alignment: .top) {
                    if let notice {
                        // Just under the lane tabs, over the top of the card.
                        Notice(text: notice)
                            .padding(.top, 62)
                            .transition(.move(edge: .top).combined(with: .opacity))
                            .task(id: notice) {
                                try? await Task.sleep(for: .seconds(2.6))
                                withAnimation(.snappy) { self.notice = nil }
                            }
                    }
                }
                .navigationTitle("WYD")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { store.push(.messages, in: .wyd) } label: {
                            Image(systemName: "tray.fill").font(.system(size: 15, weight: .semibold))
                        }
                        .accessibilityLabel("Inbox")
                    }
                    ToolbarItem(placement: .principal) { Wordmark() }
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        ComposeButton(open: open)
                        Button { store.push(.search, in: .wyd) } label: {
                            Image(systemName: "magnifyingglass").font(.system(size: 16, weight: .semibold))
                        }
                        .accessibilityLabel("Search ROOSTER")
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
        .onAppear(perform: model.startIfNeeded)
    }

    @ViewBuilder private var content: some View {
        switch model.status {
        case .loading where model.items.isEmpty:
            ProgressView().controlSize(.large).tint(Theme.red).frame(maxWidth: .infinity, maxHeight: .infinity)
        case .locked(let message):
            // Signed in but refused: the session is being renewed, or this account can't see it.
            FailedLane(message: message) { session.revalidate(); Task { await model.load() } }
        case .failed(let message) where model.items.isEmpty:
            FailedLane(message: message) { Task { await model.load() } }
        default:
            pager
        }
    }

    private var pager: some View {
        GeometryReader { geometry in
            let cardHeight = max(360, geometry.size.height - 24)
            ScrollView(.vertical) {
                LazyVStack(spacing: 12) {
                    ForEach(model.items) { item in
                        FeedCard(item: item, isActive: model.activeID == item.id, soundOn: $model.soundOn, actions: actions)
                            .frame(height: cardHeight)
                            .id(item.id)
                            .onAppear { model.loadMoreIfNeeded(after: item) }
                    }
                    CaughtUp(isLoading: model.isLoadingMore, following: model.lane == .following)
                        .frame(height: 120)
                }
                .scrollTargetLayout()
                .padding(.horizontal, 12)
            }
            .contentMargins(.vertical, 12, for: .scrollContent)
            // Keep the next card out from under the floating tab bar, where it tints the glass.
            .clipShape(Rectangle())
            .scrollTargetBehavior(.viewAligned(limitBehavior: .always))
            .scrollIndicators(.hidden)
            .scrollPosition(id: $model.activeID, anchor: .top)
            .refreshable { await model.load() }
            .onAppear { if model.activeID == nil { model.activeID = model.items.first?.id } }
            .onChange(of: model.items.first?.id) { _, first in
                if model.activeID == nil || !model.items.contains(where: { $0.id == model.activeID }) { model.activeID = first }
            }
            .onChange(of: model.activeID) { _, _ in
                UISelectionFeedbackGenerator().selectionChanged()
            }
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
            comment: { commenting = $0 }
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

/// Following · For You · Live, the site's feed tabs.
private struct LaneBar: View {
    @ObservedObject var model: FeedModel
    @EnvironmentObject private var store: ShellStore
    @Namespace private var underline

    var body: some View {
        HStack(spacing: 26) {
            ForEach(FeedModel.Lane.allCases) { lane in
                tab(lane.title, selected: model.lane == lane) {
                    withAnimation(.snappy(duration: 0.25)) { model.select(lane) }
                }
            }
            tab("Live", selected: false) { store.switchTo(.rooms) }
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.top, 6)
        .background(Theme.background)
        .overlay(alignment: .bottom) { Color(uiColor: Theme.uiLine).frame(height: 1) }
    }

    private func tab(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 9) {
                Text(title)
                    .font(.system(size: 16, weight: selected ? .bold : .semibold))
                    .foregroundStyle(selected ? Theme.red : Theme.muted)
                ZStack {
                    Capsule().fill(.clear).frame(height: 3)
                    if selected {
                        Capsule().fill(Theme.red).frame(height: 3).matchedGeometryEffect(id: "underline", in: underline)
                    }
                }
            }
            .fixedSize()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Post, Song and Room — the site's quick actions (index.html .slots-quick-compose). Take a Pic
/// opens the site's in-page camera, which has no URL to link to.
private struct ComposeButton: View {
    let open: (String) -> Void

    var body: some View {
        Menu {
            Button { open("/?compose=post") } label: { Label("Post", systemImage: "square.and.pencil") }
            Button { open("/members.html#member-songs-root") } label: { Label("Song", systemImage: "music.note") }
            Button { open("/live.html") } label: { Label("Room", systemImage: "waveform") }
        } label: {
            Image(systemName: "plus").font(.system(size: 17, weight: .bold))
        }
        .accessibilityLabel("Create")
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
