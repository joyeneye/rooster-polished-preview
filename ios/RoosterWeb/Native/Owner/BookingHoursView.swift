import SwiftUI

/// One day as the form edits it. The site stores minutes past midnight
/// (db/schema.ts:472-479), so that is what goes back.
struct DayHours: Identifiable, Hashable {
    let weekday: Int
    var open: Bool
    var start: Int
    var end: Int

    var id: Int { weekday }
    var makesSense: Bool { !open || end > start }
}

extension Array where Element == DayHours {
    /// Sunday first, the way the site orders and seeds them (booking-api.mts:158).
    static func week(from hours: [BookingHours]) -> [DayHours] {
        (0...6).map { weekday in
            let day = hours.first { $0.weekday == weekday }
            return DayHours(weekday: weekday,
                            open: day.map { $0.closed != true } ?? false,
                            start: day?.startMinute ?? 540,
                            end: day?.endMinute ?? 1020)
        }
    }
}

/// When a business is open. Until now these were set once, when the business was
/// created, and nothing could change them.
struct BookingHoursView: View {
    @ObservedObject var model: BookingDashboardModel
    @Environment(\.dismiss) private var dismiss
    @State private var week: [DayHours] = []
    @State private var notice: String?
    @State private var saving = false

    private static let names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

    var body: some View {
        List {
            Section {
                ForEach(week.indices, id: \.self) { index in
                    row(index)
                }
            } header: {
                Text("Your week")
            } footer: {
                Text("Clients can only book inside these hours.")
            }

            if let source = week.first(where: { $0.open }) {
                Section {
                    Button {
                        week = week.map { day in
                            day.open ? DayHours(weekday: day.weekday, open: true, start: source.start, end: source.end) : day
                        }
                    } label: {
                        Label("Give every open day these hours", systemImage: "arrow.triangle.2.circlepath")
                            .foregroundStyle(Theme.red)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .nativeScreenChrome("Opening hours")
        .notice($notice)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Save") { save() }
                    .bold()
                    .disabled(saving || !week.allSatisfy(\.makesSense))
            }
        }
        .task {
            await model.loadDetails()
            week = .week(from: model.hours)
        }
    }

    /// Writing straight into the state array by index. Handing each row a Binding element
    /// out of ForEach($week) rendered correctly but swallowed every tap.
    private func row(_ index: Int) -> some View {
        let day = week[index]
        return VStack(alignment: .leading, spacing: 6) {
            Toggle(isOn: Binding(get: { week[index].open }, set: { week[index].open = $0 })) {
                Text(Self.names[min(max(day.weekday, 0), 6)])
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.ink)
            }
            .tint(Theme.red)

            if day.open {
                HStack(spacing: 8) {
                    clock("Opens", Binding(get: { week[index].start }, set: { week[index].start = $0 }))
                    clock("Closes", Binding(get: { week[index].end }, set: { week[index].end = $0 }))
                }
                if !day.makesSense {
                    Text("This day closes before it opens.")
                        .font(.system(size: 12)).foregroundStyle(Theme.red)
                }
            } else {
                Text("Closed").font(.system(size: 13)).foregroundStyle(Theme.muted)
            }
        }
        .padding(.vertical, 2)
    }

    private func clock(_ title: String, _ minutes: Binding<Int>) -> some View {
        HStack(spacing: 6) {
            Text(title).font(.system(size: 13)).foregroundStyle(Theme.muted)
            DatePicker(title, selection: Binding(
                get: { Self.date(minutes.wrappedValue) },
                set: { minutes.wrappedValue = Self.minutes($0) }
            ), displayedComponents: .hourAndMinute)
            .labelsHidden()
            .tint(Theme.red)
        }
    }

    private func save() {
        saving = true
        let sent = week.map { day in
            BookingHours(id: day.weekday, weekday: day.weekday,
                         startMinute: day.start, endMinute: day.end, closed: !day.open)
        }
        Task {
            notice = await model.saveHours(sent) ?? "Saved."
            saving = false
            dismiss()
        }
    }

    private static func date(_ minutes: Int) -> Date {
        Calendar.current.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: Date()) ?? Date()
    }

    private static func minutes(_ date: Date) -> Int {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
    }
}
