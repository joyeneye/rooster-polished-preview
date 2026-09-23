import PhotosUI
import SwiftUI

/// The profile, laid out as jwhitedidit.net lays it out at phone width (profile-experience.css,
/// profile.css, slots.css): the Open Home banner, the dark ROOSTER PROFILE card, your composer,
/// then the Top 8 "Your circle".

/// The page ground: a soft light from above (profile-experience.css:2).
struct ProfileGround: View {
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        if store.theme == .dark {
            Color(hex: 0x09090B)
        } else {
            RadialGradient(stops: [.init(color: .white, location: 0),
                                   .init(color: Color(hex: 0xF6F1E8), location: 0.48),
                                   .init(color: Color(hex: 0xECE2D6), location: 1)],
                           center: UnitPoint(x: 0.5, y: -0.1), startRadius: 0, endRadius: 900)
        }
    }
}

/// "▶ Open Home ↗ · See the full WYD feed from everyone." (profile-experience.css:32)
struct OpenHomeBanner: View {
    let open: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: open) {
                HStack(spacing: 9) {
                    Image(systemName: "play.fill").font(.system(size: 12, weight: .bold))
                    Text("Open Home").font(.rooster(14))
                    Image(systemName: "arrow.up.right").font(.system(size: 12, weight: .bold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 17).frame(minHeight: 44)
                .background(LinearGradient(colors: [Color(hex: 0xC50A33), Color(hex: 0xED3D35)],
                                           startPoint: .leading, endPoint: .trailing), in: Capsule())
            }
            .buttonStyle(.plain)
            Text("See the full WYD feed from everyone.")
                .font(.rooster(12, weight: .regular)).foregroundStyle(Color(hex: 0x655047))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(Color(hex: 0xFFF7E9), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Color(hex: 0xEAD4BD)))
    }
}

/// Where the online line stands (community.js:8).
enum Presence: Equatable {
    case checking, online, offline, unavailable

    var label: String {
        switch self {
        case .checking: "Checking status…"
        case .online: "● Online Now!"
        case .offline: "○ Offline"
        case .unavailable: "Status unavailable"
        }
    }
}

/// The dark card (profile-experience.css:9-12, 29, 58-60).
struct ProfileIdentityCard: View {
    let profile: MemberProfile
    let isMe: Bool
    let connections: Int?
    let presence: Presence
    let relationship: String
    let open: (String) -> Void
    let connect: () -> Void
    let editPhotoAndStatus: () -> Void
    @EnvironmentObject private var store: ShellStore

    private var membershipLabel: String? {
        guard let m = profile.membership else { return nil }
        if m.foundingMember == true { return "Founding Member" }
        if m.earlyMember == true { return "Early Member" }
        if m.approvedCreator == true { return "Approved Creator" }
        return nil
    }

    private var titleLine: String? {
        profile.titleLines?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? profile.roleLabel
    }

    private var website: URL? {
        profile.websiteUrl.flatMap(URL.init(string:)).flatMap { $0.scheme == "https" ? $0 : nil }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("ROOSTER PROFILE").font(.roosterMono(10, bold: false)).tracking(1.9)
                        .foregroundStyle(Color(hex: 0x62666D))
                    if let membershipLabel {
                        Text(membershipLabel).font(.rooster(8)).tracking(0.96)
                            .foregroundStyle(Color(hex: 0xFF6682))
                            .padding(.horizontal, 7).frame(height: 18)
                            .background(Color(hex: 0xFFF1E4), in: Capsule())
                            .overlay(Capsule().stroke(.white.opacity(0.18)))
                    }
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(connections.map { "\($0)" } ?? "•••").font(.rooster(22)).foregroundStyle(.white)
                        .contentTransition(.numericText())
                    Text("ROOSTER CONNECTIONS").font(.rooster(10, weight: .regular)).tracking(1.9)
                        .foregroundStyle(Color(hex: 0xD8D0CD))
                }
            }

            HStack(alignment: .top, spacing: 14) {
                SiteImage(path: profile.photoUrl ?? "/roster-icon-192.png")
                    .frame(width: 88, height: 88)
                    .background(LinearGradient(colors: [Color(hex: 0x2C2025), Color(hex: 0x090909)],
                                               startPoint: .topLeading, endPoint: .bottomTrailing))
                    .clipShape(Circle())
                    .overlay(Circle().stroke(Color(hex: 0x6F2638), lineWidth: 2))
                    .background(Circle().stroke(Color(hex: 0xE3173F, opacity: 0.08), lineWidth: 10).padding(-5))
                    .shadow(color: .black.opacity(0.35), radius: 15, y: 15)
                    .accessibilityLabel("\(profile.name)'s photo")

                VStack(alignment: .leading, spacing: 0) {
                    Text("MEET").font(.roosterMono(10, bold: false)).tracking(1.9).foregroundStyle(Color(hex: 0xFF496B))
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        // White, as the site intends. Its stylesheet order paints it near-black
                        // on this card (roster-light.css:1079), which only the red streak shows.
                        Text(profile.name.uppercased())
                            .font(.roosterDisplay(36)).tracking(-1.99)
                            .lineSpacing(-4)
                            .foregroundStyle(.white)
                            .minimumScaleFactor(0.6)
                            .fixedSize(horizontal: false, vertical: true)
                        if profile.verified == true || profile.verifiedOwner == true {
                            Image(systemName: "checkmark").font(.system(size: 12, weight: .bold))
                                .foregroundStyle(profile.verifiedOwner == true ? Color(hex: 0x171719) : .white)
                                .frame(width: 23, height: 23)
                                .background(profile.verifiedOwner == true ? Color(hex: 0xC99418) : Color(hex: 0x1683DF), in: Circle())
                                .accessibilityLabel(profile.verifiedOwner == true ? "Official" : "Verified")
                        }
                    }
                    .padding(.top, 7).padding(.bottom, 9)

                    if let titleLine {
                        Text(titleLine.uppercased()).font(.roosterMono(11, bold: false)).tracking(0.66)
                            .foregroundStyle(Color(hex: 0xD9D1CD)).padding(.vertical, 4)
                    }
                    if let location = profile.location?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty {
                        Text("⌖ " + location.replacingOccurrences(of: "\n", with: ", ").uppercased())
                            .font(.roosterMono(11, bold: false)).tracking(0.66)
                            .foregroundStyle(Color(hex: 0xD9D1CD)).padding(.vertical, 4)
                    }
                    Text(presence.label.uppercased())
                        .font(.roosterMono(12)).tracking(1.2)
                        .foregroundStyle(Color(hex: 0xFF5875))
                        .padding(.top, 7)
                        .accessibilityLabel(presence == .online ? "Online now" : presence.label)
                    if isMe {
                        Button(action: editPhotoAndStatus) {
                            HStack(spacing: 8) {
                                Image(systemName: "pencil").font(.system(size: 16, weight: .semibold))
                                Text("Edit photo & status").font(.rooster(13))
                            }
                            .foregroundStyle(Color(hex: 0x361921))
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .background(Color(hex: 0xFFE0A3), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color(hex: 0xFFCE84)))
                            .shadow(color: .black.opacity(0.12), radius: 7, y: 4)
                        }
                        .buttonStyle(.plain)
                        .padding(.top, 12)
                    }
                }
            }
            .padding(.top, 28).padding(.bottom, 24)

            VStack(alignment: .leading, spacing: 18) {
                if let status = profile.status?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty {
                    Text(status.uppercased()).font(.rooster(14)).tracking(1.12).foregroundStyle(.white)
                        .lineSpacing(6)
                        .padding(.top, 12)
                }
                actions
            }
            .padding(.top, 17)
            .overlay(alignment: .top) { Color.white.opacity(0.2).frame(height: 1) }
        }
        .padding(.horizontal, 17).padding(.vertical, 20)
        .frame(maxWidth: .infinity, minHeight: 390, alignment: .top)
        .background { CardTexture() }
        .clipShape(RoundedRectangle(cornerRadius: 25, style: .continuous))
        .shadow(color: Color(hex: 0x180A09, opacity: 0.22), radius: 30, y: 24)
    }

    /// My Link · Add to Roster · Send Message · Share, two to a row (profile-experience.css:12, 29).
    private var actions: some View {
        let columns = [GridItem(.flexible(), spacing: 7), GridItem(.flexible(), spacing: 7)]
        var items: [AnyView] = []
        if let website {
            items.append(AnyView(outline("My Link") { open(website.absoluteString) }))
        }
        if !isMe {
            let label = switch relationship {
            case "accepted": "On your roster"
            case "outgoing": "Requested"
            case "incoming": "Review request"
            default: "Add to Roster"
            }
            items.append(AnyView(pill(label, filled: relationship == "none" || relationship == "") {
                if relationship == "incoming" { open("/members.html#friend-requests") }
                else if relationship == "none" || relationship == "" { connect() }
            }))
        }
        items.append(AnyView(outline("Send Message") { open("/members.html?to=\(profile.id)#member-mail") }))
        let shareURL = store.siteURL("/profile.html?id=\(profile.id)")
        let share = AnyView(
            Group {
                if let shareURL {
                    ShareLink(item: shareURL, subject: Text(profile.name)) { outlineLabel("Share") }.buttonStyle(.plain)
                }
            })
        return VStack(spacing: 10) {
            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(items.indices, id: \.self) { items[$0] }
                if items.count.isMultiple(of: 2) == false { share }
            }
            if items.count.isMultiple(of: 2) { share }
        }
    }

    private func pill(_ title: String, filled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.rooster(11)).foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(filled ? Color(hex: 0xE3173F) : .white.opacity(0.06), in: Capsule())
                .overlay(Capsule().stroke(filled ? Color(hex: 0xE3173F) : .white.opacity(0.24)))
        }
        .buttonStyle(.plain)
    }

    private func outline(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { outlineLabel(title) }.buttonStyle(.plain)
    }

    private func outlineLabel(_ title: String) -> some View {
        Text(title).font(.rooster(11)).foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(.white.opacity(0.06), in: Capsule())
            .overlay(Capsule().stroke(.white.opacity(0.24)))
    }
}

/// The card's black ground with its red ring, diagonal streak, pinstripes and the big circle
/// low on the right (profile-experience.css:9-11).
private struct CardTexture: View {
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                LinearGradient(stops: [.init(color: Color(hex: 0x171416), location: 0),
                                       .init(color: Color(hex: 0x080809), location: 0.62),
                                       .init(color: Color(hex: 0x150609), location: 1)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                Group {
                    Path { p in
                        var x: CGFloat = 59
                        while x < w { p.addRect(CGRect(x: x, y: 0, width: 1, height: h)); x += 60 }
                    }
                    .fill(Color(hex: 0xE3173F, opacity: 0.08))
                    LinearGradient(stops: [.init(color: .clear, location: 0.42),
                                           .init(color: Color(hex: 0xB4102D, opacity: 0.24), location: 0.43),
                                           .init(color: .clear, location: 0.45)],
                                   startPoint: UnitPoint(x: 0.08, y: 0.18), endPoint: UnitPoint(x: 0.92, y: 0.82))
                    Circle().stroke(Color(hex: 0xE3173F, opacity: 0.5), lineWidth: 1.5)
                        .frame(width: 111, height: 111)
                        .position(x: w * 0.85, y: h * 0.28)
                }
                .opacity(0.55)
                Circle().stroke(Color(hex: 0xE3173F, opacity: 0.35), lineWidth: 1)
                    .background(Circle().stroke(Color(hex: 0xE3173F, opacity: 0.025), lineWidth: 52))
                    .frame(width: 230, height: 230)
                    .position(x: w + 70 - 115, y: h + 90 - 115)
            }
        }
    }
}

/// "Share something with your roster…" and Post · Song · Photo · Room, on your own profile.
struct ProfileComposerCard: View {
    let photoPath: String?
    let create: (CreateKind) -> Void
    let room: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Button { create(.post) } label: {
                HStack(spacing: 12) {
                    SiteImage(path: photoPath ?? "/roster-icon-192.png")
                        .frame(width: 40, height: 40).clipShape(Circle())
                    Text("Share something with your roster…").font(.rooster(15, weight: .regular))
                        .foregroundStyle(Theme.muted)
                    Spacer(minLength: 0)
                }
                .padding(10)
                .background(Theme.background, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
            HStack(spacing: 0) {
                chip("Post") { create(.post) }
                chip("Song") { create(.song) }
                chip("Photo") { create(.photo) }
                chip("Room", action: room)
            }
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color(hex: 0xDED4C7)))
    }

    private func chip(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.rooster(14)).foregroundStyle(Theme.ink)
                .frame(maxWidth: .infinity, minHeight: 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// The profile's Top 8: "YOUR CIRCLE", round photos (profile-experience.css:14, 23; slots.css:81).
struct CircleCard: View {
    let topEight: TopEight
    let open: (String) -> Void
    let edit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("YOUR CIRCLE").font(.roosterMono(8)).tracking(1.36).foregroundStyle(Color(hex: 0xFFD66B))
                    Text("TOP 8 ROSTER").font(.rooster(20)).tracking(-0.6).foregroundStyle(.white)
                }
                Spacer(minLength: 0)
                if topEight.editable == true {
                    Button(action: edit) {
                        Text("Edit Top 8").font(.rooster(15)).foregroundStyle(Color(hex: 0x2A1110))
                            .padding(.horizontal, 13).frame(minHeight: 42)
                            .background(Color(hex: 0xFFD66B), in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.bottom, 15)

            if topEight.members.isEmpty {
                Text(topEight.editable == true ? "Choose people with Edit Top 8." : "No Top 8 picks yet.")
                    .font(.roosterMono(13, bold: false)).foregroundStyle(.white)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 16) {
                        ForEach(Array(topEight.members.prefix(8).enumerated()), id: \.element.id) { index, person in
                            Button { open(person.profileUrl ?? "/profile.html?id=\(person.id)") } label: {
                                VStack(spacing: 8) {
                                    SiteImage(path: person.photoUrl ?? "/roster-icon-192.png")
                                        .frame(width: 64, height: 64).clipShape(Circle())
                                        .overlay(Circle().stroke(.white, lineWidth: 2))
                                        .padding(3).background(Color(hex: 0xFFF4D7), in: Circle())
                                        .padding(3).background(Color(hex: 0xFFC342), in: Circle())
                                        .overlay(alignment: .topLeading) {
                                            Text("\(index + 1)").font(.rooster(9)).foregroundStyle(Color(hex: 0x2A1110))
                                                .frame(width: 20, height: 20)
                                                .background(Color(hex: 0xFFD66B), in: Circle())
                                                .overlay(Circle().stroke(.white, lineWidth: 2))
                                                .offset(x: 1, y: -4)
                                        }
                                    Text(person.name).font(.rooster(11)).foregroundStyle(.white).lineLimit(1)
                                        .frame(maxWidth: 80)
                                }
                                .frame(width: 84)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(index + 1). \(person.name)")
                        }
                    }
                    .padding(.horizontal, 14).padding(.top, 3).padding(.bottom, 12)
                }
                .padding(.horizontal, -14)
            }
        }
        .padding(.vertical, 17).padding(.horizontal, 14)
        .background(LinearGradient(stops: [.init(color: Color(hex: 0xA8102B), location: 0),
                                           .init(color: Color(hex: 0xE22C2D), location: 0.55),
                                           .init(color: Color(hex: 0xF27A24), location: 1)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color(hex: 0xFFC342), lineWidth: 2))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: Color(hex: 0xAE1925, opacity: 0.28), radius: 22, y: 18)
    }
}

/// "Edit photo & status" (profile-inline-editor.js): the status is required every time; the
/// photo is optional. The site screens the status, so it can come back held for review.
struct EditPhotoStatusSheet: View {
    let current: MemberProfile
    let actions: SiteActions
    let saved: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var status = ""
    @State private var photo: UIImage?
    @State private var picked: PhotosPickerItem?
    @State private var saving = false
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 16) {
                        Group {
                            if let photo {
                                Image(uiImage: photo).resizable().scaledToFill()
                            } else {
                                SiteImage(path: current.photoUrl ?? "/roster-icon-192.png")
                            }
                        }
                        .frame(width: 72, height: 72).clipShape(Circle())
                        PhotosPicker(selection: $picked, matching: .images) {
                            Text(photo == nil ? "Choose a new photo" : "Choose a different photo")
                        }
                    }
                } header: {
                    Text("Photo")
                }
                Section {
                    TextField("Your status", text: $status, axis: .vertical).lineLimit(1...4)
                    Text("\(status.count)/160").font(.system(size: 12))
                        .foregroundStyle(status.count > 160 ? Theme.red : Theme.muted)
                } header: {
                    Text("Status")
                } footer: {
                    Text("Keep it positive — ROOSTER checks every status before it goes up.")
                }
                if let problem { Section { Text(problem).foregroundStyle(Theme.red) } }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Edit photo & status")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(saving ? "Saving…" : "Save") { save() }.bold()
                        .disabled(saving || status.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || status.count > 160)
                }
            }
            .tint(Theme.red)
            .onAppear { status = current.status ?? "" }
            .onChange(of: picked) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self) { photo = UIImage(data: data) }
                    picked = nil
                }
            }
        }
    }

    private func save() {
        saving = true
        problem = nil
        Task {
            switch await actions.updateProfile(status: status, photo: photo) {
            case .success(let message):
                saved(message)
                dismiss()
            case .failure(let error):
                problem = error.message
            }
            saving = false
        }
    }
}
