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

        var symbol: String {
            switch self {
            case .song: "music.note"
            case .show: "music.mic"
            case .person: "person.crop.circle"
            case .split: "chart.pie"
            case .income: "dollarsign.circle"
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
    @State private var kind: Kind

    init(api: FeedAPI, kind: Kind = .song, saved: @escaping () -> Void) {
        self.api = api
        self.saved = saved
        _kind = State(initialValue: kind)
    }

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

    /// What still stops Save, said plainly under the button.
    private var blocker: String? {
        if saving { return nil }
        switch kind {
        case .song: return title.trimmed.isEmpty ? "Give the song a title to save it." : nil
        case .show: return title.trimmed.isEmpty ? "Give the show a name to save it." : nil
        case .person: return title.trimmed.isEmpty ? "Add their name to save them." : nil
        case .split:
            if title.trimmed.isEmpty { return "Add the song title to save the sheet." }
            return abs(shareTotal - 100) < 0.001 ? nil : "The shares have to make 100% first."
        case .income:
            if source.trimmed.isEmpty { return "Say who paid you to save this." }
            return Double(earned.trimmed) == nil ? "Enter how much was earned." : nil
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            kindPicker
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    switch kind {
                    case .song: songFields
                    case .show: showFields
                    case .person: personFields
                    case .split: splitFields
                    case .income: incomeFields
                    }
                    notesSection
                }
                .padding(.horizontal, Design.gutter)
                .padding(.top, 16)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { saveBar }
        .background(Theme.background)
        .tint(Theme.red)
        .notice($notice)
        .presentationBackground(Theme.background)
        .presentationDragIndicator(.visible)
    }

    // MARK: - Chrome

    private var header: some View {
        HStack {
            Button("Cancel") { dismiss() }
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Theme.muted)
            Spacer()
            Text("ADD TO MANAGER")
                .font(.roosterDisplay(15, relativeTo: .headline))
                .tracking(1)
                .foregroundStyle(Theme.ink)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            // Balances Cancel so the title sits in the middle.
            Text("Cancel").font(.system(size: 16, weight: .medium)).hidden().accessibilityHidden(true)
        }
        .padding(.horizontal, Design.gutter)
        .padding(.top, 22)
        .padding(.bottom, 14)
    }

    private var kindPicker: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Kind.allCases) { option in
                        let selected = option == kind
                        Button {
                            UISelectionFeedbackGenerator().selectionChanged()
                            withAnimation(.snappy(duration: 0.2)) { kind = option }
                        } label: {
                            Label(option.title, systemImage: option.symbol)
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(selected ? .white : Theme.ink.opacity(0.85))
                                .padding(.horizontal, 14)
                                .frame(height: 36)
                                .background(selected ? Theme.red : Theme.raised, in: Capsule())
                                .overlay(Capsule().stroke(selected ? Color.clear : Theme.line))
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(selected ? .isSelected : [])
                        .id(option)
                    }
                }
                .padding(.horizontal, Design.gutter)
            }
            .onAppear { proxy.scrollTo(kind, anchor: .center) }
            .onChange(of: kind) { _, value in withAnimation { proxy.scrollTo(value, anchor: .center) } }
        }
    }

    private var saveBar: some View {
        VStack(spacing: 8) {
            Button(saving ? "Saving…" : "Save to Manager") { save() }
                .buttonStyle(.designPrimary)
                .disabled(!ready)
                .opacity(ready || saving ? 1 : 0.45)
            if let blocker {
                Text(blocker).font(.system(size: 12)).foregroundStyle(Theme.muted)
            }
        }
        .padding(.horizontal, Design.gutter)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(Theme.background)
    }

    // MARK: - Fields

    private var songFields: some View {
        FieldGroup(title: "The song") {
            FieldRow(label: "Title", text: $title, prompt: "Required")
            ManagerHairline()
            FieldRow(label: "Artist", text: $artist, prompt: "Who it's by")
            ManagerHairline()
            FieldRow(label: "Featuring", text: $collaborators, prompt: "Who else is on it")
            ManagerHairline()
            FieldRow(label: "ISRC", text: $isrc, prompt: "Optional", capitalization: .characters)
        }
    }

    private var showFields: some View {
        FieldGroup(title: "The show") {
            FieldRow(label: "Name", text: $title, prompt: "What is it called?")
            ManagerHairline()
            DateRow(label: "Date", date: $date)
            ManagerHairline()
            FieldRow(label: "Venue", text: $venue, prompt: "Where")
            ManagerHairline()
            FieldRow(label: "City", text: $city, prompt: "City")
            ManagerHairline()
            FieldRow(label: "Fee", text: $fee, prompt: "0", keyboard: .decimalPad)
            ManagerHairline()
            FieldRow(label: "Booked by", text: $contact, prompt: "Who booked it")
        }
    }

    private var personFields: some View {
        VStack(alignment: .leading, spacing: 20) {
            FieldGroup(title: "Who") {
                FieldRow(label: "Name", text: $title, prompt: "Required")
                ManagerHairline()
                FieldRow(label: "Role", text: $role, prompt: "What they do")
                ManagerHairline()
                FieldRow(label: "Company", text: $company, prompt: "Optional")
            }
            FieldGroup(title: "How to reach them") {
                FieldRow(label: "Email", text: $email, prompt: "name@example.com", keyboard: .emailAddress, capitalization: .never)
                ManagerHairline()
                FieldRow(label: "Phone", text: $phone, prompt: "Optional", keyboard: .phonePad)
            }
        }
    }

    private var splitFields: some View {
        VStack(alignment: .leading, spacing: 20) {
            FieldGroup(title: "The song") {
                FieldRow(label: "Song title", text: $title, prompt: "Required")
                ManagerHairline()
                FieldRow(label: "Artist", text: $artist, prompt: "Main artist")
                ManagerHairline()
                DateRow(label: "Date", date: $date)
            }
            VStack(alignment: .leading, spacing: 8) {
                Eyebrow(text: "Who owns it")
                ManagerSplitBar(shares: shares.map { Double($0.share.trimmed) ?? 0 }, height: 8)
                    .padding(.vertical, 4)
                ForEach($shares) { $share in
                    let index = shares.firstIndex(of: share) ?? 0
                    VStack(spacing: 0) {
                        HStack(spacing: 10) {
                            Circle().fill(ManagerSplitBar.color(index)).frame(width: 10, height: 10).accessibilityHidden(true)
                            TextField("", text: $share.name, prompt: Text("Name").foregroundStyle(Theme.muted.opacity(0.7)))
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Theme.ink)
                            if shares.count > 1 {
                                Button {
                                    shares.removeAll { $0.id == share.id }
                                } label: {
                                    Image(systemName: "minus.circle.fill").font(.system(size: 18)).foregroundStyle(Theme.muted)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Remove \(share.name.nilIfEmpty ?? "this person")")
                            }
                        }
                        .padding(.horizontal, 14)
                        .frame(minHeight: ManagerLayout.fieldHeight)
                        ManagerHairline()
                        HStack(spacing: 10) {
                            TextField("", text: $share.role, prompt: Text("Role").foregroundStyle(Theme.muted.opacity(0.7)))
                                .font(.system(size: 15))
                                .foregroundStyle(Theme.ink)
                            TextField("", text: $share.share, prompt: Text("0").foregroundStyle(Theme.muted.opacity(0.7)))
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .font(.rooster(17, weight: .bold))
                                .foregroundStyle(Theme.ink)
                                .frame(width: 64)
                                .accessibilityLabel("Share, percent")
                            Text("%").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.muted)
                        }
                        .padding(.horizontal, 14)
                        .frame(minHeight: ManagerLayout.fieldHeight)
                    }
                    .designCard(padding: 0, radius: 16)
                }
                Button { shares.append(Share()) } label: {
                    Label("Add someone", systemImage: "plus")
                }
                .buttonStyle(.designGlass)
                Text(abs(shareTotal - 100) < 0.001
                     ? "That adds up to 100%."
                     : "The shares add up to \(shareTotal.clean)%. They have to make 100% before this can be saved.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(abs(shareTotal - 100) < 0.001 ? Theme.muted : Theme.red)
            }
        }
    }

    private var incomeFields: some View {
        VStack(alignment: .leading, spacing: 20) {
            FieldGroup(title: "Where it came from") {
                FieldRow(label: "Paid by", text: $source, prompt: "Who paid you")
                ManagerHairline()
                MenuRow(label: "Kind", selection: $incomeType, options: incomeTypes)
                ManagerHairline()
                FieldRow(label: "Song", text: $song, prompt: "Optional")
            }
            FieldGroup(title: "How much") {
                MenuRow(label: "Currency", selection: $currency, options: currencies)
                ManagerHairline()
                FieldRow(label: "Earned", text: $earned, prompt: "0.00", keyboard: .decimalPad, trailing: true)
                ManagerHairline()
                FieldRow(label: "Paid so far", text: $paid, prompt: "0.00", keyboard: .decimalPad, trailing: true)
            }
        }
    }

    private var notesSection: some View {
        FieldGroup(title: "Notes") {
            TextField("", text: $notes, prompt: Text("Anything worth remembering…").foregroundStyle(Theme.muted.opacity(0.7)), axis: .vertical)
                .lineLimit(2...6)
                .font(.system(size: 15))
                .foregroundStyle(Theme.ink)
                .padding(14)
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

// MARK: - Form parts

/// An eyebrow over one card of rows.
private struct FieldGroup<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(text: title)
            VStack(spacing: 0) { content }
                .designCard(padding: 0, radius: 16)
        }
    }
}

private struct FieldRow: View {
    let label: String
    @Binding var text: String
    var prompt = ""
    var keyboard: UIKeyboardType = .default
    var capitalization: TextInputAutocapitalization = .sentences
    var trailing = false

    var body: some View {
        HStack(spacing: 12) {
            Text(label)
                .font(.system(size: 15))
                .foregroundStyle(Theme.muted)
                .frame(width: 96, alignment: .leading)
            TextField("", text: $text, prompt: Text(prompt).foregroundStyle(Theme.muted.opacity(0.6)))
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.ink)
                .keyboardType(keyboard)
                .textInputAutocapitalization(capitalization)
                .multilineTextAlignment(trailing ? .trailing : .leading)
                .accessibilityLabel(label)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: ManagerLayout.fieldHeight)
    }
}

private struct DateRow: View {
    let label: String
    @Binding var date: Date

    var body: some View {
        HStack(spacing: 12) {
            Text(label)
                .font(.system(size: 15))
                .foregroundStyle(Theme.muted)
            Spacer()
            DatePicker(label, selection: $date, displayedComponents: .date)
                .labelsHidden()
                .tint(Theme.red)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: ManagerLayout.fieldHeight)
    }
}

private struct MenuRow: View {
    let label: String
    @Binding var selection: String
    let options: [String]

    var body: some View {
        HStack(spacing: 12) {
            Text(label)
                .font(.system(size: 15))
                .foregroundStyle(Theme.muted)
            Spacer()
            Menu {
                Picker(label, selection: $selection) {
                    ForEach(options, id: \.self) { Text($0).tag($0) }
                }
            } label: {
                HStack(spacing: 5) {
                    Text(selection)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .semibold))
                }
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(Theme.raised, in: Capsule())
            }
            .accessibilityLabel("\(label), \(selection)")
        }
        .padding(.horizontal, 14)
        .frame(minHeight: ManagerLayout.fieldHeight)
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

private extension Double {
    /// 100 rather than 100.0, so the running total reads like a percentage.
    var clean: String { self == rounded() ? String(Int(self)) : String(format: "%.1f", self) }
}
