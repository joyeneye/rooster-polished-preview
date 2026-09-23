import SwiftUI

/// jwhitedidit.net's colours for WYD, light and dark (roster-home.css, slots.css, roster-theme.css).
enum SiteColor {
    static func pair(_ light: UInt32, _ dark: UInt32) -> Color { Color(uiColor: .dynamic(light: light, dark: dark)) }
    static let page = pair(0xF7F2EA, 0x09090B)
    static let header = pair(0xFFFFFF, 0x1F1E21)
    static let headerLine = pair(0xE6E5E1, 0x4C454C)
    static let ink = pair(0x171719, 0xF7F7F8)
    static let introSub = pair(0x5D514A, 0xD2C8C4)
    static let searchFill = pair(0xF6F5F1, 0x202024)
    static let searchLine = pair(0xE6E5E1, 0x3B3B42)
    static let searchHint = pair(0x8B7C7C, 0x85858E)
    static let searchIcon = pair(0x62666D, 0xAAAAB2)
    static let createFill = pair(0xFFFDF9, 0x29272B)
    static let createLine = pair(0xDFD5C8, 0x49434A)
    static let createTitle = pair(0x111113, 0xFFFFFF)
    static let createSub = pair(0x665A52, 0xD2C8CC)
    static let createDivider = pair(0xEEE5DB, 0x49434A)
    static let laneFill = pair(0xF6F5F1, 0x29272B)
    static let laneIdle = pair(0x62666D, 0xD7CFD3)
    static let laneOn = pair(0xCE0633, 0xE3173F)
    static let slotsRed = Color(hex: 0xED1739)
}

// MARK: - Header

/// The sticky bar: the R mark and ROOSTER with its orange O's, then Search (roster-home.css:21-77).
struct WYDHeader: View {
    let search: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 7) {
                RoosterMark(size: 30)
                (Text("R") + Text("OO").foregroundColor(Color(hex: 0xFF7A3D)) + Text("STER"))
                    .font(.rooster(17)).tracking(-0.765)
                    .foregroundStyle(SiteColor.ink)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("ROOSTER")

            Button(action: search) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.system(size: 15, weight: .medium))
                        .foregroundStyle(SiteColor.searchIcon)
                    Text("Search").font(.rooster(16, weight: .regular)).foregroundStyle(SiteColor.searchHint)
                    Spacer(minLength: 0)
                }
                .padding(.leading, 12).padding(.trailing, 18)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(SiteColor.searchFill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(SiteColor.searchLine))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Search ROOSTER")
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .frame(minHeight: 61)
        .background(SiteColor.header)
        .overlay(alignment: .bottom) { SiteColor.headerLine.frame(height: 1) }
    }
}

// MARK: - Intro

struct WYDIntro: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("WYD FEED").font(.roosterMono(10)).tracking(2).foregroundStyle(SiteColor.slotsRed)
            Text("What’s happening?")
                .font(.rooster(25)).tracking(-1.375)
                .foregroundStyle(SiteColor.ink)
                .padding(.top, 1)
            Text("What your people are doing now.")
                .font(.rooster(13, weight: .regular))
                .foregroundStyle(SiteColor.introSub)
                .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // Measured against jwhitedidit.net at 402pt: the eyebrow sits 36pt under the bar.
        .padding(.horizontal, 20).padding(.top, 31).padding(.bottom, 9)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Top 8 (your inner circle)

@MainActor
final class TopEightModel: ObservableObject, Identifiable {
    @Published private(set) var value: TopEight?
    @Published private(set) var loading = false
    @Published private(set) var failure: String?
    let actions: SiteActions

    init(api: FeedAPI) { actions = SiteActions(api: api) }

    func load() async {
        #if DEBUG
        if let fixture = NativeFixtures.myTopEight() { value = fixture; return }
        #endif
        loading = true
        defer { loading = false }
        do {
            value = try await actions.topEight()
            failure = nil
        } catch FeedError.locked {
            failure = "Log in to see your Top 8 Roster."
        } catch {
            failure = value == nil ? "Your Top 8 didn't load." : nil
        }
    }

    func save(_ order: [String]) async -> FeedError? {
        switch await actions.saveTopEight(order) {
        case .success(let saved):
            value = saved
            return nil
        case .failure(let error):
            return error
        }
    }

    /// Under the row: "Community picks" until you arrange it yourself (top-eight-roster.js).
    var status: String? {
        if loading && value == nil { return "Opening your Top 8…" }
        if let failure { return failure }
        guard let value else { return nil }
        if value.members.isEmpty {
            return value.editable == true ? "Choose people with Edit Top 8." : "No Top 8 picks yet."
        }
        return value.mode == "community" ? "Community picks · Make it yours with Edit Top 8." : nil
    }
}

/// The red card with the gold ring (slots.css:22-37, 99; roster-home.css:10-13).
struct InnerCircleCard: View {
    @ObservedObject var model: TopEightModel
    let open: (String) -> Void
    let edit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("YOUR INNER CIRCLE").font(.roosterMono(9)).tracking(1.53).foregroundStyle(Color(hex: 0xFFD66B))
                    Text("TOP 8 ROSTER").font(.rooster(15, weight: .semibold)).tracking(0.6).foregroundStyle(.white)
                }
                Spacer(minLength: 8)
                if model.value?.editable == true {
                    Button(action: edit) {
                        Text("Edit Top 8").font(.rooster(15)).foregroundStyle(Color(hex: 0x2A1110))
                            .padding(.horizontal, 13).frame(minHeight: 36)
                            .background(Color(hex: 0xFFD66B), in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.bottom, 8)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: -4) {
                    ForEach(Array((model.value?.members ?? []).prefix(8).enumerated()), id: \.element.id) { index, person in
                        Button { open(person.profileUrl ?? "/profile.html?id=\(person.id)") } label: {
                            InnerCircleTile(rank: index + 1, person: person)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(index + 1). \(person.name)")
                    }
                }
                .padding(.top, 9).padding(.bottom, 8).padding(.leading, 1).padding(.trailing, 10)
            }
            .scrollTargetBehavior(.viewAligned)
            .padding(.trailing, -10)

            if let status = model.status {
                Text(status).font(.roosterMono(13, bold: false)).foregroundStyle(.white)
                    .padding(.vertical, 8)
            }
        }
        .padding(.vertical, 12).padding(.horizontal, 10)
        .background(
            LinearGradient(stops: [.init(color: Color(hex: 0xA8102B), location: 0),
                                   .init(color: Color(hex: 0xDF302C), location: 0.56),
                                   .init(color: Color(hex: 0xF27A24), location: 1)],
                           startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Color(hex: 0xFFC342), lineWidth: 2))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .shadow(color: Color(hex: 0xAE1925, opacity: 0.28), radius: 22, y: 18)
        .padding(.horizontal, 10).padding(.top, 6).padding(.bottom, 12)
    }
}

/// One person: a rounded-square photo in a cream-then-gold ring, their rank, their name.
private struct InnerCircleTile: View {
    let rank: Int
    let person: TopEight.Card

    var body: some View {
        VStack(spacing: 6) {
            SiteImage(path: person.photoUrl ?? "/roster-icon-192.png")
                .frame(width: 54, height: 54)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(.white, lineWidth: 2))
                .padding(3).background(Color(hex: 0xFFF4D7), in: RoundedRectangle(cornerRadius: 21, style: .continuous))
                .padding(3).background(Color(hex: 0xFFC342), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                .overlay(alignment: .topLeading) {
                    Text("\(rank)").font(.rooster(9)).foregroundStyle(Color(hex: 0x2A1110))
                        .frame(width: 20, height: 20)
                        .background(Color(hex: 0xFFD66B), in: Circle())
                        .overlay(Circle().stroke(.white, lineWidth: 2))
                        .offset(x: 4, y: -2)
                }
            Text(person.name).font(.rooster(10)).foregroundStyle(.white).lineLimit(1)
                .frame(maxWidth: 72)
        }
        .frame(width: 76)
    }
}

// MARK: - Create row

/// Post · Song · Take a Pic · Room (slots.css:19, 38-40). Take a Pic is always the red one.
struct CreateRow: View {
    let post: () -> Void
    let song: () -> Void
    let photo: () -> Void
    let room: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            item("Post", "Share an update", action: post)
            divider
            item("Song", "Add music", action: song)
            divider
            Button(action: photo) {
                VStack(spacing: 2) {
                    Text("Take a Pic").font(.rooster(13))
                    Text("Open camera").font(.rooster(11, weight: .regular))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(SiteColor.slotsRed, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .shadow(color: Color(hex: 0xCE0633, opacity: 0.2), radius: 9, y: 7)
            }
            .buttonStyle(.plain)
            item("Room", "Start or join", action: room)
        }
        .padding(5)
        .background(SiteColor.createFill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(SiteColor.createLine))
        .shadow(color: Color(hex: 0x2F1810, opacity: 0.06), radius: 16, y: 10)
        .padding(.horizontal, 10).padding(.bottom, 12)
    }

    private var divider: some View { SiteColor.createDivider.frame(width: 1, height: 38) }

    private func item(_ title: String, _ subtitle: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Text(title).font(.rooster(13)).foregroundStyle(SiteColor.createTitle)
                Text(subtitle).font(.rooster(11, weight: .regular)).foregroundStyle(SiteColor.createSub)
            }
            .frame(maxWidth: .infinity, minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Lanes and stage controls (pinned together)

/// Following · For You · Live as big pills (roster-home.css:1205-1236), then the cream strip with
/// Pause motion and the sound switch (slots.css:105-106).
struct StageBar: View {
    @ObservedObject var model: FeedModel
    let live: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 2) {
                ForEach(FeedModel.Lane.allCases) { lane in
                    pill(lane.title, selected: model.lane == lane) {
                        withAnimation(.snappy(duration: 0.25)) { model.select(lane) }
                    }
                }
                pill("Live", selected: false, action: live)
            }
            .padding(4)
            .background(SiteColor.laneFill, in: Capsule())
            // The site's margin plus its page-coloured halo (roster-home.css:1205, :271).
            .padding(.horizontal, 10).padding(.top, 3).padding(.bottom, 13)
            .background(SiteColor.page)

            HStack(spacing: 8) {
                Text("People · Music · Sports").font(.rooster(10)).foregroundStyle(Color(hex: 0x57473F))
                Spacer(minLength: 4)
                Button {
                    model.motionPaused.toggle()
                } label: {
                    Text(model.motionPaused ? "Play motion" : "Pause motion")
                        .font(.rooster(12)).foregroundStyle(Color(hex: 0x4C3028))
                        .padding(.horizontal, 12).frame(minHeight: 42)
                        .background(.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color(hex: 0xDFCEBF)))
                }
                .buttonStyle(.plain)
                Button {
                    model.soundOn.toggle()
                } label: {
                    Text(model.soundOn ? "Sound is on" : "Turn sound on")
                        .font(.rooster(12, weight: .medium)).foregroundStyle(.white)
                        .padding(.horizontal, 14).frame(minHeight: 44)
                        .background(Color(hex: 0x0C0C0E, opacity: 0.58), in: Capsule())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Color(hex: 0xFFFAF3))
            .overlay(alignment: .top) { Color(hex: 0xEADCCF).frame(height: 1) }
            .overlay(alignment: .bottom) { Color(hex: 0xEADCCF).frame(height: 1) }
        }
    }

    private func pill(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.rooster(13, weight: .semibold)).tracking(-0.13)
                .foregroundStyle(selected ? .white : SiteColor.laneIdle)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(selected ? SiteColor.laneOn : .clear, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: - Snapping

/// The top of the page scrolls freely; once you reach the posts, each one settles under the
/// pinned lanes, one per flick — the site's stage column, without a scroll inside a scroll.
struct StageSnap: ScrollTargetBehavior {
    var start: CGFloat
    var page: CGFloat

    func updateTarget(_ target: inout ScrollTarget, context: TargetContext) {
        // Until the page has measured itself there is nothing to snap to.
        guard page > 1, start > 1 else { return }
        let proposed = target.rect.minY
        let origin = context.originalTarget.rect.minY
        if proposed < start - 1 {
            // Above the posts the page rests wherever you leave it — except a short pull up
            // from inside the stage, which settles back on the first post rather than
            // stranding it half under the lanes.
            if origin >= start - 1 && proposed > start - page * 0.5 { target.rect.origin.y = start }
            return
        }
        let from = max(((origin - start) / page).rounded(), 0)
        let index = min(max(((proposed - start) / page).rounded(), from - 1, 0), from + 1)
        target.rect.origin.y = start + index * page
    }
}

struct ScrollOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

struct HeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}
