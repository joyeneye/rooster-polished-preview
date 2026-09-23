import Foundation

// The Overview's figures, all computed from the saved records. Nothing here is sample data:
// an empty workspace produces zeros and empty lists, and the views say so.

enum ManagerDates {
    static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar
    }()

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    /// A site date ("2026-09-14") or timestamp ("2026-09-14T12:00:00Z"), read as that calendar day.
    static func day(_ text: String?) -> Date? {
        guard let text = text?.trimmingCharacters(in: .whitespaces), text.count >= 10 else { return nil }
        return dayFormatter.date(from: String(text.prefix(10)))
    }

    static func string(_ date: Date) -> String { dayFormatter.string(from: date) }
}

/// Earned this month, owed, paid out and the month's running total, for one currency.
struct ManagerDashboard {
    struct Point: Identifiable, Hashable {
        let day: Date
        let cents: Int
        var id: Date { day }
    }

    let currency: String?
    let monthStart: Date
    /// The first moment of the month's last day.
    let monthEnd: Date
    /// Money recorded against a date in this calendar month.
    let earnedCents: Int
    let entriesThisMonth: Int
    /// Running total from the 1st to the later of today and the last dated entry this month.
    let series: [Point]
    /// This month against the same stretch of last month, as a fraction (0.18 = +18%).
    /// nil when last month had nothing to compare with.
    let change: Double?
    /// Every unpaid amount in this currency, whatever month it belongs to.
    let owedCents: Int
    let overdueCents: Int
    let openCount: Int
    /// Everything paid to you in this currency.
    let paidCents: Int

    /// The date a money entry counts on: when it is expected, else when it was last paid,
    /// else when the record was last saved.
    static func date(of entry: ManagerMoney.Entry, updatedAt: String?) -> Date? {
        ManagerDates.day(entry.expectedDate) ?? ManagerDates.day(entry.paidDate) ?? ManagerDates.day(updatedAt)
    }

    /// The currency with the most money this month, else the first one with any money at all.
    static func preferredCurrency(_ summary: ManagerMoney.Summary, records: [ManagerWorkspace.Record],
                                  now: Date = .now, calendar: Calendar = ManagerDates.calendar) -> String? {
        let updated = Dictionary(records.map { ($0.id, $0.updatedAt) }, uniquingKeysWith: { first, _ in first })
        var totals: [String: Int] = [:]
        for entry in summary.entries {
            guard let date = date(of: entry, updatedAt: updated[entry.id] ?? nil),
                  calendar.isDate(date, equalTo: now, toGranularity: .month) else { continue }
            totals[entry.currency, default: 0] += entry.earnedCents
        }
        if let best = totals.max(by: { $0.value < $1.value || ($0.value == $1.value && $0.key > $1.key) }), best.value > 0 {
            return best.key
        }
        return summary.groups.first?.currency
    }

    init(summary: ManagerMoney.Summary, records: [ManagerWorkspace.Record], currency: String?,
         now: Date = .now, calendar: Calendar = ManagerDates.calendar) {
        let today = calendar.startOfDay(for: now)
        let monthStart = calendar.dateInterval(of: .month, for: today)?.start ?? today
        let nextMonth = calendar.date(byAdding: .month, value: 1, to: monthStart) ?? today
        let monthEnd = calendar.date(byAdding: .day, value: -1, to: nextMonth) ?? today
        let lastMonthStart = calendar.date(byAdding: .month, value: -1, to: monthStart) ?? monthStart
        self.monthStart = monthStart
        self.monthEnd = monthEnd

        let group = summary.groups.first { $0.currency == currency } ?? summary.groups.first
        self.currency = group?.currency
        owedCents = group?.outstandingCents ?? 0
        overdueCents = group?.overdueCents ?? 0
        paidCents = group?.paidCents ?? 0

        let updated = Dictionary(records.map { ($0.id, $0.updatedAt) }, uniquingKeysWith: { first, _ in first })
        let entries = summary.entries.filter { $0.currency == group?.currency }
        openCount = entries.filter { $0.outstandingCents > 0 }.count
        let dated: [(entry: ManagerMoney.Entry, day: Date)] = entries.compactMap { entry in
            Self.date(of: entry, updatedAt: updated[entry.id] ?? nil).map { (entry, calendar.startOfDay(for: $0)) }
        }

        let thisMonth = dated.filter { $0.day >= monthStart && $0.day < nextMonth }
        earnedCents = thisMonth.reduce(0) { $0 + $1.entry.earnedCents }
        entriesThisMonth = thisMonth.count

        // The running total at the 1st, at every day something was recorded, and at the end
        // (today, or a later date this month something is expected). Plotted against the
        // calendar, so gaps between entries show as gaps.
        let lastDay = max(today, thisMonth.map(\.day).max() ?? today)
        let byDay = Dictionary(grouping: thisMonth, by: \.day)
        var points = [Point(day: monthStart, cents: (byDay[monthStart] ?? []).reduce(0) { $0 + $1.entry.earnedCents })]
        var running = points[0].cents
        for day in byDay.keys.sorted() where day > monthStart {
            running += (byDay[day] ?? []).reduce(0) { $0 + $1.entry.earnedCents }
            points.append(Point(day: day, cents: running))
        }
        if let last = points.last, last.day < lastDay { points.append(Point(day: lastDay, cents: running)) }
        series = points

        // Compare like with like: the 1st to the same day of last month.
        let span = calendar.dateComponents([.day], from: monthStart, to: lastDay).day ?? 0
        let lastMonthEnd = calendar.date(byAdding: .day, value: -1, to: monthStart) ?? monthStart
        let cutoff = min(calendar.date(byAdding: .day, value: span, to: lastMonthStart) ?? lastMonthStart, lastMonthEnd)
        let previous = dated.filter { $0.day >= lastMonthStart && $0.day <= cutoff }.reduce(0) { $0 + $1.entry.earnedCents }
        change = previous > 0 ? Double(earnedCents - previous) / Double(previous) : nil
    }
}

/// A saved show (AddRecordSheet: title, date, venue, city, fee, contact).
struct ManagerShow: Identifiable, Hashable {
    let id: Int
    /// The venue when there is one, since that is what you look for; else the show's name.
    let headline: String
    let detail: String?
    let fee: String?
    let date: Date?

    init?(_ record: ManagerWorkspace.Record) {
        guard record.kind == "show" else { return nil }
        id = record.id
        let title = record.field("title") ?? record.title?.nilIfEmpty
        let venue = record.field("venue")
        let city = record.field("city")
        headline = venue ?? title ?? "Show"
        detail = city ?? (venue != nil && title != venue ? title : nil)
        fee = record.field("fee")
        date = ManagerDates.day(record.field("date")) ?? ManagerDates.day(record.dueAt)
    }

    /// Upcoming soonest first, then past most recent first, then undated.
    static func split(_ records: [ManagerWorkspace.Record], now: Date = .now,
                      calendar: Calendar = ManagerDates.calendar) -> (upcoming: [ManagerShow], past: [ManagerShow], undated: [ManagerShow]) {
        let today = calendar.startOfDay(for: now)
        let shows = records.compactMap(ManagerShow.init)
        let upcoming = shows.filter { ($0.date ?? .distantPast) >= today }.sorted { $0.date! < $1.date! }
        let past = shows.filter { $0.date.map { $0 < today } ?? false }.sorted { $0.date! > $1.date! }
        return (upcoming, past, shows.filter { $0.date == nil })
    }

    /// A number is shown as money; anything else ("Door split") exactly as it was typed.
    func feeText(currency: String?) -> String? {
        guard let fee else { return nil }
        let cleaned = fee.replacingOccurrences(of: ",", with: "").replacingOccurrences(of: "$", with: "")
            .trimmingCharacters(in: .whitespaces)
        guard let value = Double(cleaned), value >= 0 else { return fee }
        let whole = value == value.rounded()
        if let currency {
            return value.formatted(.currency(code: currency).precision(.fractionLength(whole ? 0 : 2)))
        }
        return value.formatted(.number.precision(.fractionLength(whole ? 0 : 2)))
    }
}

extension SplitSheet {
    /// "3 writers · 100%".
    var summaryLine: String {
        let count = contributors.count
        let total = total.formatted(.number.precision(.fractionLength(0...2)))
        return "\(count) writer\(count == 1 ? "" : "s") · \(total)%"
    }

    var balanced: Bool { abs(total - 100) < 0.001 }
}
