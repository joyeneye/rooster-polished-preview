import SwiftUI
import UniformTypeIdentifiers

/// ROOSTER Manager, native: the money you're owed, the things you've saved, split sheets.
/// Saving records and asking MONA are writes, so they are coming soon.
struct ManagerView: View {
    let stack: ShellTab
    @StateObject private var workspace: Loadable<ManagerWorkspace>
    @State private var notice: String?
    @State private var link: String?

    init(stack: ShellTab, api: FeedAPI) {
        self.stack = stack
        _workspace = StateObject(wrappedValue: Loadable {
            #if DEBUG
            if let fixture = NativeFixtures.workspace() { return fixture }
            #endif
            return try await api.get("/api/rcm/workspace", as: ManagerWorkspace.self)
        })
    }

    var body: some View {
        LoadableContent(loadable: workspace) { value in
            let summary = ManagerMoney.summarize(value.records)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("THE BUSINESS BEHIND YOUR WORK").font(.roosterMono(10)).tracking(1.2).foregroundStyle(Theme.red)
                        Text("ROOSTER Manager").font(.rooster(28)).foregroundStyle(Theme.ink)
                        Text("Your private records. Nobody else on ROOSTER can see them.")
                            .font(.system(size: 15)).foregroundStyle(Theme.muted)
                    }
                    .padding(.horizontal, 20)

                    NavigationLink(value: AppRoute.native(.managerMoney)) {
                        MoneyCard(summary: summary)
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 16)

                    stuff(value.records)

                    if let messages = value.messages, !messages.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionHeading(eyebrow: "AI MANAGER", title: "Your last questions").padding(.horizontal, 20)
                            ForEach(messages.suffix(4)) { message in
                                HStack(alignment: .top, spacing: 10) {
                                    Image(systemName: message.role == "user" ? "person.fill" : "sparkles")
                                        .font(.system(size: 13)).foregroundStyle(Theme.red).frame(width: 20)
                                    Text(message.content).font(.system(size: 14)).foregroundStyle(Theme.ink.opacity(0.9))
                                    Spacer(minLength: 0)
                                }
                                .padding(12)
                                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                                .padding(.horizontal, 16)
                            }
                            Button { notice = "Asking MONA from the app is coming soon." } label: {
                                Label("Ask MONA", systemImage: "sparkles")
                                    .font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.red)
                                    .frame(maxWidth: .infinity, minHeight: 46)
                                    .overlay(Capsule().stroke(Theme.red.opacity(0.4)))
                            }
                            .padding(.horizontal, 16)
                        }
                    }

                    Text("Add a song, show, person, split sheet or income from the ROOSTER Manager on the web while saving from the app is coming.")
                        .font(.system(size: 13)).foregroundStyle(Theme.muted).padding(.horizontal, 20).padding(.bottom, 24)
                }
                .padding(.top, 10)
            }
            .refreshable { await workspace.load() }
        }
        .nativeScreenChrome("ROOSTER Manager")
        .notice($notice)
        .opensSiteLinks($link, in: stack)
    }

    private func stuff(_ records: [ManagerWorkspace.Record]) -> some View {
        let saved = records.filter { $0.kind != "royalty" }
        return VStack(alignment: .leading, spacing: 10) {
            SectionHeading(eyebrow: "MY STUFF", title: "Saved records", trailing: saved.isEmpty ? nil : "\(saved.count)")
                .padding(.horizontal, 20)
            if saved.isEmpty {
                Text("Nothing saved yet.").font(.system(size: 15)).foregroundStyle(Theme.muted).padding(.horizontal, 20)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(saved.enumerated()), id: \.element.id) { index, record in
                        NavigationLink(value: AppRoute.native(.managerRecord(id: record.id))) {
                            HStack(spacing: 12) {
                                Image(systemName: record.symbol).font(.system(size: 16)).foregroundStyle(Theme.red).frame(width: 30)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(record.title?.nilIfEmpty ?? record.kindLabel)
                                        .font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                                    Text(record.kindLabel).font(.system(size: 13)).foregroundStyle(Theme.muted)
                                }
                                Spacer()
                                Image(systemName: "chevron.forward").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted.opacity(0.7))
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if index < saved.count - 1 { Divider().padding(.leading, 56) }
                    }
                }
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .padding(.horizontal, 16)
            }
        }
    }
}

private struct MoneyCard: View {
    let summary: ManagerMoney.Summary

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("MY MONEY").font(.roosterMono(10)).tracking(1.2).foregroundStyle(.white.opacity(0.75))
                Spacer()
                Image(systemName: "chevron.forward").font(.system(size: 13, weight: .bold)).foregroundStyle(.white.opacity(0.8))
            }
            if let group = summary.groups.first {
                HStack(alignment: .firstTextBaseline) {
                    figure("Recorded", ManagerMoney.format(group.earnedCents, currency: group.currency))
                    figure("Paid", ManagerMoney.format(group.paidCents, currency: group.currency))
                    figure("Still owed", ManagerMoney.format(group.outstandingCents, currency: group.currency))
                }
                if group.overdueCents > 0 {
                    Label("\(ManagerMoney.format(group.overdueCents, currency: group.currency)) past due",
                          systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.gold)
                }
                if summary.groups.count > 1 {
                    Text("Plus \(summary.groups.count - 1) other currenc\(summary.groups.count == 2 ? "y" : "ies")")
                        .font(.system(size: 12)).foregroundStyle(.white.opacity(0.7))
                }
            } else {
                Text("No income recorded yet.").font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                Text("Add what you're owed and what has been paid, and this adds it up for you.")
                    .font(.system(size: 13)).foregroundStyle(.white.opacity(0.75))
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LinearGradient(colors: [Color(hex: 0x2A0E17), Color(hex: 0x6E0B24)], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func figure(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.rooster(20)).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// My Money: totals, what's owed, and every entry, per currency.
struct ManagerMoneyView: View {
    let stack: ShellTab
    @StateObject private var workspace: Loadable<ManagerWorkspace>
    @State private var currency: String?
    @State private var filter = "all"
    @State private var csv: CSVFile?

    init(stack: ShellTab, api: FeedAPI) {
        self.stack = stack
        _workspace = StateObject(wrappedValue: Loadable {
            #if DEBUG
            if let fixture = NativeFixtures.workspace() { return fixture }
            #endif
            return try await api.get("/api/rcm/workspace?view=money", as: ManagerWorkspace.self)
        })
    }

    var body: some View {
        LoadableContent(loadable: workspace) { value in
            let summary = ManagerMoney.summarize(value.records)
            let group = summary.groups.first { $0.currency == currency } ?? summary.groups.first
            let entries = summary.entries
                .filter { group == nil || $0.currency == group?.currency }
                .filter { filter == "all" || (filter == "outstanding" && $0.outstandingCents > 0) || (filter == "overdue" && $0.status == "overdue") || (filter == "paid" && $0.status == "paid") }
                .sorted { ($0.expectedDate.isEmpty ? "9999" : $0.expectedDate) < ($1.expectedDate.isEmpty ? "9999" : $1.expectedDate) }

            List {
                if let group {
                    Section {
                        totals(group)
                    } header: {
                        if summary.groups.count > 1 {
                            Picker("Currency", selection: Binding(get: { group.currency }, set: { currency = $0 })) {
                                ForEach(summary.groups) { Text($0.currency).tag($0.currency) }
                            }
                            .pickerStyle(.segmented)
                            .textCase(nil)
                        }
                    }
                    if !group.sources.isEmpty {
                        Section("By payer") { ForEach(group.sources.prefix(6)) { slice(($0), currency: group.currency) } }
                    }
                    if !group.songs.filter({ !$0.label.isEmpty }).isEmpty {
                        Section("By song") { ForEach(group.songs.filter { !$0.label.isEmpty }.prefix(6)) { slice($0, currency: group.currency) } }
                    }
                }
                Section {
                    Picker("Show", selection: $filter) {
                        Text("All").tag("all")
                        Text("Owed").tag("outstanding")
                        Text("Past due").tag("overdue")
                        Text("Paid").tag("paid")
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)

                    if entries.isEmpty {
                        Text("Nothing here.").font(.system(size: 15)).foregroundStyle(Theme.muted)
                    }
                    ForEach(entries) { entry in
                        NavigationLink(value: AppRoute.native(.managerRecord(id: entry.id))) {
                            MoneyRow(entry: entry)
                        }
                    }
                }
                if summary.unrecognized > 0 {
                    Section {
                        Text("\(summary.unrecognized) record\(summary.unrecognized == 1 ? "" : "s") could not be read. Open ROOSTER Manager on the web to check them.")
                            .font(.system(size: 13)).foregroundStyle(Theme.muted)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .refreshable { await workspace.load() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        csv = CSVFile(text: ManagerMoney.csv(summary.entries))
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .disabled(summary.entries.isEmpty)
                    .accessibilityLabel("Export as a spreadsheet")
                }
            }
            .sheet(item: $csv) { file in
                if let url = file.url {
                    ShareSheet(items: [url])
                }
            }
        }
        .nativeScreenChrome("My Money")
    }

    private func totals(_ group: ManagerMoney.Group) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                figure("Recorded earnings", ManagerMoney.format(group.earnedCents, currency: group.currency), Theme.ink)
                figure("Paid to you", ManagerMoney.format(group.paidCents, currency: group.currency), Color(hex: 0x2F7A45))
            }
            HStack {
                figure("Still owed", ManagerMoney.format(group.outstandingCents, currency: group.currency), Theme.red)
                figure("Entries", "\(group.count)", Theme.muted)
            }
            if group.overdueCents > 0 {
                Label("\(ManagerMoney.format(group.overdueCents, currency: group.currency)) is past its expected date",
                      systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.red)
            }
        }
        .padding(.vertical, 4)
    }

    private func figure(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.rooster(22)).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func slice(_ slice: ManagerMoney.Group.Slice, currency: String) -> some View {
        HStack {
            Text(slice.label.nilIfEmpty ?? "No song").font(.system(size: 15)).foregroundStyle(Theme.ink).lineLimit(1)
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                Text(ManagerMoney.format(slice.earnedCents, currency: currency)).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                if slice.outstandingCents > 0 {
                    Text("\(ManagerMoney.format(slice.outstandingCents, currency: currency)) owed")
                        .font(.system(size: 12)).foregroundStyle(Theme.red)
                }
            }
        }
    }
}

private struct MoneyRow: View {
    let entry: ManagerMoney.Entry

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.songTitle.nilIfEmpty ?? entry.title.nilIfEmpty ?? entry.source)
                    .font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                Text("\(entry.source) · \(entry.incomeType)").font(.system(size: 13)).foregroundStyle(Theme.muted).lineLimit(1)
                if !entry.expectedDate.isEmpty {
                    Text(entry.status == "paid" ? "Paid \(entry.paidDate.nilIfEmpty ?? "")" : "Expected \(entry.expectedDate)")
                        .font(.system(size: 12)).foregroundStyle(entry.status == "overdue" ? Theme.red : Theme.muted)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 3) {
                Text(ManagerMoney.format(entry.earnedCents, currency: entry.currency))
                    .font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.ink)
                Text(entry.statusLabel)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(status)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(status.opacity(0.12), in: Capsule())
            }
        }
        .padding(.vertical, 2)
    }

    private var status: Color {
        switch entry.status {
        case "paid": Color(hex: 0x2F7A45)
        case "overdue": Theme.red
        case "part-paid": Theme.orange
        default: Theme.muted
        }
    }
}

/// One saved record: income, song, show, person or a split sheet with its PDF.
struct ManagerRecordView: View {
    let id: Int
    let stack: ShellTab
    @StateObject private var workspace: Loadable<ManagerWorkspace>
    @State private var pdf: URL?

    init(id: Int, stack: ShellTab, api: FeedAPI) {
        self.id = id
        self.stack = stack
        _workspace = StateObject(wrappedValue: Loadable {
            #if DEBUG
            if let fixture = NativeFixtures.workspace() { return fixture }
            #endif
            return try await api.get("/api/rcm/workspace", as: ManagerWorkspace.self)
        })
    }

    var body: some View {
        LoadableContent(loadable: workspace) { value in
            if let record = value.records.first(where: { $0.id == id }) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(record.kindLabel.uppercased()).font(.roosterMono(10)).tracking(1.2).foregroundStyle(Theme.red)
                            Text(record.title?.nilIfEmpty ?? record.kindLabel).font(.rooster(26)).foregroundStyle(Theme.ink)
                        }
                        if let sheet = SplitSheet(record) {
                            splitSheet(sheet)
                        } else {
                            fields(record)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                }
            } else {
                Text("That record is no longer here.").font(.system(size: 15)).foregroundStyle(Theme.muted)
            }
        }
        .nativeScreenChrome("Record")
        .sheet(item: $pdf) { url in ShareSheet(items: [url]) }
    }

    private func fields(_ record: ManagerWorkspace.Record) -> some View {
        let money = ManagerMoney.normalize(record, today: ManagerMoney.today())
        let rows: [(String, String)] = money.map { entry in
            [("Payer", entry.source), ("Income type", entry.incomeType),
             ("Recorded earnings", ManagerMoney.format(entry.earnedCents, currency: entry.currency)),
             ("Paid so far", ManagerMoney.format(entry.paidCents, currency: entry.currency)),
             ("Still owed", ManagerMoney.format(entry.outstandingCents, currency: entry.currency)),
             ("Expected", entry.expectedDate), ("Last payment", entry.paidDate),
             ("Period", entry.period), ("Territory", entry.territory),
             ("Statement reference", entry.statementReference), ("Notes", entry.notes)]
        } ?? (record.data ?? [:]).sorted { $0.key < $1.key }.compactMap { key, value in
            guard key != "record_type", key != "document_type", let text = value.text?.nilIfEmpty else { return nil }
            return (key.replacingOccurrences(of: "_", with: " ").capitalized, text)
        }
        return VStack(spacing: 0) {
            ForEach(rows.filter { !$0.1.isEmpty }, id: \.0) { label, value in
                HStack(alignment: .top) {
                    Text(label).font(.system(size: 14)).foregroundStyle(Theme.muted).frame(width: 130, alignment: .leading)
                    Text(value).font(.system(size: 15)).foregroundStyle(Theme.ink).frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, 10)
                Divider()
            }
        }
        .padding(.horizontal, 14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func splitSheet(_ sheet: SplitSheet) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            SplitSheetDocument(sheet: sheet, compact: true)
                .padding(16)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            Button {
                pdf = SplitSheetPDF.write(sheet)
            } label: {
                Label("Download PDF", systemImage: "arrow.down.doc.fill")
                    .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(Theme.red, in: Capsule())
            }
            .buttonStyle(PressableStyle())
            Text("A business organization tool, not legal advice.").font(.system(size: 12)).foregroundStyle(Theme.muted)
        }
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
