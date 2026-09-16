import SwiftUI

/// Saving a record to ROOSTER Manager (rcm-workspace.mts, action "record").
/// Money is the fussy one: the site insists a money entry is a royalty record carrying
/// record_type "money-v1", and validates it in rcm-money.mjs before it will store anything.
struct AddRecordSheet: View {
    enum Kind: String, CaseIterable, Identifiable {
        case song, show, person, split, income
        var id: String { rawValue }

        var title: String {
            switch self {
            case .song: "Song"
            case .show: "Show"
            case .person: "Person"
            case .split: "Split sheet"
            case .income: "Money in"
            }
        }

        /// What the site calls it (rcm-workspace.mts KINDS).
        var recordKind: String {
            switch self {
            case .song: "song"
            case .show: "show"
            case .person: "person"
            case .split: "document"
            case .income: "royalty"
            }
        }
    }

    let api: FeedAPI
    let saved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var kind: Kind = .song

    // Shared
    @State private var title = ""
    @State private var notes = ""
    // Song
    @State private var artist = ""
    @State private var collaborators = ""
    @State private var isrc = ""
    // Show
    @State private var date = Date()
    @State private var venue = ""
    @State private var city = ""
    @State private var fee = ""
    @State private var contact = ""
    // Person
    @State private var role = ""
    @State private var company = ""
    @State private var email = ""
    @State private var phone = ""
    // Split sheet
    @State private var shares: [Share] = [Share(), Share()]
    // Money
    @State private var source = ""
    @State private var incomeType = "Streaming"
    @State private var currency = "USD"
    @State private var earned = ""
    @State private var paid = ""
    @State private var song = ""

    @State private var saving = false
    @State private var notice: String?

    struct Share: Identifiable, Hashable {
        let id = UUID()
        var name = ""
        var role = ""
        var share = ""
    }

    /// rcm-money.mjs:35-56.
    private let incomeTypes = ["Publishing", "Streaming", "Sync", "Performance", "Sales", "Shows", "Other"]
    private let currencies = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY"]

    private var shareTotal: Double {
        shares.compactMap { Double($0.share.trimmingCharacters(in: .whitespaces)) }.reduce(0, +)
    }

    private var ready: Bool {
        if saving { return false }
        switch kind {
        case .song, .show: return !title.trimmed.isEmpty
        case .person: return !title.trimmed.isEmpty
        case .split: return !title.trimmed.isEmpty && abs(shareTotal - 100) < 0.001
        case .income: return !source.trimmed.isEmpty && Double(earned.trimmed) != nil
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("What is it?", selection: $kind) {
                        ForEach(Kind.allCases) { Text($0.title).tag($0) }
                    }
                }
                switch kind {
                case .song: songFields
                case .show: showFields
                case .person: personFields
                case .split: splitFields
                case .income: incomeFields
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .tint(Theme.red)
            .navigationTitle("Add to Manager")
            .navigationBarTitleDisplayMode(.inline)
            .notice($notice)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(saving ? "Saving…" : "Save") { save() }.bold().disabled(!ready)
                }
            }
        }
    }

    // MARK: - Fields

    private var songFields: some View {
        Group {
            Section("The song") {
                TextField("Title", text: $title)
                TextField("Artist", text: $artist)
                TextField("Who else is on it", text: $collaborators)
                TextField("ISRC (optional)", text: $isrc).textInputAutocapitalization(.characters)
            }
            notesSection
        }
    }

    private var showFields: some View {
        Group {
            Section("The show") {
                TextField("What is it called?", text: $title)
                DatePicker("Date", selection: $date, displayedComponents: .date)
                TextField("Venue", text: $venue)
                TextField("City", text: $city)
                TextField("Fee", text: $fee).keyboardType(.decimalPad)
                TextField("Who booked it", text: $contact)
            }
            notesSection
        }
    }

    private var personFields: some View {
        Group {
            Section("Who") {
                TextField("Name", text: $title)
                TextField("What they do", text: $role)
                TextField("Company", text: $company)
            }
            Section("How to reach them") {
                TextField("Email", text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                TextField("Phone", text: $phone).keyboardType(.phonePad)
            }
            notesSection
        }
    }

    private var splitFields: some View {
        Group {
            Section("The song") {
                TextField("Song title", text: $title)
                TextField("Artist", text: $artist)
                DatePicker("Date", selection: $date, displayedComponents: .date)
            }
            Section {
                ForEach($shares) { $share in
                    VStack(spacing: 6) {
                        TextField("Name", text: $share.name)
                        HStack {
                            TextField("Role", text: $share.role)
                            TextField("%", text: $share.share)
                                .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 70)
                        }
                    }
                    .padding(.vertical, 2)
                }
                .onDelete { shares.remove(atOffsets: $0) }
                Button { shares.append(Share()) } label: {
                    Label("Add someone", systemImage: "plus.circle.fill").foregroundStyle(Theme.red)
                }
            } header: {
                Text("Who owns it")
            } footer: {
                Text(abs(shareTotal - 100) < 0.001
                     ? "That adds up to 100%."
                     : "The shares add up to \(shareTotal.clean)%. They have to make 100% before this can be saved.")
                    .foregroundStyle(abs(shareTotal - 100) < 0.001 ? Theme.muted : Theme.red)
            }
        }
    }

    private var incomeFields: some View {
        Group {
            Section("Where it came from") {
                TextField("Who paid you", text: $source)
                Picker("Kind", selection: $incomeType) {
                    ForEach(incomeTypes, id: \.self) { Text($0).tag($0) }
                }
                TextField("Song it's for (optional)", text: $song)
            }
            Section("How much") {
                Picker("Currency", selection: $currency) {
                    ForEach(currencies, id: \.self) { Text($0).tag($0) }
                }
                HStack {
                    Text("Earned")
                    Spacer()
                    TextField("0.00", text: $earned).keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing).frame(width: 120)
                }
                HStack {
                    Text("Paid so far")
                    Spacer()
                    TextField("0.00", text: $paid).keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing).frame(width: 120)
                }
            }
            notesSection
        }
    }

    private var notesSection: some View {
        Section("Notes") {
            TextField("Anything worth remembering…", text: $notes, axis: .vertical).lineLimit(2...6)
        }
    }

    // MARK: - Saving

    private static let day: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    /// Minor units, the way the site counts money (rcm-money.mjs). A nonnegative whole
    /// number is the only thing it will store, so rounding happens here, not there.
    static func cents(_ text: String) -> Int {
        let cleaned = text.trimmed.replacingOccurrences(of: ",", with: "")
        return max(0, Int(((Double(cleaned) ?? 0) * 100).rounded()))
    }

    private func save() {
        saving = true
        var data: [String: Any] = [:]
        var recordTitle = title.trimmed
        var dueAt: String?

        switch kind {
        case .song:
            data = ["title": recordTitle, "artist": artist.trimmed,
                    "collaborators": collaborators.trimmed, "isrc": isrc.trimmed, "notes": notes.trimmed]
        case .show:
            let day = Self.day.string(from: date)
            data = ["title": recordTitle, "date": day, "venue": venue.trimmed, "city": city.trimmed,
                    "fee": fee.trimmed, "contact": contact.trimmed, "notes": notes.trimmed]
            dueAt = "\(day)T12:00:00.000Z"
        case .person:
            data = ["name": recordTitle, "role": role.trimmed, "company": company.trimmed,
                    "email": email.trimmed, "phone": phone.trimmed, "notes": notes.trimmed]
        case .split:
            data = ["document_type": "split-sheet",
                    "song_title": recordTitle,
                    "artist": artist.trimmed,
                    "date": Self.day.string(from: date),
                    "contributors": shares.filter { !$0.name.trimmed.isEmpty }.map {
                        ["name": $0.name.trimmed, "role": $0.role.trimmed,
                         "share": Double($0.share.trimmed) ?? 0]
                    }]
            recordTitle = "\(recordTitle) Split Sheet"
        case .income:
            data = ["record_type": "money-v1",
                    "source": source.trimmed,
                    "income_type": incomeType,
                    "currency": currency,
                    "earned_cents": Self.cents(earned),
                    "paid_cents": Self.cents(paid),
                    "song_title": song.trimmed,
                    "notes": notes.trimmed]
            recordTitle = source.trimmed
        }

        var body: [String: Any] = ["action": "record", "kind": kind.recordKind,
                                   "title": String(recordTitle.prefix(180)), "data": data]
        if let dueAt { body["due_at"] = dueAt }

        struct Saved: Decodable { let record: ManagerWorkspace.Record? }
        Task {
            defer { saving = false }
            do {
                _ = try await api.post("/api/rcm/workspace", body: body, as: Saved.self)
                dismiss()
                saved()
            } catch let error as FeedError {
                notice = error.message
            } catch {
                notice = "That didn't save. Try again."
            }
        }
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

private extension Double {
    /// 100 rather than 100.0, so the running total reads like a percentage.
    var clean: String { self == rounded() ? String(Int(self)) : String(format: "%.1f", self) }
}
