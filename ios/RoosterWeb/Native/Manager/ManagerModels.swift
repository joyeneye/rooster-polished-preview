import Foundation

/// Free-form record data (rcm-workspace.mts:25-27 stores whatever the tool saved).
enum JSONValue: Decodable, Hashable {
    case string(String), number(Double), bool(Bool), array([JSONValue]), object([String: JSONValue]), null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else if let value = try? container.decode([String: JSONValue].self) { self = .object(value) }
        else { self = .null }
    }

    var text: String? {
        switch self {
        case .string(let value): value
        case .number(let value): value == value.rounded() ? String(Int(value)) : String(value)
        case .bool(let value): value ? "Yes" : "No"
        default: nil
        }
    }

    var int: Int? {
        switch self {
        case .number(let value): Int(exactly: value.rounded())
        case .string(let value): Int(value)
        default: nil
        }
    }

    var double: Double? {
        switch self {
        case .number(let value): value
        case .string(let value): Double(value)
        default: nil
        }
    }

    var array: [JSONValue]? { if case .array(let value) = self { return value }; return nil }
    var object: [String: JSONValue]? { if case .object(let value) = self { return value }; return nil }
}

/// /api/rcm/workspace (rcm-workspace.mts:25-45).
struct ManagerWorkspace: Decodable {
    struct Record: Decodable, Hashable, Identifiable {
        let id: Int
        let kind: String
        let title: String?
        let status: String?
        let relationKey: String?
        let data: [String: JSONValue]?
        let dueAt: String?
        let updatedAt: String?

        var field: (String) -> String? { { data?[$0]?.text?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty } }

        var kindLabel: String {
            switch kind {
            case "royalty": "Income"
            case "song": "Song"
            case "show": "Show"
            case "person": "Person"
            case "document": (data?["document_type"]?.text == "split-sheet") ? "Split sheet" : "Document"
            default: kind.capitalized
            }
        }

        var symbol: String {
            switch kind {
            case "royalty": "dollarsign.circle.fill"
            case "song": "music.note"
            case "show": "calendar"
            case "person": "person.crop.circle"
            default: "doc.text.fill"
            }
        }
    }

    struct ChatMessage: Decodable, Hashable, Identifiable {
        let role: String
        let content: String
        var id: String { "\(role)-\(content.hashValue)" }
    }

    let records: [Record]
    let truncated: Bool?
    let messages: [ChatMessage]?
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

// MARK: - Money

/// rcm-money.mjs, ported: the money records, their status and the totals per currency.
enum ManagerMoney {
    static let currencies = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY"]
    static let incomeTypes = ["Publishing", "Streaming", "Sync", "Performance", "Sales", "Shows", "Other"]

    static func digits(_ currency: String) -> Int { currency == "JPY" ? 0 : 2 }

    struct Entry: Hashable, Identifiable {
        let id: Int
        let title: String
        let songTitle: String
        let source: String
        let incomeType: String
        let currency: String
        let earnedCents: Int
        let paidCents: Int
        let expectedDate: String
        let paidDate: String
        let period: String
        let territory: String
        let statementReference: String
        let notes: String
        let status: String

        var outstandingCents: Int { earnedCents - paidCents }
        var statusLabel: String {
            switch status {
            case "paid": "Paid"
            case "overdue": "Past due"
            case "part-paid": "Part paid"
            default: "Unpaid"
            }
        }
    }

    struct Group: Hashable, Identifiable {
        struct Slice: Hashable, Identifiable {
            let label: String
            var earnedCents = 0
            var paidCents = 0
            var outstandingCents = 0
            var id: String { label }
        }
        let currency: String
        var earnedCents = 0
        var paidCents = 0
        var outstandingCents = 0
        var overdueCents = 0
        var count = 0
        var sources: [Slice] = []
        var songs: [Slice] = []
        var id: String { currency }
    }

    struct Summary {
        var groups: [Group] = []
        var entries: [Entry] = []
        var unrecognized = 0
    }

    /// summarizeMoney(records, {today}).
    static func summarize(_ records: [ManagerWorkspace.Record], today: String = Self.today()) -> Summary {
        var summary = Summary()
        var groups: [String: Group] = [:]
        var sources: [String: [String: Group.Slice]] = [:]
        var songs: [String: [String: Group.Slice]] = [:]

        for record in records where record.kind == "royalty" {
            guard let entry = normalize(record, today: today) else {
                summary.unrecognized += 1
                continue
            }
            summary.entries.append(entry)
            var group = groups[entry.currency] ?? Group(currency: entry.currency)
            group.earnedCents += entry.earnedCents
            group.paidCents += entry.paidCents
            group.outstandingCents += entry.outstandingCents
            if entry.status == "overdue" { group.overdueCents += entry.outstandingCents }
            group.count += 1
            groups[entry.currency] = group
            add(&sources, currency: entry.currency, label: entry.source, entry: entry)
            add(&songs, currency: entry.currency, label: entry.songTitle, entry: entry)
        }

        summary.groups = currencies.compactMap { currency in
            guard var group = groups[currency] else { return nil }
            group.sources = (sources[currency] ?? [:]).values.sorted { $0.earnedCents > $1.earnedCents }
            group.songs = (songs[currency] ?? [:]).values.sorted { $0.earnedCents > $1.earnedCents }
            return group
        }
        return summary
    }

    private static func add(_ store: inout [String: [String: Group.Slice]], currency: String, label: String, entry: Entry) {
        var byLabel = store[currency] ?? [:]
        var slice = byLabel[label] ?? Group.Slice(label: label)
        slice.earnedCents += entry.earnedCents
        slice.paidCents += entry.paidCents
        slice.outstandingCents += entry.outstandingCents
        byLabel[label] = slice
        store[currency] = byLabel
    }

    /// normalizeMoneyData: a record that doesn't fit is counted, not shown.
    static func normalize(_ record: ManagerWorkspace.Record, today: String) -> Entry? {
        guard let data = record.data, data["record_type"]?.text == "money-v1" else { return nil }
        let currency = (data["currency"]?.text ?? "").uppercased()
        guard currencies.contains(currency) else { return nil }
        let incomeType = data["income_type"]?.text ?? ""
        guard incomeTypes.contains(incomeType) else { return nil }
        let source = (data["source"]?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !source.isEmpty else { return nil }
        guard let earned = data["earned_cents"]?.int, earned >= 0,
              let paid = data["paid_cents"]?.int, paid >= 0, paid <= earned else { return nil }

        let expected = data["expected_date"]?.text ?? ""
        let outstanding = earned - paid
        let overdue = outstanding > 0 && !expected.isEmpty && expected < today
        let status = outstanding == 0 ? "paid" : overdue ? "overdue" : paid > 0 ? "part-paid" : "unpaid"
        return Entry(
            id: record.id,
            title: record.title ?? "",
            songTitle: data["song_title"]?.text ?? "",
            source: source,
            incomeType: incomeType,
            currency: currency,
            earnedCents: earned,
            paidCents: paid,
            expectedDate: expected,
            paidDate: data["paid_date"]?.text ?? "",
            period: data["period"]?.text ?? "",
            territory: data["territory"]?.text ?? "",
            statementReference: data["statement_reference"]?.text ?? "",
            notes: data["notes"]?.text ?? "",
            status: status
        )
    }

    static func format(_ cents: Int, currency: String) -> String {
        let digits = digits(currency)
        let amount = Decimal(cents) / pow(10, digits)
        return amount.formatted(.currency(code: currency).precision(.fractionLength(digits)))
    }

    /// The plain number a spreadsheet reads, e.g. 125.50 or 1250 for JPY.
    static func decimal(_ cents: Int, currency: String) -> String {
        let digits = digits(currency)
        guard digits > 0 else { return String(cents) }
        let sign = cents < 0 ? "-" : ""
        let value = abs(cents)
        return "\(sign)\(value / 100).\(String(format: "%02d", value % 100))"
    }

    static func today() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.string(from: Date())
    }

    /// exportMoney() in rcm.js:245-254, including the BOM and the leading-character escape that
    /// stops a spreadsheet treating a cell as a formula.
    static func csv(_ entries: [Entry]) -> String {
        let columns = ["Record ID", "Song or project", "Payer", "Income type", "Currency", "Recorded earnings",
                       "Paid so far", "Still owed", "Expected date", "Last payment date", "Earning period",
                       "Territory", "Statement reference", "Status"]
        func cell(_ value: String) -> String {
            var text = value
            if let first = text.first, "=+@-\t\r".contains(first) { text = "'" + text }
            return "\"" + text.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        let rows = entries.map { entry in
            [String(entry.id), entry.songTitle, entry.source, entry.incomeType, entry.currency,
             decimal(entry.earnedCents, currency: entry.currency),
             decimal(entry.paidCents, currency: entry.currency),
             decimal(entry.outstandingCents, currency: entry.currency),
             entry.expectedDate, entry.paidDate, entry.period, entry.territory, entry.statementReference, entry.status]
                .map(cell).joined(separator: ",")
        }
        return "\u{FEFF}" + ([columns.map(cell).joined(separator: ",")] + rows).joined(separator: "\r\n")
    }
}

/// A saved split sheet (rcm.js:407-424).
struct SplitSheet {
    struct Contributor: Hashable, Identifiable {
        let name: String
        let role: String
        let share: Double
        var id: String { name + role }
    }
    let songTitle: String
    let artist: String
    let date: String
    let contributors: [Contributor]

    var total: Double { contributors.reduce(0) { $0 + $1.share } }

    init?(_ record: ManagerWorkspace.Record) {
        guard record.kind == "document", record.data?["document_type"]?.text == "split-sheet" else { return nil }
        songTitle = record.data?["song_title"]?.text ?? record.title ?? "Split sheet"
        artist = record.data?["artist"]?.text ?? ""
        date = record.data?["date"]?.text ?? ""
        contributors = (record.data?["contributors"]?.array ?? []).compactMap { value in
            guard let person = value.object, let name = person["name"]?.text else { return nil }
            return Contributor(name: name, role: person["role"]?.text ?? "", share: person["share"]?.double ?? 0)
        }
    }
}
