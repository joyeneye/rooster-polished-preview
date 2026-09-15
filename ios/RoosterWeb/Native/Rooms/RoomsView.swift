import SwiftUI

/// The Rooms tab, native: who is live right now (/api/live/rooms). Joining a room and going live
/// are writes (join, sync and signaling are POSTs, roster-live.mts), so they are coming soon.
struct RoomsView: View {
    enum Filter: String, CaseIterable, Identifiable {
        case all, video, audio
        var id: String { rawValue }
        var title: String { self == .all ? "All" : self == .video ? "Video" : "Audio" }
    }

    @EnvironmentObject private var store: ShellStore
    @StateObject private var rooms: Loadable<LiveRooms>
    @State private var filter: Filter = .all
    @State private var notice: String?
    @State private var link: String?

    init(api: FeedAPI) {
        _rooms = StateObject(wrappedValue: Loadable {
            #if DEBUG
            if let fixture = NativeFixtures.rooms() { return fixture }
            #endif
            return try await api.get("/api/live/rooms", as: LiveRooms.self)
        })
    }

    var body: some View {
        NavigationStack(path: store.path(for: .rooms)) {
            LoadableContent(loadable: rooms) { value in
                let shown = value.rooms.filter { filter == .all || ($0.isVideo == (filter == .video)) }
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        header
                        Picker("Show", selection: $filter) {
                            ForEach(Filter.allCases) { Text($0.title).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .padding(.horizontal, 16)

                        HStack {
                            Text(shown.isEmpty ? "Nobody is live" : "On right now")
                                .font(.rooster(22)).foregroundStyle(Theme.ink)
                            if !shown.isEmpty {
                                Text("\(shown.count)").font(.roosterMono(12)).foregroundStyle(.white)
                                    .padding(.horizontal, 8).padding(.vertical, 3)
                                    .background(Theme.red, in: Capsule())
                            }
                            Spacer()
                        }
                        .padding(.horizontal, 20)

                        if shown.isEmpty {
                            Text(filter == .all ? "When someone goes live, their room shows up here." : "No \(filter.title.lowercased()) rooms right now.")
                                .font(.system(size: 15)).foregroundStyle(Theme.muted)
                                .padding(.horizontal, 20)
                        }
                        ForEach(shown) { room in
                            RoomCard(room: room, openHost: { link = "/profile.html?id=\(room.hostId)" }) {
                                store.push(.native(.liveRoom(key: room.key)), in: .rooms)
                            }
                            .padding(.horizontal, 16)
                        }

                        shortcuts.padding(.top, 8)
                    }
                    .padding(.vertical, 12)
                }
                .refreshable { await rooms.load() }
            }
            .nativeScreenChrome("Rooms")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { notice = "Going live is coming soon to the ROOSTER app." } label: {
                        Label("Go live", systemImage: "dot.radiowaves.left.and.right").labelStyle(.titleAndIcon)
                            .font(.system(size: 14, weight: .bold))
                    }
                }
            }
            .notice($notice)
            .opensSiteLinks($link, in: .rooms)
            .navigationDestination(for: AppRoute.self) { route in
                AppRouteView(route: route, stack: .rooms)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("ROOSTER / ROOMS").font(.roosterMono(10)).tracking(1.4).foregroundStyle(Theme.red)
            Text("Good company. Great conversations.").font(.rooster(26)).foregroundStyle(Theme.ink)
        }
        .padding(.horizontal, 20)
    }

    private var shortcuts: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("More ways to connect").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted).padding(.horizontal, 20)
            HStack(spacing: 10) {
                shortcut("Review Room", "star.bubble.fill", "Play a record. Get real feedback.") { link = "/review-room.html" }
                shortcut("Chat Room", "bubble.left.and.bubble.right.fill", "Keep the conversation going.") { link = "/members.html#member-chat" }
            }
            .padding(.horizontal, 16)
        }
    }

    private func shortcut(_ title: String, _ symbol: String, _ subtitle: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: symbol).font(.system(size: 20)).foregroundStyle(Theme.red)
                Text(title).font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.ink)
                Text(subtitle).font(.system(size: 13)).foregroundStyle(Theme.muted).lineLimit(2, reservesSpace: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(PressableStyle())
    }
}

private struct RoomCard: View {
    let room: LiveRooms.Room
    let openHost: () -> Void
    let join: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Button(action: openHost) {
                    MemberAvatar(name: room.hostName, photoPath: room.hostPhotoUrl, size: 50)
                        .overlay(Circle().stroke(Theme.red, lineWidth: 2.5).padding(-3))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(room.hostName)'s profile")
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text("● LIVE").font(.roosterMono(10)).foregroundStyle(Theme.red)
                        Text(room.isVideo ? "VIDEO" : "AUDIO").font(.roosterMono(10)).foregroundStyle(Theme.muted)
                    }
                    Text(room.title).font(.system(size: 17, weight: .bold)).foregroundStyle(Theme.ink).lineLimit(2)
                    Text(room.hostName).font(.system(size: 14)).foregroundStyle(Theme.muted)
                }
                Spacer(minLength: 0)
            }
            if let description = room.description, !description.isEmpty {
                Text(description).font(.system(size: 15)).foregroundStyle(Theme.ink.opacity(0.85)).lineLimit(3)
            }
            HStack {
                Label(counts, systemImage: room.isVideo ? "eye.fill" : "person.2.fill")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
                Spacer()
                Button(action: join) {
                    Text(room.isVideo ? "Watch" : "Join & listen")
                        .font(.system(size: 14, weight: .heavy)).foregroundStyle(.white)
                        .padding(.horizontal, 18).frame(height: 38)
                        .background(Theme.red, in: Capsule())
                }
                .buttonStyle(PressableStyle())
            }
        }
        .padding(16)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var counts: String {
        let people = room.participantCount ?? 0
        if room.isVideo { return "\(people) watching" }
        return "\(people) in the room · \(room.speakerCount ?? 0) on the mic"
    }
}
