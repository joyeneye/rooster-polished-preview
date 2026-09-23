import Charts
import SwiftUI

extension ManagerMoney {
    /// Whole amounts without the ".00" ("$8,275"), anything else to the cent. Never rounded.
    static func figure(_ cents: Int, currency: String) -> String {
        let digits = digits(currency)
        guard digits > 0, cents % 100 == 0 else { return format(cents, currency: currency) }
        return (Decimal(cents) / 100).formatted(.currency(code: currency).precision(.fractionLength(0)))
    }
}

// MARK: - Earned this month

/// EARNED THIS MONTH, the amount, the month's running total as a red area, and the change
/// against the same stretch of last month.
struct ManagerEarningsCard: View {
    let dashboard: ManagerDashboard
    let currencies: [String]
    @Binding var currency: String?

    private var points: [ManagerDashboard.Point] { dashboard.series }
    private var peak: Double { Double(points.map(\.cents).max() ?? 0) / 100 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Eyebrow(text: "Earned this month")
                        if currencies.count > 1 { currencyMenu }
                    }
                    if let code = dashboard.currency {
                        Text(ManagerMoney.figure(dashboard.earnedCents, currency: code))
                            .font(.rooster(36, weight: .bold))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                            .contentTransition(.numericText())
                    } else {
                        Text("No money in yet")
                            .font(.rooster(26, weight: .bold))
                            .foregroundStyle(Theme.ink)
                    }
                }
                Spacer(minLength: 0)
                if let change = dashboard.change { ChangeBadge(change: change) }
            }
            .accessibilityElement(children: .combine)

            chart
                .frame(height: ManagerLayout.heroChartHeight)
                .padding(.top, 8)
                .overlay {
                    if dashboard.entriesThisMonth == 0 {
                        Text(dashboard.currency == nil
                             ? "Add money in with + Add and this month charts here."
                             : "Nothing dated this month yet.")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.muted)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                    }
                }

            HStack {
                Text(axisLabel(dashboard.monthStart))
                Spacer()
                Text(axisLabel(ManagerDates.calendar.date(byAdding: .day, value: 14, to: dashboard.monthStart) ?? dashboard.monthStart))
                Spacer()
                Text(axisLabel(dashboard.monthEnd))
            }
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Theme.muted)
            .padding(.top, 8)
            .accessibilityHidden(true)
        }
        .designCard(padding: 16)
    }

    private var chart: some View {
        Chart {
            ForEach(points) { point in
                AreaMark(x: .value("Day", point.day, unit: .day),
                         yStart: .value("Start", 0),
                         yEnd: .value("Earned", Double(point.cents) / 100))
                    .interpolationMethod(.monotone)
                    .foregroundStyle(LinearGradient(colors: [Theme.red.opacity(0.5), Theme.red.opacity(0.03)],
                                                    startPoint: .top, endPoint: .bottom))
                LineMark(x: .value("Day", point.day, unit: .day), y: .value("Earned", Double(point.cents) / 100))
                    .interpolationMethod(.monotone)
                    .foregroundStyle(Theme.red)
                    .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
            }
            if let last = points.last, dashboard.entriesThisMonth > 0 {
                PointMark(x: .value("Day", last.day, unit: .day), y: .value("Earned", Double(last.cents) / 100))
                    .symbol {
                        Circle()
                            .fill(Theme.red)
                            .frame(width: 10, height: 10)
                            .overlay(Circle().stroke(Theme.ink.opacity(0.9), lineWidth: 2))
                            .shadow(color: Theme.red.opacity(0.9), radius: 6)
                    }
            }
        }
        .chartXScale(domain: dashboard.monthStart...max(dashboard.monthEnd, dashboard.monthStart))
        .chartYScale(domain: 0...max(peak * 1.12, 1))
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartLegend(.hidden)
        .accessibilityLabel("Running total for this month")
        .accessibilityValue(dashboard.currency.map { ManagerMoney.format(dashboard.earnedCents, currency: $0) } ?? "No money recorded")
    }

    private var currencyMenu: some View {
        Menu {
            Picker("Currency", selection: Binding(get: { dashboard.currency ?? "" }, set: { currency = $0 })) {
                ForEach(currencies, id: \.self) { Text($0).tag($0) }
            }
        } label: {
            HStack(spacing: 3) {
                Text(dashboard.currency ?? "")
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Theme.raised, in: Capsule())
        }
        .accessibilityLabel("Currency, \(dashboard.currency ?? "")")
    }

    private func axisLabel(_ date: Date) -> String {
        date.formatted(.dateTime.month(.abbreviated).day())
    }
}

private struct ChangeBadge: View {
    let change: Double

    var body: some View {
        let percent = Int((change * 100).rounded())
        let up = percent >= 0
        HStack(spacing: 4) {
            Image(systemName: up ? "arrow.up.right" : "arrow.down.right").font(.system(size: 11, weight: .bold))
            Text("\(up ? "+" : "")\(percent)%").font(.system(size: 13, weight: .semibold))
        }
        .foregroundStyle(up ? Theme.red : Theme.muted)
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(up ? Theme.red.opacity(0.18) : Theme.raised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityLabel("\(up ? "Up" : "Down") \(abs(percent)) percent on the same point last month")
    }
}

/// OWED TO YOU / PAID OUT.
struct ManagerStatCard: View {
    let title: String
    let amount: String
    let caption: String
    var captionColor: Color = Theme.muted
    let symbol: String
    let tint: Color

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: ManagerLayout.statIcon, height: ManagerLayout.statIcon)
                .background(tint.opacity(0.18), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Eyebrow(text: title)
                    .lineLimit(1).minimumScaleFactor(0.8)
                Text(amount)
                    .font(.rooster(24, weight: .bold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.55)
                Text(caption)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(captionColor)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .designCard(padding: 14)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Rows

struct ManagerShowRow: View {
    let show: ManagerShow
    let currency: String?
    var past = false

    var body: some View {
        NavigationLink(value: AppRoute.native(.managerRecord(id: show.id))) {
            HStack(spacing: 8) {
                ManagerDateBlock(date: show.date)
                ManagerArtTile(seed: show.id, symbol: "music.mic", size: ManagerLayout.showTile)
                VStack(alignment: .leading, spacing: 3) {
                    Text(show.headline)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                    if let detail = show.detail {
                        Text(detail).font(.system(size: 13)).foregroundStyle(Theme.muted).lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let fee = show.feeText(currency: currency) {
                    Text(fee)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .fixedSize(horizontal: fee.count < 10, vertical: false)
                }
                ManagerChevron()
            }
            .designCard(padding: 10, radius: ManagerLayout.rowRadius)
            .opacity(past ? 0.6 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel([show.headline, show.detail, show.date?.formatted(date: .long, time: .omitted), show.feeText(currency: currency)]
            .compactMap { $0 }.joined(separator: ", "))
    }
}

struct ManagerSplitSheetRow: View {
    let id: Int
    let sheet: SplitSheet

    var body: some View {
        NavigationLink(value: AppRoute.native(.managerRecord(id: id))) {
            HStack(spacing: 12) {
                ManagerArtTile(seed: id, symbol: "music.quarternote.3",
                               size: CGSize(width: ManagerLayout.sheetTile, height: ManagerLayout.sheetTile))
                VStack(alignment: .leading, spacing: 4) {
                    Text(sheet.songTitle)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Text(sheet.summaryLine)
                        .font(.system(size: 13))
                        .foregroundStyle(sheet.balanced ? Theme.muted : Theme.red)
                    ManagerSplitBar(shares: sheet.contributors.map(\.share))
                        .padding(.top, 4)
                        .padding(.trailing, 8)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                ManagerChevron()
            }
            .designCard(padding: 12, radius: ManagerLayout.rowRadius)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(sheet.songTitle) split sheet, \(sheet.contributors.map { "\($0.name) \($0.share.formatted())%" }.joined(separator: ", "))")
    }
}

/// A song, person, document or anything else saved to Manager, inside a grouped card.
struct ManagerRecordRow: View {
    let record: ManagerWorkspace.Record

    private var subtitle: String {
        switch record.kind {
        case "song":
            return [record.field("artist"), record.field("isrc")].compactMap { $0 }.joined(separator: " · ").nilIfEmpty ?? "Song"
        case "person":
            return [record.field("role"), record.field("company")].compactMap { $0 }.joined(separator: " · ").nilIfEmpty ?? "Person"
        default:
            return record.kindLabel
        }
    }

    var body: some View {
        NavigationLink(value: AppRoute.native(.managerRecord(id: record.id))) {
            HStack(spacing: 12) {
                leading
                VStack(alignment: .leading, spacing: 2) {
                    Text(record.title?.nilIfEmpty ?? record.kindLabel)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Text(subtitle).font(.system(size: 13)).foregroundStyle(Theme.muted).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                ManagerChevron()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var leading: some View {
        if record.kind == "person" {
            Text(initials)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Theme.ink)
                .frame(width: 40, height: 40)
                .background(Theme.raised, in: Circle())
                .overlay(Circle().stroke(Theme.line))
                .accessibilityHidden(true)
        } else {
            Image(systemName: record.symbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.red)
                .frame(width: 40, height: 40)
                .background(Theme.red.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityHidden(true)
        }
    }

    private var initials: String {
        let words = (record.title ?? "").split(separator: " ").prefix(2)
        return words.compactMap { $0.first.map(String.init) }.joined().uppercased().nilIfEmpty ?? "?"
    }
}

/// A titled list of records in one card, or an honest empty card.
struct ManagerRecordSection: View {
    let title: String
    let records: [ManagerWorkspace.Record]
    let emptyTitle: String
    let emptyDetail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            DesignSectionHeader(title: title)
            if records.isEmpty {
                ManagerEmptyCard(title: emptyTitle, detail: emptyDetail)
            } else {
                ManagerGroupedCard {
                    ForEach(Array(records.enumerated()), id: \.element.id) { index, record in
                        ManagerRecordRow(record: record)
                        if index < records.count - 1 { ManagerHairline(inset: 66) }
                    }
                }
            }
        }
    }
}

// MARK: - Money

/// Totals per currency, by payer, by song, every entry with a filter, and the CSV export.
/// The Money segment and the standalone My Money screen both use it.
struct ManagerMoneyPanel: View {
    let summary: ManagerMoney.Summary
    @Binding var currency: String?
    @State private var filter = "all"
    @State private var csv: CSVFile?

    private static let filters = ["all", "outstanding", "overdue", "paid"]

    var body: some View {
        let group = summary.groups.first { $0.currency == currency } ?? summary.groups.first
        let entries = summary.entries
            .filter { group == nil || $0.currency == group?.currency }
            .filter { filter == "all" || (filter == "outstanding" && $0.outstandingCents > 0) || (filter == "overdue" && $0.status == "overdue") || (filter == "paid" && $0.status == "paid") }
            .sorted { ($0.expectedDate.isEmpty ? "9999" : $0.expectedDate) < ($1.expectedDate.isEmpty ? "9999" : $1.expectedDate) }

        VStack(alignment: .leading, spacing: ManagerLayout.sectionGap) {
            if summary.groups.count > 1, let group {
                ManagerSegmented(options: summary.groups.map(\.currency), title: { $0 },
                                 selection: Binding(get: { group.currency }, set: { currency = $0 }))
            }

            if let group {
                totals(group)
                if !group.sources.isEmpty {
                    slices("By payer", group.sources.prefix(6), currency: group.currency)
                }
                let songs = group.songs.filter { !$0.label.isEmpty }
                if !songs.isEmpty {
                    slices("By song", songs.prefix(6), currency: group.currency)
                }
            } else {
                ManagerEmptyCard(title: "No income recorded yet.",
                                 detail: "Add what you're owed and what has been paid, and this adds it up for you.")
            }

            VStack(alignment: .leading, spacing: 12) {
                DesignSectionHeader(title: "Entries")
                ManagerSegmented(options: Self.filters, title: Self.filterTitle, selection: $filter)
                if entries.isEmpty {
                    ManagerEmptyCard(title: "Nothing here.", detail: filter == "all" ? "Money you add shows up here." : "No entries match this filter.")
                } else {
                    ManagerGroupedCard {
                        ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                            NavigationLink(value: AppRoute.native(.managerRecord(id: entry.id))) {
                                ManagerMoneyRow(entry: entry)
                            }
                            .buttonStyle(.plain)
                            if index < entries.count - 1 { ManagerHairline() }
                        }
                    }
                }
            }

            if summary.unrecognized > 0 {
                Text("\(summary.unrecognized) record\(summary.unrecognized == 1 ? "" : "s") could not be read. Open ROOSTER Manager on the web to check them.")
                    .font(.system(size: 13)).foregroundStyle(Theme.muted)
            }

            Button {
                csv = CSVFile(text: ManagerMoney.csv(summary.entries))
            } label: {
                Label("Export as a spreadsheet", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(.designGlass)
            .disabled(summary.entries.isEmpty)
            .opacity(summary.entries.isEmpty ? 0.5 : 1)
        }
        .sheet(item: $csv) { file in
            if let url = file.url { ShareSheet(items: [url]) }
        }
    }

    private static func filterTitle(_ value: String) -> String {
        switch value {
        case "outstanding": "Owed"
        case "overdue": "Past due"
        case "paid": "Paid"
        default: "All"
        }
    }

    private func totals(_ group: ManagerMoney.Group) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                figure("Recorded earnings", ManagerMoney.format(group.earnedCents, currency: group.currency), Theme.ink)
                figure("Paid to you", ManagerMoney.format(group.paidCents, currency: group.currency), Theme.green)
            }
            HStack(alignment: .top) {
                figure("Still owed", ManagerMoney.format(group.outstandingCents, currency: group.currency), Theme.red)
                figure("Entries", "\(group.count)", Theme.ink)
            }
            if group.overdueCents > 0 {
                Label("\(ManagerMoney.format(group.overdueCents, currency: group.currency)) is past its expected date",
                      systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.red)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .designCard(padding: 16)
    }

    private func figure(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Eyebrow(text: label)
            Text(value).font(.rooster(22, weight: .bold)).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func slices(_ title: String, _ slices: ArraySlice<ManagerMoney.Group.Slice>, currency: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            DesignSectionHeader(title: title)
            ManagerGroupedCard {
                ForEach(Array(slices.enumerated()), id: \.element.id) { index, slice in
                    HStack {
                        Text(slice.label.nilIfEmpty ?? "No song").font(.system(size: 15)).foregroundStyle(Theme.ink).lineLimit(1)
                        Spacer()
                        VStack(alignment: .trailing, spacing: 1) {
                            Text(ManagerMoney.format(slice.earnedCents, currency: currency))
                                .font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                            if slice.outstandingCents > 0 {
                                Text("\(ManagerMoney.format(slice.outstandingCents, currency: currency)) owed")
                                    .font(.system(size: 12)).foregroundStyle(Theme.red)
                            }
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 11)
                    .accessibilityElement(children: .combine)
                    if index < slices.count - 1 { ManagerHairline() }
                }
            }
        }
    }
}

struct ManagerMoneyRow: View {
    let entry: ManagerMoney.Entry

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.songTitle.nilIfEmpty ?? entry.title.nilIfEmpty ?? entry.source)
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                Text("\(entry.source) · \(entry.incomeType)").font(.system(size: 13)).foregroundStyle(Theme.muted).lineLimit(1)
                if !entry.expectedDate.isEmpty {
                    Text(entry.status == "paid" ? "Paid \(entry.paidDate.nilIfEmpty ?? "")" : "Expected \(entry.expectedDate)")
                        .font(.system(size: 12)).foregroundStyle(entry.status == "overdue" ? Theme.red : Theme.muted)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                Text(ManagerMoney.format(entry.earnedCents, currency: entry.currency))
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.ink)
                Text(entry.statusLabel)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(status)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(status.opacity(0.16), in: Capsule())
            }
            ManagerChevron()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var status: Color {
        switch entry.status {
        case "paid": Theme.green
        case "overdue": Theme.red
        case "part-paid": Theme.orange
        default: Theme.muted
        }
    }
}
