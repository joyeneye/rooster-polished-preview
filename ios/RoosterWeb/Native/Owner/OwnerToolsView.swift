import SwiftUI

// MARK: - Invitations and approvals

/// POST /api/access/admin {action:"overview"} (roster-access.mts:441-463). Even the read is a POST.
struct AccessOverview: Decodable {
    struct Invitation: Decodable, Hashable, Identifiable {
        let id: Int
        let code: String
        let note: String?
        let uses: Int
        let maxUses: Int
        let expiresAt: String?
        let revokedAt: String?
        let createdAt: String?
        let usable: Bool
    }
    struct Request: Decodable, Hashable, Identifiable {
        let id: Int
        let name: String?
        let email: String?
        let about: String?
        let status: String
        let memberId: String?
        let inviteCode: String?
        let createdAt: String?
    }
    struct Member: Decodable, Hashable, Identifiable {
        let memberId: String
        let name: String
        let status: String
        let grandfathered: Bool?
        let inviteCode: String?
        let createdAt: String?
        var id: String { memberId }
    }
    let invitations: [Invitation]
    let requests: [Request]
    let members: [Member]
    let counts: [String: Int]
}

@MainActor
final class AccessAdminModel: ObservableObject {
    @Published private(set) var overview: AccessOverview?
    @Published private(set) var failure: FeedError?
    @Published var busy = false
    private let api: FeedAPI

    init(api: FeedAPI) { self.api = api }

    func load() async { await send(["action": "overview"]) }

    func act(_ body: [String: Any]) async {
        busy = true
        defer { busy = false }
        await send(body)
    }

    private func send(_ body: [String: Any]) async {
        #if DEBUG
        if let fixture = NativeFixtures.accessOverview() {
            overview = fixture
            return
        }
        #endif
        do {
            overview = try await api.post("/api/access/admin", body: body, as: AccessOverview.self)
            failure = nil
        } catch let error as FeedError {
            failure = error
        } catch {
            failure = .failed("ROOSTER could not connect.")
        }
    }
}

/// Invitations and approvals, the owner's front door (members.html:233-249).
struct ApprovalsView: View {
    let stack: ShellTab
    @StateObject private var model: AccessAdminModel
    @State private var makingInvite = false
    @State private var note = ""
    @State private var uses = 1
    @State private var notice: String?
    @State private var link: String?

    init(stack: ShellTab, api: FeedAPI) {
        self.stack = stack
        _model = StateObject(wrappedValue: AccessAdminModel(api: api))
    }

    var body: some View {
        List {
            if let failure = model.failure, model.overview == nil {
                ErrorState(message: failure.message) { Task { await model.load() } }.listRowBackground(Color.clear)
            }
            if let overview = model.overview {
                Section {
                    HStack {
                        count("\(overview.counts["approved"] ?? 0)", "Approved")
                        count("\(overview.counts["pending"] ?? 0)", "Pending")
                        count("\(overview.counts["waiting_requests"] ?? 0)", "Waiting")
                        count("\(overview.counts["usable_invitations"] ?? 0)", "Codes")
                    }
                    .listRowBackground(Theme.surface)
                }

                let waiting = overview.requests.filter { $0.status == "waiting" }
                Section("Waiting on you\(waiting.isEmpty ? "" : " (\(waiting.count))")") {
                    if waiting.isEmpty {
                        Text("Nobody is waiting.").font(.system(size: 15)).foregroundStyle(Theme.muted)
                    }
                    ForEach(waiting) { request in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(request.name?.nilIfEmpty ?? "Someone").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                            if let email = request.email?.nilIfEmpty {
                                Text(email).font(.system(size: 13)).foregroundStyle(Theme.muted)
                            }
                            if let about = request.about?.nilIfEmpty {
                                Text(about).font(.system(size: 14)).foregroundStyle(Theme.ink.opacity(0.85))
                            }
                            HStack(spacing: 10) {
                                Button("Approve") {
                                    Task {
                                        await model.act(["action": "approve_request", "request_id": request.id])
                                        notice = "Approved. Their invite code is ready."
                                    }
                                }
                                .buttonStyle(.borderedProminent).tint(Theme.red)
                                Button("Decline") {
                                    Task { await model.act(["action": "decline_request", "request_id": request.id]) }
                                }
                                .buttonStyle(.bordered).tint(Theme.muted)
                            }
                            .font(.system(size: 14, weight: .bold))
                            .disabled(model.busy)
                        }
                        .padding(.vertical, 4)
                    }
                }

                Section("Invite codes") {
                    Button { makingInvite = true } label: {
                        Label("Make an invite code", systemImage: "plus.circle.fill").foregroundStyle(Theme.red)
                    }
                    ForEach(overview.invitations.prefix(30)) { invitation in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(invitation.code).font(.roosterMono(14)).foregroundStyle(Theme.ink)
                                Text("\(invitation.uses) of \(invitation.maxUses) used\(invitation.note?.nilIfEmpty.map { " · \($0)" } ?? "")")
                                    .font(.system(size: 12)).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            if invitation.usable {
                                Button("Copy") { UIPasteboard.general.string = invitation.code; notice = "Code copied." }
                                    .font(.system(size: 13, weight: .bold)).tint(Theme.red)
                                Button("Withdraw") {
                                    Task { await model.act(["action": "revoke_invitation", "invitation_id": invitation.id]) }
                                }
                                .font(.system(size: 13)).tint(Theme.muted)
                            } else {
                                Text(invitation.revokedAt != nil ? "Withdrawn" : "Used up")
                                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.muted)
                            }
                        }
                        .buttonStyle(.borderless)
                    }
                }

                Section("Members") {
                    ForEach(overview.members.prefix(100)) { member in
                        HStack {
                            Button { link = "/profile.html?id=\(member.memberId)" } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(member.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                                    Text(member.status.capitalized).font(.system(size: 12))
                                        .foregroundStyle(member.status == "approved" ? Color(hex: 0x2F7A45) : member.status == "declined" ? Theme.red : Theme.muted)
                                }
                            }
                            .buttonStyle(.plain)
                            Spacer()
                            Menu {
                                ForEach(["approved", "pending", "declined"], id: \.self) { status in
                                    Button(status.capitalized) {
                                        Task { await model.act(["action": "set_member_access", "member_id": member.memberId, "status": status]) }
                                    }
                                }
                            } label: {
                                Image(systemName: "ellipsis.circle").foregroundStyle(Theme.red)
                            }
                        }
                    }
                }
            } else if model.failure == nil {
                Section { LoadingRows(count: 4).listRowBackground(Theme.surface) }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable { await model.load() }
        .nativeScreenChrome("Invites & approvals")
        .notice($notice)
        .opensSiteLinks($link, in: stack)
        .task { if model.overview == nil { await model.load() } }
        .sheet(isPresented: $makingInvite) {
            NavigationStack {
                Form {
                    Section("What it's for") {
                        TextField("Note (optional)", text: $note)
                    }
                    Section("How many people can use it") {
                        Stepper("\(uses) \(uses == 1 ? "person" : "people")", value: $uses, in: 1...50)
                    }
                    Section {
                        Text("Codes last 30 days.").font(.system(size: 13)).foregroundStyle(Theme.muted)
                    }
                }
                .navigationTitle("New invite code")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { Button("Cancel") { makingInvite = false } }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Make code") {
                            let body: [String: Any] = ["action": "create_invitation", "note": note, "max_uses": uses]
                            makingInvite = false
                            note = ""
                            uses = 1
                            Task {
                                await model.act(body)
                                notice = "Code made."
                            }
                        }
                        .bold()
                    }
                }
            }
            .presentationDetents([.medium])
        }
    }

    private func count(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.rooster(20)).foregroundStyle(Theme.ink)
            Text(label).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Verification

/// /api/verification (member-verification.mts:33-95).
struct VerificationList: Decodable {
    struct Member: Decodable, Hashable, Identifiable {
        let id: String
        let name: String
        let verified: Bool
        let canVerify: Bool
    }
    let members: [Member]
    let canManageTeam: Bool?
}

struct VerificationView: View {
    let stack: ShellTab
    @StateObject private var list: Loadable<VerificationList>
    @State private var search = ""
    @State private var notice: String?
    @State private var busy = false
    private let api: FeedAPI

    init(stack: ShellTab, api: FeedAPI) {
        self.stack = stack
        self.api = api
        _list = StateObject(wrappedValue: Loadable { try await api.get("/api/verification", as: VerificationList.self) })
    }

    var body: some View {
        LoadableContent(loadable: list) { value in
            let members = value.members.filter {
                search.isEmpty || $0.name.localizedCaseInsensitiveContains(search)
            }
            List {
                Section {
                    Text("A verified check is for people the ROOSTER can vouch for. You can't change your own.")
                        .font(.system(size: 13)).foregroundStyle(Theme.muted)
                }
                Section("The roster") {
                    ForEach(members) { member in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 5) {
                                    Text(member.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                                    if member.verified {
                                        Image(systemName: "checkmark.seal.fill").font(.system(size: 12)).foregroundStyle(Theme.red)
                                    }
                                }
                                if member.canVerify {
                                    Text("Can verify others").font(.system(size: 12)).foregroundStyle(Theme.muted)
                                }
                            }
                            Spacer()
                            Menu {
                                Button(member.verified ? "Remove verified check" : "Give verified check") {
                                    act(member: member.id, action: member.verified ? "unverify" : "verify")
                                }
                                if value.canManageTeam == true {
                                    Button(member.canVerify ? "Stop them verifying" : "Let them verify the roster") {
                                        act(member: member.id, action: member.canVerify ? "revoke_team" : "grant_team")
                                    }
                                }
                            } label: {
                                Image(systemName: "ellipsis.circle").foregroundStyle(Theme.red)
                            }
                            .disabled(busy)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .searchable(text: $search, prompt: "Find someone")
            .refreshable { await list.load() }
        }
        .nativeScreenChrome("Verification")
        .notice($notice)
    }

    private func act(member: String, action: String) {
        busy = true
        Task {
            defer { busy = false }
            struct Result: Decodable {}
            do {
                _ = try await api.post("/api/verification/update", body: ["member_id": member, "action": action], as: Result.self)
                await list.load()
                notice = "Done."
            } catch let error as FeedError {
                notice = error.message
            } catch {}
        }
    }
}

// MARK: - Announcements

/// GET /api/founder/announcements (founder-announcements.mts:20-35).
struct FounderAnnouncements: Decodable {
    struct Choice: Decodable, Hashable, Identifiable {
        let value: String
        let label: String
        var id: String { value }
    }
    struct Sent: Decodable, Hashable, Identifiable {
        let id: Int
        let subject: String
        let audienceLabel: String?
        let recipientCount: Int?
        let readCount: Int?
        let sentAt: String?
    }
    let canSend: Bool?
    let membershipLive: Bool?
    let audiences: [Choice]
    let counts: [String: Int]?
    let history: [Sent]
}

struct AnnouncementPreview: Decodable {
    let subject: String
    let body: String
    let audienceLabel: String?
    let recipientCount: Int
    let membershipLive: Bool?
}

/// What the founder has sent, and sending another one. Sending really reaches members, so it
/// asks first and says how many people it will go to.
struct AnnouncementsView: View {
    let stack: ShellTab
    @StateObject private var loadable: Loadable<FounderAnnouncements>
    @State private var composing = false
    @State private var subject = ""
    @State private var message = ""
    @State private var audience = "everyone"
    @State private var surfaces: Set<String> = ["message", "notification"]
    @State private var preview: AnnouncementPreview?
    @State private var confirming = false
    @State private var notice: String?
    @State private var working = false
    private let api: FeedAPI

    init(stack: ShellTab, api: FeedAPI) {
        self.stack = stack
        self.api = api
        _loadable = StateObject(wrappedValue: Loadable { try await api.get("/api/founder/announcements", as: FounderAnnouncements.self) })
    }

    var body: some View {
        LoadableContent(loadable: loadable) { value in
            List {
                if value.membershipLive != true {
                    Section {
                        Label("Turn the membership system on before sending an announcement.", systemImage: "exclamationmark.triangle.fill")
                            .font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.red)
                    }
                }
                Section {
                    Button { composing = true } label: {
                        Label("Write an announcement", systemImage: "megaphone.fill").foregroundStyle(Theme.red)
                    }
                    .disabled(value.canSend == false)
                }
                Section("Sent") {
                    if value.history.isEmpty {
                        Text("Nothing sent yet.").font(.system(size: 15)).foregroundStyle(Theme.muted)
                    }
                    ForEach(value.history) { sent in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(sent.subject).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                            HStack(spacing: 6) {
                                if let label = sent.audienceLabel { Text(label) }
                                if let recipients = sent.recipientCount { Text("· \(recipients) people") }
                                if let read = sent.readCount { Text("· \(read) read") }
                            }
                            .font(.system(size: 12)).foregroundStyle(Theme.muted)
                            if let sentAt = sent.sentAt {
                                Text(FeedDate.ago(sentAt)).font(.system(size: 12)).foregroundStyle(Theme.muted.opacity(0.8))
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .refreshable { await loadable.load() }
            .sheet(isPresented: $composing) { composer(value) }
        }
        .nativeScreenChrome("Announcements")
        .notice($notice)
    }

    private func composer(_ value: FounderAnnouncements) -> some View {
        NavigationStack {
            Form {
                Section("Subject") {
                    TextField("What is this about?", text: $subject)
                }
                Section("Message") {
                    TextField("Say it in your own words…", text: $message, axis: .vertical).lineLimit(6...14)
                }
                Section("Who gets it") {
                    Picker("Audience", selection: $audience) {
                        ForEach(value.audiences.filter { $0.value != "levels" && $0.value != "members" }) { choice in
                            Text(choice.label).tag(choice.value)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
                Section("Where it shows") {
                    toggle("In their messages", "message")
                    toggle("As a notification", "notification")
                    toggle("On the home page", "homepage")
                }
                if let preview {
                    Section("Ready to send") {
                        Text("\(preview.audienceLabel ?? "Everyone") · \(preview.recipientCount) \(preview.recipientCount == 1 ? "person" : "people")")
                            .font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.ink)
                        Button("Send announcement") { confirming = true }
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Theme.red)
                    }
                }
            }
            .navigationTitle("New announcement")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { composing = false; preview = nil } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(preview == nil ? "Check" : "Re-check") { check() }
                        .bold()
                        .disabled(working || subject.trimmingCharacters(in: .whitespaces).isEmpty || message.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .confirmationDialog("Send to \(preview?.recipientCount ?? 0) \((preview?.recipientCount ?? 0) == 1 ? "person" : "people")?",
                                isPresented: $confirming, titleVisibility: .visible) {
                Button("Send it", role: .destructive) { send() }
            } message: {
                Text("This goes out for real and can't be unsent.")
            }
        }
    }

    private func toggle(_ title: String, _ key: String) -> some View {
        Toggle(title, isOn: Binding(
            get: { surfaces.contains(key) },
            set: { on in if on { surfaces.insert(key) } else { surfaces.remove(key) } }
        ))
        .tint(Theme.red)
    }

    private var draft: [String: Any] {
        [
            "subject": subject.trimmingCharacters(in: .whitespacesAndNewlines),
            "body": message.trimmingCharacters(in: .whitespacesAndNewlines),
            "audience": ["kind": audience],
            "surfaces": ["message": surfaces.contains("message"),
                         "notification": surfaces.contains("notification"),
                         "homepage": surfaces.contains("homepage")],
        ]
    }

    private func check() {
        working = true
        Task {
            defer { working = false }
            do {
                preview = try await api.post("/api/founder/announcements/preview", body: draft, as: AnnouncementPreview.self)
            } catch let error as FeedError {
                notice = error.message
            } catch {}
        }
    }

    private func send() {
        working = true
        Task {
            defer { working = false }
            struct Result: Decodable { let status: String?; let recipientCount: Int? }
            do {
                let result = try await api.post("/api/founder/announcements/send", body: draft, as: Result.self)
                composing = false
                preview = nil
                subject = ""
                message = ""
                notice = result.status == "already_sent" ? "That one had already gone out." : "Sent to \(result.recipientCount ?? 0) people."
                await loadable.load()
            } catch let error as FeedError {
                notice = error.message
            } catch {}
        }
    }
}
