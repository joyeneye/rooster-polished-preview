import SwiftUI
import WebKit

/// /api/access/state (roster-access.mts:501-533).
struct AccessState: Decodable {
    let signedIn: Bool
    let approved: Bool
    let status: String?
    let isOwner: Bool?
    let memberId: String?
    let name: String?
    let message: String?
}

/// The Account screen: who you are, and the way into everything that belongs to you.
struct AccountView: View {
    let stack: ShellTab
    @StateObject private var account: Loadable<(AccessState, MemberProfile?)>
    @EnvironmentObject private var session: SessionModel
    @State private var link: String?
    @State private var confirmingSignOut = false

    init(stack: ShellTab, api: FeedAPI) {
        self.stack = stack
        _account = StateObject(wrappedValue: Loadable {
            async let access = api.get("/api/access/state", as: AccessState.self)
            async let me = try? api.get("/api/profile/me", as: ProfileResponse.self)
            return (try await access, await me?.profile)
        })
    }

    var body: some View {
        LoadableContent(loadable: account) { value in
            let (access, profile) = value
            List {
                Section {
                    HStack(spacing: 14) {
                        MemberAvatar(name: profile?.name ?? access.name ?? "You", photoPath: profile?.photoUrl, size: 62)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(profile?.name ?? access.name ?? "You").font(.rooster(22)).foregroundStyle(Theme.ink)
                            if let label = profile?.membership?.levelLabel ?? (access.approved ? "Approved member" : access.status?.capitalized) {
                                Text(label).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.red)
                            }
                            if let since = profile?.membership?.memberSince, let date = FeedDate.parse(since) {
                                Text("On the roster since \(date.formatted(.dateTime.month(.abbreviated).year()))")
                                    .font(.system(size: 12)).foregroundStyle(Theme.muted)
                            }
                        }
                        Spacer()
                    }
                    .padding(.vertical, 6)
                    .listRowBackground(Theme.surface)
                }

                Section("Your page") {
                    row("Your profile", "person.crop.circle") { link = "/my-profile.html" }
                    row("Edit profile & photo", "pencil") { link = "/members.html#member-profile-panel" }
                    row("My music", "music.note") { link = "/my-profile.html?view=songs" }
                    row("My photos", "photo.on.rectangle") { link = "/my-profile.html?view=photos" }
                }

                Section("Your people") {
                    row("Messages", "tray.fill") { link = "/members.html#member-mail" }
                    row("Roster requests", "person.2.badge.plus") { link = "/members.html#friend-requests" }
                    row("Chat Room", "bubble.left.and.bubble.right.fill") { link = "/members.html#member-chat" }
                }

                Section("Your work") {
                    row("ROOSTER Manager", "briefcase.fill") { link = "/rcm.html" }
                    row("Booking", "calendar") { link = "/booking" }
                    row("Opportunities", "sparkles") { link = "/opportunities.html" }
                    if access.isOwner == true {
                        row("Invites & approvals", "key.fill") { link = "/members.html#roster-access-admin" }
                    }
                }

                Section {
                    Button(role: .destructive) { confirmingSignOut = true } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right").foregroundStyle(Theme.red)
                    }
                    .listRowBackground(Theme.surface)
                } footer: {
                    Text("ROOSTER is invite only. Your account works on jwhitedidit.net too.")
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .refreshable { await account.load() }
            .confirmationDialog("Sign out of ROOSTER?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { Task { await session.signOut() } }
            }
        }
        .nativeScreenChrome("Account")
        .opensSiteLinks($link, in: stack)
    }

    private func row(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: symbol).font(.system(size: 15)).foregroundStyle(Theme.red).frame(width: 26)
                Text(title).foregroundStyle(Theme.ink)
                Spacer()
                Image(systemName: "chevron.forward").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted.opacity(0.7))
            }
        }
        .buttonStyle(.plain)
        .listRowBackground(Theme.surface)
    }
}

// MARK: - ORBIT Radio

/// The eight stations from radio.js:2-67. Playback is Live365's own player.
struct RadioStation: Identifiable, Hashable {
    let key: String
    let station: String
    let format: String
    let name: String
    let title: String
    let description: String
    var id: String { key }

    static let all: [RadioStation] = [
        .init(key: "all", station: "a41301", format: "THE MIX", name: "ROOSTER Radio", title: "The Mix",
              description: "Hip-hop, R&B, pop and the rest of the day's rotation."),
        .init(key: "hiphop", station: "a41306", format: "HIP-HOP", name: "Wire 2 Wire", title: "Wire 2 Wire",
              description: "New hip-hop and the records people are still playing."),
        .init(key: "pop", station: "a67989", format: "POP", name: "Poppin Top 40", title: "Poppin Top 40",
              description: "Top 40 and the hooks everybody knows."),
        .init(key: "sports", station: "a83286", format: "SPORTS TALK", name: "Sports Rap Network", title: "Sports Rap Network",
              description: "Sports talk with the music that goes with it."),
        .init(key: "throwbacks", station: "a30553", format: "THROWBACKS", name: "That Throwback Channel", title: "That Throwback Channel",
              description: "The ones you grew up on."),
        .init(key: "gospel", station: "a45349", format: "GOSPEL", name: "Gospel 365", title: "Gospel 365",
              description: "Gospel and praise, all day."),
        .init(key: "jazz", station: "a74112", format: "JAZZ", name: "The Jazz Station", title: "The Jazz Station",
              description: "Standards, soul jazz and late-night horns."),
        .init(key: "country", station: "a01458", format: "COUNTRY", name: "Country Vibe Radio", title: "Country Vibe Radio",
              description: "Country with a little something extra."),
    ]
}

struct RadioView: View {
    let stack: ShellTab
    @State private var playing: RadioStation?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Circle().fill(Theme.red).frame(width: 8, height: 8)
                        Text("LIVE 24/7").font(.roosterMono(10)).tracking(1.4).foregroundStyle(Theme.red)
                    }
                    Text("ORBIT").font(.rooster(40)).foregroundStyle(Theme.ink)
                    Text("ROOSTER live radio. Eight stations, always on.").font(.system(size: 16)).foregroundStyle(Theme.muted)
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)

                Text("CHOOSE A STATION").font(.roosterMono(10)).tracking(1.4).foregroundStyle(Theme.muted).padding(.horizontal, 20)

                LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                    ForEach(RadioStation.all) { station in
                        Button { playing = station } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(station.format).font(.roosterMono(9)).tracking(1).foregroundStyle(Theme.red)
                                Text(station.title).font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.ink)
                                    .lineLimit(2, reservesSpace: true)
                                Text(station.description).font(.system(size: 12)).foregroundStyle(Theme.muted)
                                    .lineLimit(2, reservesSpace: true)
                                Label("Play", systemImage: "play.fill")
                                    .font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                                    .padding(.horizontal, 12).frame(height: 30)
                                    .background(Theme.red, in: Capsule())
                                    .padding(.top, 2)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Color(uiColor: Theme.uiLine)))
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
                .padding(.horizontal, 16)

                Text("Stations are provided by Live365. Playback opens their player.")
                    .font(.system(size: 12)).foregroundStyle(Theme.muted).padding(.horizontal, 20).padding(.bottom, 20)
            }
        }
        .nativeScreenChrome("ORBIT Radio")
        .sheet(item: $playing) { station in
            RadioPlayerSheet(station: station)
                .presentationDetents([.height(430)])
                .presentationCornerRadius(28)
        }
    }
}

private struct RadioPlayerSheet: View {
    let station: RadioStation
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(station.format).font(.roosterMono(10)).tracking(1.2).foregroundStyle(Theme.red)
                    Text(station.title).font(.rooster(22)).foregroundStyle(Theme.ink)
                }
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.ink)
                        .frame(width: 34, height: 34).background(Theme.surface, in: Circle())
                }
                .accessibilityLabel("Close")
            }
            PlainWebView(embedding: "https://live365.com/embed/player.html?station=\(station.station)&s=md&m=dark")
                .frame(height: 300)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            Text(station.description).font(.system(size: 13)).foregroundStyle(Theme.muted)
        }
        .padding(20)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Theme.background)
    }
}

/// A web view with none of the app's site scripts: for third-party embeds like the radio player.
/// The embed is wrapped in a page of our own so it fills the sheet instead of sitting at its own size.
struct PlainWebView: UIViewRepresentable {
    let embedding: String

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.isScrollEnabled = false
        let page = """
        <!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>html,body{margin:0;height:100%;background:#000}iframe{display:block;border:0;width:100%;height:100%}</style>
        <iframe src="\(embedding)" allow="autoplay" title="ROOSTER radio player"></iframe>
        """
        view.loadHTMLString(page, baseURL: URL(string: "https://live365.com/"))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}
}
