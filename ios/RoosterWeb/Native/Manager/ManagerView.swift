import SwiftUI
import UniformTypeIdentifiers

enum ManagerTab: String, CaseIterable, Hashable {
    case overview, songs, shows, money

    var title: String {
        switch self {
        case .overview: "Overview"
        case .songs: "Songs"
        case .shows: "Shows"
        case .money: "Money"
        }
    }
}

private func loadWorkspace(_ api: FeedAPI, path: String) async throws -> ManagerWorkspace {
    #if DEBUG
    if let fixture = ManagerFixtures.workspace() { return fixture }
    #endif
    return try await api.get(path, as: ManagerWorkspace.self)
}

/// ROOSTER Manager, native: the artist's business at a glance. Overview charts this month's
/// money, what's owed and paid, the next shows and the split sheets; Songs, Shows and Money
/// hold the full lists. Everything is the member's own saved records.
struct ManagerView: View {
    let stack: ShellTab
    @StateObject private var workspace: Loadable<ManagerWorkspace>
    @State private var notice: String?
    /// The form the Add sheet opens on; nil when it is closed. An item sheet, so the sheet
    /// always reads the kind it was opened with.
    @State private var adding: AddRecordSheet.Kind?
    @State private var link: String?
    @State private var tab: ManagerTab = .overview
    @State private var currency: String?
    private let api: FeedAPI
    #if DEBUG
    @EnvironmentObject private var store: ShellStore
    #endif

    init(stack: ShellTab, api: FeedAPI) {
        self.stack = stack
        self.api = api
        _workspace = StateObject(wrappedValue: Loadable { try await loadWorkspace(api, path: "/api/rcm/workspace") })
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ScreenTitle(text: "Manager")
                ManagerSegmented(options: ManagerTab.allCases, title: \.title, selection: $tab)
                    .padding(.top, 12)
                LoadableContent(loadable: workspace) { value in
                    content(value)
                }
                .frame(minHeight: 120)
                .padding(.top, 16)
            }
            .padding(.horizontal, Design.gutter)
            .padding(.bottom, Design.tabBarClearance + ManagerLayout.fab)
        }
        .scrollIndicators(.hidden)
        .refreshable { await workspace.load() }
        .overlay(alignment: .bottomTrailing) {
            ManagerAddButton {
                adding = switch tab {
                case .shows: .show
                case .money: .income
                default: .song
                }
            }
                .padding(.trailing, Design.gutter)
                .padding(.bottom, Design.tabBarClearance - ManagerLayout.fabDrop)
        }
        .managerChrome("Manager")
        .notice($notice)
        .sheet(item: $adding) { kind in
            AddRecordSheet(api: api, kind: kind) {
                notice = "Saved to your Manager."
                Task { await workspace.load() }
            }
        }
        .opensSiteLinks($link, in: stack)
        #if DEBUG
        .task { openDebugState() }
        #endif
    }

    #if DEBUG
    /// Fixture captures only: `-ManagerTab songs|shows|money`, `-ManagerRecord <id>`,
    /// `-ManagerAdd song|show|person|split|income`.
    private func openDebugState() {
        guard NativeFixtures.enabled else { return }
        let defaults = UserDefaults.standard
        if let name = defaults.string(forKey: "ManagerTab"), let value = ManagerTab(rawValue: name) { tab = value }
        if let id = defaults.string(forKey: "ManagerRecord").flatMap(Int.init) {
            store.push(.native(.managerRecord(id: id)), in: stack)
        }
        if let name = defaults.string(forKey: "ManagerAdd"), let value = AddRecordSheet.Kind(rawValue: name) {
            adding = value
        }
    }
    #endif

    @ViewBuilder private func content(_ value: ManagerWorkspace) -> some View {
        let summary = ManagerMoney.summarize(value.records)
        let chosen = currency ?? ManagerDashboard.preferredCurrency(summary, records: value.records)
        switch tab {
        case .overview:
            overview(value, summary: summary, currency: chosen)
        case .songs:
            songs(value.records)
        case .shows:
            shows(value.records, currency: chosen)
        case .money:
            ManagerMoneyPanel(summary: summary, currency: Binding(get: { chosen }, set: { currency = $0 }))
        }
    }

    // MARK: Overview

    private func overview(_ value: ManagerWorkspace, summary: ManagerMoney.Summary, currency chosen: String?) -> some View {
        let dashboard = ManagerDashboard(summary: summary, records: value.records, currency: chosen)
        let upcoming = ManagerShow.split(value.records).upcoming
        let sheets = splitSheets(value.records)
        let people = value.records.filter { $0.kind == "person" }

        return VStack(alignment: .leading, spacing: 0) {
            ManagerEarningsCard(dashboard: dashboard, currencies: summary.groups.map(\.currency),
                                currency: Binding(get: { chosen }, set: { currency = $0 }))

            Button { tab = .money } label: {
            HStack(spacing: 12) {
                ManagerStatCard(title: "Owed to you",
                                amount: dashboard.currency.map { ManagerMoney.figure(dashboard.owedCents, currency: $0) } ?? "—",
                                caption: owedCaption(dashboard),
                                captionColor: dashboard.overdueCents > 0 ? Theme.red : Theme.muted,
                                symbol: "clock", tint: Theme.red)
                ManagerStatCard(title: "Paid out",
                                amount: dashboard.currency.map { ManagerMoney.figure(dashboard.paidCents, currency: $0) } ?? "—",
                                caption: "All time",
                                symbol: "dollarsign", tint: Theme.green)
            }
            }
            .buttonStyle(PressableStyle())
            .accessibilityHint("Opens Money")
            .padding(.top, 12)

            DesignSectionHeader(title: "Upcoming shows", action: "View all") { tab = .shows }
                .padding(.top, ManagerLayout.sectionGap)
            VStack(spacing: ManagerLayout.rowGap) {
                if upcoming.isEmpty {
                    ManagerEmptyCard(title: "No shows coming up.", detail: "Add a show with + Add and it lands here with its date and fee.")
                }
                ForEach(upcoming.prefix(2)) { ManagerShowRow(show: $0, currency: dashboard.currency) }
            }
            .padding(.top, 12)

            DesignSectionHeader(title: "Split sheets", action: sheets.count > 2 ? "View all" : nil) { tab = .songs }
                .padding(.top, ManagerLayout.sectionGap)
            VStack(spacing: ManagerLayout.rowGap) {
                if sheets.isEmpty {
                    ManagerEmptyCard(title: "No split sheets yet.", detail: "Agree who owns what on a song and keep the sheet here, ready as a PDF.")
                }
                ForEach(sheets.prefix(2)) { ManagerSplitSheetRow(id: $0.id, sheet: $0.sheet) }
            }
            .padding(.top, 12)

            if !people.isEmpty {
                DesignSectionHeader(title: "People", action: people.count > 3 ? "View all" : nil) { tab = .songs }
                    .padding(.top, ManagerLayout.sectionGap)
                ManagerGroupedCard {
                    ForEach(Array(people.prefix(3).enumerated()), id: \.element.id) { index, person in
                        ManagerRecordRow(record: person)
                        if index < min(people.count, 3) - 1 { ManagerHairline(inset: 66) }
                    }
                }
                .padding(.top, 12)
            }

            if let messages = value.messages, !messages.isEmpty {
                mona(messages)
                    .padding(.top, ManagerLayout.sectionGap)
            }
        }
    }

    private func owedCaption(_ dashboard: ManagerDashboard) -> String {
        guard let code = dashboard.currency else { return "Nothing recorded" }
        if dashboard.overdueCents > 0 { return "\(ManagerMoney.figure(dashboard.overdueCents, currency: code)) past due" }
        if dashboard.openCount > 0 { return "\(dashboard.openCount) unpaid" }
        return "All settled"
    }

    private func mona(_ messages: [ManagerWorkspace.ChatMessage]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            DesignSectionHeader(title: "Asked MONA")
            ManagerGroupedCard {
                ForEach(Array(messages.suffix(4).enumerated()), id: \.element.id) { index, message in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: message.role == "user" ? "person.fill" : "sparkles")
                            .font(.system(size: 13)).foregroundStyle(Theme.red).frame(width: 20)
                            .accessibilityLabel(message.role == "user" ? "You" : "MONA")
                        Text(message.content).font(.system(size: 14)).foregroundStyle(Theme.ink.opacity(0.9))
                        Spacer(minLength: 0)
                    }
                    .padding(14)
                    if index < min(messages.count, 4) - 1 { ManagerHairline() }
                }
            }
            Button { notice = "Asking MONA from the app is coming soon." } label: {
                Label("Ask MONA", systemImage: "sparkles")
            }
            .buttonStyle(.designGlass)
        }
    }

    // MARK: Songs, split sheets, documents, people

    /// Newest first.
    private func splitSheets(_ records: [ManagerWorkspace.Record]) -> [ManagerSheetItem] {
        records
            .sorted { ($0.updatedAt ?? "") > ($1.updatedAt ?? "") }
            .compactMap { record in SplitSheet(record).map { ManagerSheetItem(id: record.id, sheet: $0) } }
    }

    private func songs(_ records: [ManagerWorkspace.Record]) -> some View {
        let sheets = splitSheets(records)
        let songs = records.filter { $0.kind == "song" }
        let documents = records.filter { $0.kind == "document" && SplitSheet($0) == nil }
        let people = records.filter { $0.kind == "person" }
        let others = records.filter { !["royalty", "song", "show", "person", "document"].contains($0.kind) }

        return VStack(alignment: .leading, spacing: ManagerLayout.sectionGap) {
            ManagerRecordSection(title: "Songs", records: songs, emptyTitle: "No songs saved yet.",
                                 emptyDetail: "Keep each song's artist, collaborators and ISRC together with + Add.")
            VStack(alignment: .leading, spacing: 12) {
                DesignSectionHeader(title: "Split sheets")
                if sheets.isEmpty {
                    ManagerEmptyCard(title: "No split sheets yet.", detail: "Agree who owns what on a song and keep the sheet here, ready as a PDF.")
                }
                ForEach(sheets) { ManagerSplitSheetRow(id: $0.id, sheet: $0.sheet) }
            }
            if !documents.isEmpty {
                ManagerRecordSection(title: "Documents", records: documents, emptyTitle: "", emptyDetail: "")
            }
            ManagerRecordSection(title: "People", records: people, emptyTitle: "No people saved yet.",
                                 emptyDetail: "Producers, bookers, managers: keep their role and how to reach them.")
            if !others.isEmpty {
                ManagerRecordSection(title: "Other records", records: others, emptyTitle: "", emptyDetail: "")
            }
        }
    }

    // MARK: Shows

    private func shows(_ records: [ManagerWorkspace.Record], currency: String?) -> some View {
        let split = ManagerShow.split(records)
        return VStack(alignment: .leading, spacing: ManagerLayout.sectionGap) {
            VStack(alignment: .leading, spacing: 12) {
                DesignSectionHeader(title: "Upcoming")
                if split.upcoming.isEmpty {
                    ManagerEmptyCard(title: "No shows coming up.", detail: "Add a show with + Add and it lands here with its date and fee.")
                }
                ForEach(split.upcoming) { ManagerShowRow(show: $0, currency: currency) }
            }
            if !split.undated.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    DesignSectionHeader(title: "No date yet")
                    ForEach(split.undated) { ManagerShowRow(show: $0, currency: currency) }
                }
            }
            if !split.past.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    DesignSectionHeader(title: "Past shows")
                    ForEach(split.past) { ManagerShowRow(show: $0, currency: currency, past: true) }
                }
            }
        }
    }
}

struct ManagerSheetItem: Identifiable {
    let id: Int
    let sheet: SplitSheet
}

/// My Money on its own screen (the site's #money link): the same panel as the Money segment.
struct ManagerMoneyView: View {
    let stack: ShellTab
    @StateObject private var workspace: Loadable<ManagerWorkspace>
    @State private var currency: String?

    init(stack: ShellTab, api: FeedAPI) {
        self.stack = stack
        _workspace = StateObject(wrappedValue: Loadable { try await loadWorkspace(api, path: "/api/rcm/workspace?view=money") })
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenTitle(text: "Money")
                LoadableContent(loadable: workspace) { value in
                    let summary = ManagerMoney.summarize(value.records)
                    let chosen = currency ?? ManagerDashboard.preferredCurrency(summary, records: value.records)
                    ManagerMoneyPanel(summary: summary, currency: Binding(get: { chosen }, set: { currency = $0 }))
                }
                .frame(minHeight: 120)
            }
            .padding(.horizontal, Design.gutter)
            .padding(.bottom, Design.tabBarClearance)
        }
        .scrollIndicators(.hidden)
        .refreshable { await workspace.load() }
        .managerChrome("My Money")
    }
}

/// One saved record: income, song, show, person, or a split sheet with its PDF.
struct ManagerRecordView: View {
    let id: Int
    let stack: ShellTab
    @StateObject private var workspace: Loadable<ManagerWorkspace>
    @State private var pdf: URL?

    init(id: Int, stack: ShellTab, api: FeedAPI) {
        self.id = id
        self.stack = stack
        _workspace = StateObject(wrappedValue: Loadable { try await loadWorkspace(api, path: "/api/rcm/workspace") })
    }

    var body: some View {
        LoadableContent(loadable: workspace) { value in
            if let record = value.records.first(where: { $0.id == id }) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        VStack(alignment: .leading, spacing: 6) {
                            Eyebrow(text: record.kindLabel, color: Theme.red)
                            Text(record.title?.nilIfEmpty ?? record.kindLabel)
                                .font(.roosterDisplay(24, relativeTo: .title))
                                .foregroundStyle(Theme.ink)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityAddTraits(.isHeader)
                        }
                        if let sheet = SplitSheet(record) {
                            splitSheet(sheet)
                        } else if let entry = ManagerMoney.normalize(record, today: ManagerMoney.today()) {
                            money(entry)
                        } else {
                            if let show = ManagerShow(record) { showHeader(show) }
                            fields(record)
                        }
                    }
                    .padding(.horizontal, Design.gutter)
                    .padding(.top, 8)
                    .padding(.bottom, Design.tabBarClearance)
                }
                .scrollIndicators(.hidden)
            } else {
                ManagerEmptyCard(title: "That record is no longer here.", detail: "It may have been removed on the web.")
                    .padding(Design.gutter)
                    .frame(maxHeight: .infinity, alignment: .top)
            }
        }
        .nativeScreenChrome("Record")
        .sheet(item: $pdf) { url in ShareSheet(items: [url]) }
    }

    private func showHeader(_ show: ManagerShow) -> some View {
        HStack(spacing: 12) {
            ManagerDateBlock(date: show.date)
            VStack(alignment: .leading, spacing: 3) {
                Text(show.headline).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                if let date = show.date {
                    Text(date.formatted(date: .complete, time: .omitted)).font(.system(size: 13)).foregroundStyle(Theme.muted)
                }
            }
            Spacer(minLength: 0)
        }
        .designCard(padding: 12)
        .accessibilityElement(children: .combine)
    }

    private func money(_ entry: ManagerMoney.Entry) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                ManagerStatCard(title: "Earned", amount: ManagerMoney.format(entry.earnedCents, currency: entry.currency),
                                caption: entry.statusLabel, captionColor: entry.status == "overdue" ? Theme.red : Theme.muted,
                                symbol: "dollarsign", tint: Theme.green)
                ManagerStatCard(title: "Still owed", amount: ManagerMoney.format(entry.outstandingCents, currency: entry.currency),
                                caption: "Paid \(ManagerMoney.format(entry.paidCents, currency: entry.currency))",
                                symbol: "clock", tint: Theme.red)
            }
            table([("Payer", entry.source), ("Income type", entry.incomeType), ("Song", entry.songTitle),
                   ("Recorded earnings", ManagerMoney.format(entry.earnedCents, currency: entry.currency)),
                   ("Paid so far", ManagerMoney.format(entry.paidCents, currency: entry.currency)),
                   ("Still owed", ManagerMoney.format(entry.outstandingCents, currency: entry.currency)),
                   ("Expected", entry.expectedDate), ("Last payment", entry.paidDate),
                   ("Period", entry.period), ("Territory", entry.territory),
                   ("Statement reference", entry.statementReference), ("Notes", entry.notes)])
        }
    }

    private func fields(_ record: ManagerWorkspace.Record) -> some View {
        let rows: [(String, String)] = (record.data ?? [:]).sorted { $0.key < $1.key }.compactMap { key, value in
            guard key != "record_type", key != "document_type", let text = value.text?.nilIfEmpty else { return nil }
            return (key.replacingOccurrences(of: "_", with: " ").capitalized, text)
        }
        return table(rows)
    }

    @ViewBuilder private func table(_ rows: [(String, String)]) -> some View {
        let rows = rows.filter { !$0.1.isEmpty }
        if rows.isEmpty {
            ManagerEmptyCard(title: "Nothing else saved on this record.", detail: "Add details to it in ROOSTER Manager on the web.")
        } else {
            ManagerGroupedCard {
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    HStack(alignment: .top, spacing: 12) {
                        Text(row.0).font(.system(size: 14)).foregroundStyle(Theme.muted).frame(width: 126, alignment: .leading)
                        Text(row.1).font(.system(size: 15)).foregroundStyle(Theme.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 11)
                    .accessibilityElement(children: .combine)
                    if index < rows.count - 1 { ManagerHairline() }
                }
            }
        }
    }

    private func splitSheet(_ sheet: SplitSheet) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top) {
                    meta("Main artist", sheet.artist.nilIfEmpty ?? "—")
                    meta("Date", sheet.date.nilIfEmpty ?? "—")
                    meta("Total", "\(sheet.total.formatted(.number.precision(.fractionLength(0...2))))%",
                         color: sheet.balanced ? Theme.ink : Theme.red)
                }
                ManagerSplitBar(shares: sheet.contributors.map(\.share), height: 10)
                VStack(spacing: 0) {
                    ForEach(Array(sheet.contributors.enumerated()), id: \.offset) { index, person in
                        HStack(spacing: 10) {
                            Circle().fill(ManagerSplitBar.color(index)).frame(width: 10, height: 10).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(person.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                                if !person.role.isEmpty {
                                    Text(person.role).font(.system(size: 13)).foregroundStyle(Theme.muted)
                                }
                            }
                            Spacer()
                            Text("\(person.share.formatted(.number.precision(.fractionLength(0...2))))%")
                                .font(.rooster(18, weight: .bold)).foregroundStyle(Theme.ink)
                        }
                        .padding(.vertical, 10)
                        .accessibilityElement(children: .combine)
                        if index < sheet.contributors.count - 1 { ManagerHairline(inset: 20) }
                    }
                }
                if !sheet.balanced {
                    Text("These shares add up to \(sheet.total.formatted(.number.precision(.fractionLength(0...2))))%, not 100%.")
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.red)
                }
            }
            .designCard(padding: 16)

            Button {
                pdf = SplitSheetPDF.write(sheet)
            } label: {
                Label("Download PDF", systemImage: "arrow.down.doc.fill")
            }
            .buttonStyle(.designPrimary)
            Text("A business organization tool, not legal advice.").font(.system(size: 12)).foregroundStyle(Theme.muted)
        }
    }

    private func meta(_ label: String, _ value: String, color: Color = Theme.ink) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Eyebrow(text: label)
            Text(value).font(.system(size: 15, weight: .semibold)).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// The printed split sheet (rcm.js:467-493).
struct SplitSheetDocument: View {
    let sheet: SplitSheet
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 12 : 22) {
            HStack {
                Text("Song Split Sheet").font(.rooster(compact ? 20 : 26)).foregroundStyle(.black)
                Spacer()
                Text("ROOSTER").font(.system(size: compact ? 14 : 18, weight: .black)).foregroundStyle(.black)
            }
            HStack(alignment: .top, spacing: 20) {
                meta("Song title", sheet.songTitle)
                meta("Main artist", sheet.artist.nilIfEmpty ?? "—")
                meta("Date", sheet.date.nilIfEmpty ?? "—")
            }
            VStack(spacing: 0) {
                HStack {
                    Text("Contributor").frame(maxWidth: .infinity, alignment: .leading)
                    Text("Role").frame(width: compact ? 90 : 140, alignment: .leading)
                    Text("Ownership").frame(width: compact ? 80 : 110, alignment: .trailing)
                }
                .font(.system(size: compact ? 12 : 13, weight: .bold))
                .foregroundStyle(.black)
                .padding(.vertical, 6)
                Divider().background(.black)
                ForEach(sheet.contributors) { person in
                    HStack {
                        Text(person.name).frame(maxWidth: .infinity, alignment: .leading)
                        Text(person.role).frame(width: compact ? 90 : 140, alignment: .leading)
                        Text("\(person.share.formatted(.number.precision(.fractionLength(0...2))))%")
                            .frame(width: compact ? 80 : 110, alignment: .trailing)
                    }
                    .font(.system(size: compact ? 13 : 14))
                    .foregroundStyle(.black)
                    .padding(.vertical, 6)
                    Divider()
                }
            }
            Text("Total ownership: \(sheet.total.formatted(.number.precision(.fractionLength(0...2))))%")
                .font(.system(size: compact ? 13 : 15, weight: .bold)).foregroundStyle(.black)
            if !compact {
                Text("We confirm that the information above accurately represents the ownership percentages agreed for this composition.")
                    .font(.system(size: 13)).foregroundStyle(.black)
                VStack(alignment: .leading, spacing: 26) {
                    ForEach(sheet.contributors) { person in
                        VStack(alignment: .leading, spacing: 4) {
                            Divider().background(.black)
                            Text("\(person.name) — signature / date").font(.system(size: 12)).foregroundStyle(.black)
                        }
                    }
                }
                Spacer()
                Text("Created with ROOSTER Manager. This template is a business organization tool and is not legal advice.")
                    .font(.system(size: 10)).foregroundStyle(.black.opacity(0.7))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func meta(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: compact ? 10 : 11)).foregroundStyle(.black.opacity(0.6))
            Text(value).font(.system(size: compact ? 14 : 15, weight: .bold)).foregroundStyle(.black)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

enum SplitSheetPDF {
    @MainActor
    static func write(_ sheet: SplitSheet) -> URL? {
        let page = CGRect(x: 0, y: 0, width: 612, height: 792)
        let renderer = ImageRenderer(content:
            SplitSheetDocument(sheet: sheet)
                .padding(48)
                .frame(width: page.width, height: page.height)
                .background(.white)
        )
        let name = sheet.songTitle.replacingOccurrences(of: "/", with: "-").nilIfEmpty ?? "Split sheet"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(name) split sheet.pdf")
        var box = page
        guard let consumer = CGDataConsumer(url: url as CFURL),
              let context = CGContext(consumer: consumer, mediaBox: &box, nil) else { return nil }
        renderer.render { _, draw in
            context.beginPDFPage(nil)
            draw(context)
            context.endPDFPage()
            context.closePDF()
        }
        return url
    }
}

/// The money export, written to a file so it can be shared or saved.
struct CSVFile: Identifiable {
    let text: String
    var id: String { text }

    var url: URL? {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("ROOSTER-My-Money.csv")
        try? text.data(using: .utf8)?.write(to: url, options: .atomic)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
