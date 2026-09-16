import SwiftUI

/// The business owner's side of ROOSTER Booking (booking-api.mts:118-480).
struct BookingAccount: Decodable {
    struct Business: Decodable, Hashable, Identifiable {
        let id: Int
        let slug: String
        let name: String
        let published: Bool?
        let currency: String?
        let stripeChargesEnabled: Bool?
        let role: String?
    }
    let businesses: [Business]
}

struct BookingDashboard: Decodable {
    struct Metrics: Decodable {
        let todayAppointments: Int?
        let upcomingAppointments: Int?
        let todayRevenueCents: Int?
        let monthRevenueCents: Int?
        let clients: Int?
        let rating: Double?
    }
    struct Row: Decodable, Hashable, Identifiable {
        let appointment: Appointment
        let serviceName: String?
        let staffName: String?
        let clientName: String?
        let clientEmail: String?
        let clientPhone: String?
        var id: Int { appointment.id }
    }
    struct Appointment: Decodable, Hashable {
        let id: Int
        let publicId: String?
        let confirmationCode: String?
        let status: String
        let startsAt: String
        let endsAt: String?
        let priceCents: Int?
        let notes: String?
    }
    let business: BookingAccount.Business?
    let metrics: Metrics?
    let upcoming: [Row]
}

struct BookingAppointments: Decodable { let appointments: [BookingDashboard.Row] }

struct BookingClients: Decodable {
    struct Client: Decodable, Hashable, Identifiable {
        let id: Int
        let name: String?
        let email: String?
        let phone: String?
        let appointmentCount: Int?
        let totalSpendCents: Int?
        let nextAppointmentAt: String?
    }
    let clients: [Client]
}

struct BookingServices: Decodable {
    let services: [BookingService]
    let staff: [BookingStaff]
}

@MainActor
final class BookingDashboardModel: ObservableObject {
    @Published private(set) var account: BookingAccount?
    @Published var business: BookingAccount.Business?
    @Published private(set) var dashboard: BookingDashboard?
    @Published private(set) var appointments: [BookingDashboard.Row] = []
    @Published private(set) var clients: [BookingClients.Client] = []
    @Published private(set) var services: BookingServices?
    @Published private(set) var failure: FeedError?
    @Published var busy = false

    private let api: FeedAPI

    init(api: FeedAPI) { self.api = api }

    func load() async {
        #if DEBUG
        if let fixture = NativeFixtures.bookingAccount() {
            account = fixture
            business = fixture.businesses.first
            await loadBusiness()
            return
        }
        #endif
        do {
            let account = try await api.get("/api/booking/me", as: BookingAccount.self)
            self.account = account
            // A business you own comes back twice (booking-api.mts:157).
            var seen = Set<Int>()
            let unique = account.businesses.filter { seen.insert($0.id).inserted }
            business = unique.first { $0.id == business?.id } ?? unique.first
            failure = nil
            await loadBusiness()
        } catch let error as FeedError {
            failure = error
        } catch {
            failure = .failed("ROOSTER could not connect.")
        }
    }

    var uniqueBusinesses: [BookingAccount.Business] {
        var seen = Set<Int>()
        return (account?.businesses ?? []).filter { seen.insert($0.id).inserted }
    }

    func loadBusiness() async {
        guard let id = business?.id else { return }
        #if DEBUG
        if NativeFixtures.enabled {
            dashboard = NativeFixtures.bookingDashboard()
            appointments = NativeFixtures.bookingAppointments()?.appointments ?? []
            clients = NativeFixtures.bookingClients()?.clients ?? []
            services = NativeFixtures.bookingServices()
            return
        }
        #endif
        async let dashboard = try? api.get("/api/booking/dashboard?businessId=\(id)", as: BookingDashboard.self)
        async let appointments = try? api.get("/api/booking/appointments?businessId=\(id)", as: BookingAppointments.self)
        async let clients = try? api.get("/api/booking/clients?businessId=\(id)", as: BookingClients.self)
        async let services = try? api.get("/api/booking/services?businessId=\(id)", as: BookingServices.self)
        self.dashboard = await dashboard
        self.appointments = await appointments?.appointments ?? []
        self.clients = await clients?.clients ?? []
        self.services = await services
    }

    func setStatus(_ status: String, appointment: Int) async -> String? {
        await patch("/api/booking/appointments", body: ["businessId": business?.id ?? 0, "appointmentId": appointment, "status": status])
    }

    func setPublished(_ published: Bool) async -> String? {
        await patch("/api/booking/businesses", body: ["businessId": business?.id ?? 0, "published": published])
    }

    func setServiceActive(_ active: Bool, service: Int) async -> String? {
        await patch("/api/booking/services", body: ["businessId": business?.id ?? 0, "serviceId": service, "active": active])
    }

    func paymentsLink() async -> URL? {
        struct Link: Decodable { let url: String }
        guard let id = business?.id,
              let link = try? await api.post("/api/booking/stripe-connect", body: ["businessId": id], as: Link.self) else { return nil }
        return URL(string: link.url)
    }

    private func patch(_ path: String, body: [String: Any]) async -> String? {
        busy = true
        defer { busy = false }
        struct Ignored: Decodable {}
        do {
            _ = try await api.patch(path, body: body, as: Ignored.self)
            await loadBusiness()
            return nil
        } catch let error as FeedError {
            return error.message
        } catch {
            return "That didn't save. Try again."
        }
    }
}

/// Your booking business on the phone: what's booked, who your clients are, what you offer.
struct BookingDashboardView: View {
    let stack: ShellTab
    @StateObject private var model: BookingDashboardModel
    @State private var tab = "today"
    @State private var notice: String?
    @State private var browser: BrowserDestination?
    @State private var link: String?

    init(stack: ShellTab, api: FeedAPI) {
        self.stack = stack
        _model = StateObject(wrappedValue: BookingDashboardModel(api: api))
    }

    var body: some View {
        Group {
            if let failure = model.failure, model.account == nil {
                ErrorState(message: failure.message) { Task { await model.load() } }
            } else if model.account == nil {
                ProgressView().controlSize(.large).tint(Theme.red).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if model.uniqueBusinesses.isEmpty {
                empty
            } else {
                dashboard
            }
        }
        .nativeScreenChrome("Your business")
        .notice($notice)
        .opensSiteLinks($link, in: stack)
        .sheet(item: $browser) { SafariView(url: $0.url).ignoresSafeArea() }
        .task { if model.account == nil { await model.load() } }
    }

    private var empty: some View {
        VStack(spacing: 12) {
            Image(systemName: "storefront").font(.system(size: 34)).foregroundStyle(Theme.muted)
            Text("No booking business yet").font(.rooster(22)).foregroundStyle(Theme.ink)
            Text("Set one up on the website, then manage it here.").font(.system(size: 15)).foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
            Button("Open Booking on the web") { link = "/booking/dashboard" }
                .font(.system(size: 15, weight: .bold)).buttonStyle(.borderedProminent).tint(Theme.red)
        }
        .padding(32)
    }

    private var dashboard: some View {
        List {
            if model.uniqueBusinesses.count > 1 {
                Section {
                    Picker("Business", selection: Binding(
                        get: { model.business?.id ?? 0 },
                        set: { id in
                            model.business = model.uniqueBusinesses.first { $0.id == id }
                            Task { await model.loadBusiness() }
                        }
                    )) {
                        ForEach(model.uniqueBusinesses) { Text($0.name).tag($0.id) }
                    }
                }
            }

            if let metrics = model.dashboard?.metrics {
                Section {
                    HStack {
                        figure("\(metrics.todayAppointments ?? 0)", "Today")
                        figure("\(metrics.upcomingAppointments ?? 0)", "Upcoming")
                        figure(Money.string(metrics.monthRevenueCents ?? 0, currency: model.business?.currency) ?? "—", "This month")
                        figure("\(metrics.clients ?? 0)", "Clients")
                    }
                    .listRowBackground(Theme.surface)
                }
            }

            Section {
                Picker("Show", selection: $tab) {
                    Text("Booked").tag("today")
                    Text("Clients").tag("clients")
                    Text("Services").tag("services")
                    Text("Setup").tag("setup")
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
            }

            switch tab {
            case "clients": clientRows
            case "services": serviceRows
            case "setup": setupRows
            default: appointmentRows
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable { await model.load() }
    }

    private var appointmentRows: some View {
        Section(model.appointments.isEmpty ? "Booked" : "Booked (\(model.appointments.count))") {
            if model.appointments.isEmpty {
                Text("Nothing booked yet.").font(.system(size: 15)).foregroundStyle(Theme.muted)
            }
            ForEach(model.appointments.sorted { $0.appointment.startsAt < $1.appointment.startsAt }) { row in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(when(row.appointment.startsAt)).font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.ink)
                        Spacer()
                        Text(label(row.appointment.status))
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(color(row.appointment.status))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(color(row.appointment.status).opacity(0.12), in: Capsule())
                    }
                    Text([row.clientName, row.serviceName].compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 14)).foregroundStyle(Theme.ink.opacity(0.9))
                    HStack(spacing: 8) {
                        if let staff = row.staffName { Text(staff) }
                        if let price = Money.string(row.appointment.priceCents, currency: model.business?.currency) { Text("· \(price)") }
                        if let phone = row.clientPhone?.nilIfEmpty { Text("· \(phone)") }
                    }
                    .font(.system(size: 12)).foregroundStyle(Theme.muted)
                    Menu {
                        ForEach(["confirmed", "checked_in", "completed", "no_show", "cancelled"], id: \.self) { status in
                            if status != row.appointment.status {
                                Button(label(status)) {
                                    Task { notice = await model.setStatus(status, appointment: row.appointment.id) ?? "Updated." }
                                }
                            }
                        }
                    } label: {
                        Label("Change status", systemImage: "arrow.triangle.2.circlepath")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.red)
                    }
                    .disabled(model.busy)
                    .padding(.top, 2)
                }
                .padding(.vertical, 3)
            }
        }
    }

    private var clientRows: some View {
        Section(model.clients.isEmpty ? "Clients" : "Clients (\(model.clients.count))") {
            if model.clients.isEmpty {
                Text("No clients yet.").font(.system(size: 15)).foregroundStyle(Theme.muted)
            }
            ForEach(model.clients) { client in
                VStack(alignment: .leading, spacing: 3) {
                    Text(client.name?.nilIfEmpty ?? "Client").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                    HStack(spacing: 8) {
                        if let count = client.appointmentCount { Text("\(count) visit\(count == 1 ? "" : "s")") }
                        if let spend = Money.string(client.totalSpendCents, currency: model.business?.currency) { Text("· \(spend)") }
                        if let next = client.nextAppointmentAt { Text("· next \(when(next))") }
                    }
                    .font(.system(size: 12)).foregroundStyle(Theme.muted)
                    if let contact = [client.email?.nilIfEmpty, client.phone?.nilIfEmpty].compactMap({ $0 }).first {
                        Text(contact).font(.system(size: 12)).foregroundStyle(Theme.muted)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private var serviceRows: some View {
        Section("What you offer") {
            if (model.services?.services ?? []).isEmpty {
                Text("No services yet. Add them on the website.").font(.system(size: 15)).foregroundStyle(Theme.muted)
            }
            ForEach(model.services?.services ?? []) { service in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(service.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                        HStack(spacing: 6) {
                            if let minutes = service.durationMinutes { Text("\(minutes) min") }
                            if let price = Money.string(service.priceCents, currency: model.business?.currency) { Text("· \(price)") }
                        }
                        .font(.system(size: 12)).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    Toggle("", isOn: Binding(
                        get: { service.active != false },
                        set: { active in
                            Task { notice = await model.setServiceActive(active, service: service.id) ?? (active ? "Bookable." : "Hidden.") }
                        }
                    ))
                    .labelsHidden()
                    .tint(Theme.red)
                }
            }
            if let staff = model.services?.staff, !staff.isEmpty {
                ForEach(staff) { person in
                    HStack(spacing: 10) {
                        MemberAvatar(name: person.name, photoPath: person.photoUrl, size: 34)
                        Text(person.name).font(.system(size: 15)).foregroundStyle(Theme.ink)
                        Spacer()
                        Text(person.role?.nilIfEmpty ?? "Team").font(.system(size: 12)).foregroundStyle(Theme.muted)
                    }
                }
            }
        }
    }

    private var setupRows: some View {
        Section("Setup") {
            Toggle("Open for booking", isOn: Binding(
                get: { model.business?.published == true },
                set: { published in
                    Task { notice = await model.setPublished(published) ?? (published ? "Your page is live." : "Your page is hidden.") }
                }
            ))
            .tint(Theme.red)
            if let slug = model.business?.slug {
                Button {
                    UIPasteboard.general.string = "https://rooster-polished.vercel.app/book/\(slug)"
                    notice = "Booking link copied."
                } label: {
                    Label("Copy your booking link", systemImage: "link").foregroundStyle(Theme.ink)
                }
                Button { link = "/book/\(slug)" } label: {
                    Label("See your booking page", systemImage: "eye").foregroundStyle(Theme.ink)
                }
            }
            Button {
                Task {
                    if let url = await model.paymentsLink() {
                        browser = BrowserDestination(url: url)
                    } else {
                        notice = "Payments setup couldn't open. Try again."
                    }
                }
            } label: {
                Label(model.business?.stripeChargesEnabled == true ? "Payment settings" : "Set up client payments",
                      systemImage: "creditcard.fill")
                    .foregroundStyle(Theme.red)
            }
            Button { link = "/booking/dashboard" } label: {
                Label("Everything else, on the web", systemImage: "arrow.up.right.square").foregroundStyle(Theme.muted)
            }
        }
    }

    private func figure(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.rooster(18)).foregroundStyle(Theme.ink).lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
    }

    /// "no_show" reads as "No show", "checked_in" as "Checked in".
    private func label(_ status: String) -> String {
        let words = status.replacingOccurrences(of: "_", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }

    private func when(_ iso: String) -> String {
        guard let date = FeedDate.parse(iso) else { return "" }
        if Calendar.current.isDateInToday(date) { return "Today \(date.formatted(.dateTime.hour().minute()))" }
        if Calendar.current.isDateInTomorrow(date) { return "Tomorrow \(date.formatted(.dateTime.hour().minute()))" }
        return date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute())
    }

    private func color(_ status: String) -> Color {
        switch status {
        case "completed": Color(hex: 0x2F7A45)
        case "cancelled", "no_show": Theme.red
        case "checked_in": Theme.orange
        default: Theme.muted
        }
    }
}
