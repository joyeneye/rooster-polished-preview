#if DEBUG
import Foundation

/// Debug-only Manager data, loaded only with -RoosterFixtures. It adds to the shared fixture
/// workspace: money dated through this month and last month (so the chart and the change badge
/// have something real to compute from), shows either side of today, and more split sheets.
/// Every date is relative to today so the capture never goes stale.
enum ManagerFixtures {
    static func workspace(now: Date = .now) -> ManagerWorkspace? {
        guard NativeFixtures.enabled, let base = NativeFixtures.workspace() else { return nil }
        // -ManagerEmpty YES: a brand-new member's Manager, to check every empty state.
        if UserDefaults.standard.bool(forKey: "ManagerEmpty") {
            return ManagerWorkspace(records: [], truncated: false, messages: [])
        }
        let calendar = ManagerDates.calendar
        let today = calendar.startOfDay(for: now)
        let monthStart = calendar.dateInterval(of: .month, for: today)?.start ?? today
        let lastMonthStart = calendar.date(byAdding: .month, value: -1, to: monthStart) ?? monthStart
        let todayNumber = calendar.component(.day, from: today)

        func day(_ number: Int, of month: Date) -> String {
            ManagerDates.string(calendar.date(byAdding: .day, value: number - 1, to: month) ?? month)
        }
        func offset(_ days: Int) -> String {
            ManagerDates.string(calendar.date(byAdding: .day, value: days, to: today) ?? today)
        }

        // (day of month, payer, type, song, earned cents, paid cents)
        let thisMonth: [(Int, String, String, String, Int, Int)] = [
            (1, "DistroKid", "Streaming", "Late Checkout", 64_000, 64_000),
            (3, "Songtrust", "Publishing", "Late Checkout", 128_000, 128_000),
            (6, "Warehouse Live", "Shows", "", 250_000, 250_000),
            (9, "BMI", "Performance", "Southside Summer", 41_000, 41_000),
            (12, "Musicbed", "Sync", "Southside Summer", 180_000, 90_000),
            (15, "Bandcamp", "Sales", "Late Checkout", 23_500, 23_500),
            (18, "White Oak Music Hall", "Shows", "", 200_000, 0),
            (21, "DistroKid", "Streaming", "Southside Summer", 51_000, 0)
        ].filter { $0.0 <= todayNumber }
        let lastMonth: [(Int, String, String, String, Int, Int)] = [
            (2, "DistroKid", "Streaming", "Late Checkout", 82_000, 82_000),
            (8, "Songtrust", "Publishing", "Late Checkout", 196_000, 196_000),
            (14, "Continental Club", "Shows", "", 280_000, 280_000),
            (19, "BMI", "Performance", "Southside Summer", 98_000, 98_000),
            (27, "Bandcamp", "Sales", "Late Checkout", 21_000, 21_000)
        ]

        var json: [String] = []
        var id = 100
        func money(_ row: (Int, String, String, String, Int, Int), month: Date) -> String {
            id += 1
            let date = day(row.0, of: month)
            return """
            {"id": \(id), "kind": "royalty", "title": "\(row.1)", "status": "open", "updated_at": "\(date)T12:00:00Z",
             "data": {"record_type": "money-v1", "song_title": "\(row.3)", "source": "\(row.1)", "income_type": "\(row.2)", "currency": "USD",
                      "earned_cents": \(row.4), "paid_cents": \(row.5), "expected_date": "\(date)", "paid_date": "\(row.5 > 0 ? date : "")"}}
            """
        }
        json += thisMonth.map { money($0, month: monthStart) }
        json += lastMonth.map { money($0, month: lastMonthStart) }

        // (days from today, name, venue, city, fee)
        let shows: [(Int, String, String, String, String)] = [
            (11, "Southside Summer release show", "Numbers Nightclub", "Houston", "2500"),
            (25, "Dallas headline", "Deep Ellum Art Co.", "Dallas", "1800"),
            (41, "Austin showcase", "Mohawk", "Austin", "Door split"),
            (-9, "Warehouse Live support slot", "Warehouse Live", "Houston", "2500")
        ]
        json += shows.map { show in
            id += 1
            return """
            {"id": \(id), "kind": "show", "title": "\(show.1)", "status": "open", "due_at": "\(offset(show.0))T12:00:00.000Z", "updated_at": "\(offset(-3))T12:00:00Z",
             "data": {"title": "\(show.1)", "date": "\(offset(show.0))", "venue": "\(show.2)", "city": "\(show.3)", "fee": "\(show.4)", "contact": "Marcus Lane", "notes": ""}}
            """
        }

        json += ["""
        {"id": 140, "kind": "song", "title": "Southside Summer", "status": "open", "updated_at": "\(offset(-6))T12:00:00Z",
         "data": {"title": "Southside Summer", "artist": "Nia Carter", "collaborators": "Dre Wallace", "isrc": "USRC17607840", "notes": ""}}
        """, """
        {"id": 141, "kind": "song", "title": "Midnight Drive", "status": "open", "updated_at": "\(offset(-2))T12:00:00Z",
         "data": {"title": "Midnight Drive", "artist": "Nia Carter", "collaborators": "Marcus Lane, Tasha Monroe", "isrc": "", "notes": "Mix v3 back Friday."}}
        """, """
        {"id": 142, "kind": "document", "title": "Southside Summer Split Sheet", "status": "open", "updated_at": "\(offset(-5))T12:00:00Z",
         "data": {"document_type": "split-sheet", "song_title": "Southside Summer", "artist": "Nia Carter", "date": "\(offset(-5))",
                  "contributors": [{"name": "Nia Carter", "role": "Writer", "share": 60}, {"name": "Dre Wallace", "role": "Writer", "share": 40}]}}
        """, """
        {"id": 143, "kind": "document", "title": "Midnight Drive Split Sheet", "status": "open", "updated_at": "\(offset(-1))T12:00:00Z",
         "data": {"document_type": "split-sheet", "song_title": "Midnight Drive", "artist": "Nia Carter", "date": "\(offset(-1))",
                  "contributors": [{"name": "Nia Carter", "role": "Writer", "share": 40}, {"name": "Marcus Lane", "role": "Producer", "share": 25},
                                   {"name": "Tasha Monroe", "role": "Writer", "share": 20}, {"name": "Dre Wallace", "role": "Writer", "share": 15}]}}
        """, """
        {"id": 144, "kind": "person", "title": "Tasha Monroe", "status": "open", "updated_at": "\(offset(-4))T12:00:00Z",
         "data": {"name": "Tasha Monroe", "role": "Photographer", "company": "", "email": "tasha@example.com", "phone": "", "notes": ""}}
        """]

        let text = "[" + json.joined(separator: ",") + "]"
        guard let extra = try? FeedAPI.decoder.decode([ManagerWorkspace.Record].self, from: Data(text.utf8)) else {
            assertionFailure("Manager fixtures did not decode")
            return base
        }
        return ManagerWorkspace(records: base.records + extra, truncated: base.truncated, messages: base.messages)
    }
}
#endif
