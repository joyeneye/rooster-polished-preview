import SwiftUI

/// /api/booking/public (booking-api.mts:273-315). Only the fields the pages show are decoded.
struct BookingBusiness: Decodable, Hashable, Identifiable {
    let id: Int
    let slug: String
    let name: String
    let description: String?
    let logoUrl: String?
    let coverUrl: String?
    let city: String?
    let region: String?
    let phone: String?
    let currency: String?
    let averageRating: Int?
    let reviewCount: Int?
    let featured: Bool?

    /// averageRating is the rating times 100 (booking-api.mts).
    var rating: Double? {
        guard let averageRating, averageRating > 0 else { return nil }
        return Double(averageRating) / 100
    }

    var place: String? {
        let parts = [city, region].compactMap { $0?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }
}

struct BookingCategory: Decodable, Hashable, Identifiable {
    let id: Int
    let slug: String
    let name: String
}

struct BookingService: Decodable, Hashable, Identifiable {
    let id: Int
    let name: String
    let description: String?
    let priceCents: Int?
    let durationMinutes: Int?
    let onlineBookingEnabled: Bool?
    let active: Bool?
}

struct BookingStaff: Decodable, Hashable, Identifiable {
    let id: Int
    let name: String
    let photoUrl: String?
    let bio: String?
    let role: String?
}

struct BookingHours: Decodable, Hashable, Identifiable {
    let id: Int
    let weekday: Int
    let startMinute: Int?
    let endMinute: Int?
    let closed: Bool?
}

struct BookingReview: Decodable, Hashable, Identifiable {
    let id: Int
    let rating: Int
    let body: String?
    let providerResponse: String?
    let createdAt: String?
    let clientName: String?
}

struct BookingCategories: Decodable { let categories: [BookingCategory] }
struct BookingDiscovery: Decodable {
    struct Provider: Decodable, Hashable, Identifiable {
        let business: BookingBusiness
        let category: BookingCategory?
        var id: Int { business.id }
    }
    let providers: [Provider]
}

struct BookingProfile: Decodable {
    let business: BookingBusiness
    let category: BookingCategory?
    let services: [BookingService]
    let staff: [BookingStaff]
    let hours: [BookingHours]
    let reviews: [BookingReview]
}

enum Money {
    static func string(_ cents: Int?, currency: String?) -> String? {
        guard let cents else { return nil }
        return Decimal(cents) / 100 == 0
            ? "Free"
            : (Decimal(cents) / 100).formatted(.currency(code: currency?.uppercased() ?? "USD").precision(.fractionLength(cents % 100 == 0 ? 0 : 2)))
    }
}

@MainActor
final class BookingModel: ObservableObject {
    @Published var query = ""
    @Published var category: BookingCategory?
    @Published private(set) var categories: [BookingCategory] = []
    @Published private(set) var providers: [BookingDiscovery.Provider] = []
    @Published private(set) var loading = false
    @Published private(set) var failure: FeedError?

    private let api: FeedAPI
    private var generation = 0

    init(api: FeedAPI) {
        self.api = api
    }

    func startIfNeeded() {
        guard providers.isEmpty, !loading else { return }
        Task {
            categories = (try? await api.get("/api/booking/public?action=categories", as: BookingCategories.self))?.categories ?? []
            await load()
        }
    }

    func load() async {
        generation += 1
        let current = generation
        loading = true
        defer { if current == generation { loading = false } }
        var path = "/api/booking/public?action=discover"
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { path += "&q=\(ProfileModel.encode(String(trimmed.prefix(100))))" }
        if let category { path += "&category=\(ProfileModel.encode(category.slug))" }
        do {
            let page = try await api.get(path, as: BookingDiscovery.self)
            guard current == generation else { return }
            providers = page.providers
            failure = nil
        } catch let error as FeedError {
            if current == generation { failure = error }
        } catch {}
    }

    func searchChanged() {
        let typed = query
        Task {
            try? await Task.sleep(for: .milliseconds(350))
            guard typed == query else { return }
            await load()
        }
    }

    func select(_ category: BookingCategory?) {
        self.category = category
        Task { await load() }
    }
}

/// ROOSTER Booking, native: find a professional. Booking an appointment is a write (and payment),
/// so it is coming soon.
struct BookingMarketplaceView: View {
    let stack: ShellTab
    @StateObject private var model: BookingModel
    @EnvironmentObject private var session: SessionModel

    init(stack: ShellTab, api: FeedAPI) {
        self.stack = stack
        _model = StateObject(wrappedValue: BookingModel(api: api))
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("ROOSTER BOOKING").font(.roosterMono(10)).tracking(1.4).foregroundStyle(Theme.red)
                    Text("Find your next favorite.").font(.rooster(28)).foregroundStyle(Theme.ink)
                    Text("Barbers, stylists, studios and specialists on the roster.").font(.system(size: 15)).foregroundStyle(Theme.muted)
                }
                .padding(.horizontal, 20)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        Button { model.select(nil) } label: {
                            FilterChip(title: "All services", active: model.category == nil, symbol: nil)
                        }
                        ForEach(model.categories) { category in
                            Button { model.select(category) } label: {
                                FilterChip(title: category.name, active: model.category?.id == category.id, symbol: nil)
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                }

                if model.loading && model.providers.isEmpty {
                    LoadingRows(count: 3).padding(.horizontal, 20)
                } else if let failure = model.failure, model.providers.isEmpty {
                    ErrorState(message: failure.message) {
                        if case .locked = failure { session.revalidate() }
                        Task { await model.load() }
                    }
                } else if model.providers.isEmpty {
                    Text("No businesses match that yet.").font(.system(size: 15)).foregroundStyle(Theme.muted).padding(.horizontal, 20)
                } else {
                    ForEach(model.providers) { provider in
                        NavigationLink(value: AppRoute.native(.bookingProvider(slug: provider.business.slug))) {
                            ProviderCard(provider: provider)
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 16)
                    }
                }
            }
            .padding(.vertical, 12)
        }
        .searchable(text: $model.query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Service or business")
        .onChange(of: model.query) { _, _ in model.searchChanged() }
        .refreshable { await model.load() }
        .nativeScreenChrome("Booking")
        .onAppear(perform: model.startIfNeeded)
    }
}

private struct ProviderCard: View {
    let provider: BookingDiscovery.Provider
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                Color(hex: 0x2A0E17)
                    .overlay {
                        RemoteImage(url: provider.business.coverUrl.flatMap { store.siteURL($0) }, size: 420) {
                            LinearGradient(colors: [Theme.red.opacity(0.7), Color(hex: 0xFF9A4D).opacity(0.7)],
                                           startPoint: .topLeading, endPoint: .bottomTrailing)
                        }
                    }
                    .clipped()
                LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .center, endPoint: .bottom)
                if provider.business.featured == true {
                    Text("FEATURED").font(.roosterMono(9)).tracking(1).foregroundStyle(.white)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Theme.red, in: Capsule())
                        .padding(12)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
            }
            .frame(height: 132)

            HStack(spacing: 12) {
                RemoteImage(url: provider.business.logoUrl.flatMap { store.siteURL($0) }, size: 56) {
                    ZStack {
                        Theme.red.opacity(0.1)
                        Text(String(provider.business.name.prefix(1))).font(.rooster(22)).foregroundStyle(Theme.red)
                    }
                }
                .frame(width: 52, height: 52)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(provider.business.name).font(.system(size: 17, weight: .bold)).foregroundStyle(Theme.ink).lineLimit(1)
                    Text(provider.category?.name ?? "Independent professional").font(.system(size: 13)).foregroundStyle(Theme.muted)
                    HStack(spacing: 8) {
                        if let rating = provider.business.rating {
                            Label(String(format: "%.1f", rating), systemImage: "star.fill").foregroundStyle(Theme.gold)
                        }
                        if let count = provider.business.reviewCount, count > 0 {
                            Text("\(count) review\(count == 1 ? "" : "s")").foregroundStyle(Theme.muted)
                        }
                        if let place = provider.business.place {
                            Text(place).foregroundStyle(Theme.muted)
                        }
                    }
                    .font(.system(size: 12, weight: .semibold))
                }
                Spacer(minLength: 0)
            }
            .padding(14)
        }
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color(uiColor: Theme.uiLine)))
    }
}

/// A business page: what they do, who does it, when they're open and what clients said.
struct BookingProviderView: View {
    let slug: String
    let stack: ShellTab
    @StateObject private var profile: Loadable<BookingProfile>
    @State private var notice: String?
    @State private var link: String?
    @EnvironmentObject private var store: ShellStore

    init(slug: String, stack: ShellTab, api: FeedAPI) {
        self.slug = slug
        self.stack = stack
        _profile = StateObject(wrappedValue: Loadable {
            try await api.get("/api/booking/public?action=profile&slug=\(ProfileModel.encode(slug))", as: BookingProfile.self)
        })
    }

    private static let weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

    var body: some View {
        LoadableContent(loadable: profile) { value in
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    hero(value)
                    if !value.services.isEmpty { services(value) }
                    if !value.staff.isEmpty { team(value.staff) }
                    if !value.hours.isEmpty { hours(value.hours) }
                    if !value.reviews.isEmpty { reviews(value.reviews) }
                }
                .padding(.bottom, 30)
            }
            .refreshable { await profile.load() }
        }
        .nativeScreenChrome("Booking")
        .notice($notice)
        .opensSiteLinks($link, in: stack)
    }

    private func hero(_ value: BookingProfile) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            ZStack(alignment: .bottomLeading) {
                Color(hex: 0x2A0E17)
                    .overlay {
                        RemoteImage(url: value.business.coverUrl.flatMap { store.siteURL($0) }, size: 500) {
                            LinearGradient(colors: [Theme.red, Color(hex: 0xFF9A4D)], startPoint: .topLeading, endPoint: .bottomTrailing)
                        }
                    }
                    .clipped()
                LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .center, endPoint: .bottom)
                VStack(alignment: .leading, spacing: 4) {
                    if let rating = value.business.rating {
                        HStack(spacing: 6) {
                            Label(String(format: "%.1f", rating), systemImage: "star.fill").foregroundStyle(Theme.gold)
                            if let count = value.business.reviewCount, count > 0 {
                                Text("· \(count) verified review\(count == 1 ? "" : "s")").foregroundStyle(.white.opacity(0.85))
                            }
                        }
                        .font(.system(size: 13, weight: .bold))
                    }
                    Text(value.business.name).font(.rooster(28)).foregroundStyle(.white)
                    Text([value.category?.name, value.business.place].compactMap { $0 }.joined(separator: " · "))
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(.white.opacity(0.85))
                }
                .padding(18)
            }
            .frame(height: 210)

            if let description = value.business.description, !description.isEmpty {
                Text(description).font(.system(size: 16)).foregroundStyle(Theme.ink.opacity(0.9)).padding(.horizontal, 20)
            }
            HStack(spacing: 10) {
                Button { notice = "Booking from the app is coming soon." } label: {
                    Text("Book now").font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .background(Theme.red, in: Capsule())
                }
                .buttonStyle(PressableStyle())
                if let phone = value.business.phone, !phone.isEmpty,
                   let url = URL(string: "tel:\(phone.filter { $0.isNumber || $0 == "+" })") {
                    Link(destination: url) {
                        Image(systemName: "phone.fill").font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.ink)
                            .frame(width: 50, height: 50)
                            .background(Theme.surface, in: Circle())
                            .overlay(Circle().stroke(Color(uiColor: Theme.uiLine)))
                    }
                    .accessibilityLabel("Call")
                }
            }
            .padding(.horizontal, 20)
        }
    }

    private func services(_ value: BookingProfile) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading(eyebrow: nil, title: "Services").padding(.horizontal, 20)
            VStack(spacing: 0) {
                ForEach(Array(value.services.enumerated()), id: \.element.id) { index, service in
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(service.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                            HStack(spacing: 6) {
                                if let minutes = service.durationMinutes { Text("\(minutes) min") }
                                if let description = service.description, !description.isEmpty {
                                    Text("· \(description)").lineLimit(2)
                                }
                            }
                            .font(.system(size: 13)).foregroundStyle(Theme.muted)
                        }
                        Spacer(minLength: 8)
                        VStack(alignment: .trailing, spacing: 6) {
                            if let price = Money.string(service.priceCents, currency: value.business.currency) {
                                Text(price).font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.ink)
                            }
                            Button { notice = "Booking from the app is coming soon." } label: {
                                Text("Book").font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.red)
                                    .padding(.horizontal, 14).frame(height: 32)
                                    .overlay(Capsule().stroke(Theme.red.opacity(0.45)))
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                    .padding(14)
                    if index < value.services.count - 1 { Divider().padding(.leading, 14) }
                }
            }
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .padding(.horizontal, 16)
        }
    }

    private func team(_ staff: [BookingStaff]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading(eyebrow: nil, title: "Meet the team").padding(.horizontal, 20)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(staff) { person in
                        VStack(spacing: 6) {
                            MemberAvatar(name: person.name, photoPath: person.photoUrl, size: 66)
                            Text(person.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                            if let role = person.role, !role.isEmpty {
                                Text(role).font(.system(size: 12)).foregroundStyle(Theme.muted).lineLimit(1)
                            }
                        }
                        .frame(width: 92)
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }

    private func hours(_ hours: [BookingHours]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading(eyebrow: nil, title: "Hours").padding(.horizontal, 20)
            VStack(spacing: 8) {
                ForEach(hours.sorted { $0.weekday < $1.weekday }) { day in
                    HStack {
                        Text(Self.weekdays[min(max(day.weekday, 0), 6)]).font(.system(size: 15)).foregroundStyle(Theme.ink)
                        Spacer()
                        Text(label(day)).font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(day.closed == true ? Theme.muted : Theme.ink)
                    }
                }
            }
            .padding(16)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .padding(.horizontal, 16)
        }
    }

    private func label(_ day: BookingHours) -> String {
        guard day.closed != true, let start = day.startMinute, let end = day.endMinute else { return "Closed" }
        return "\(clock(start)) – \(clock(end))"
    }

    private func clock(_ minutes: Int) -> String {
        var components = DateComponents()
        components.hour = minutes / 60
        components.minute = minutes % 60
        let date = Calendar.current.date(from: components) ?? Date()
        return date.formatted(.dateTime.hour().minute())
    }

    private func reviews(_ reviews: [BookingReview]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading(eyebrow: nil, title: "What clients say").padding(.horizontal, 20)
            ForEach(reviews) { review in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 3) {
                        ForEach(0..<5) { star in
                            Image(systemName: star < review.rating ? "star.fill" : "star")
                                .font(.system(size: 12)).foregroundStyle(Theme.gold)
                        }
                        Spacer()
                        if let created = review.createdAt {
                            Text(FeedDate.ago(created)).font(.system(size: 12)).foregroundStyle(Theme.muted)
                        }
                    }
                    if let body = review.body, !body.isEmpty {
                        Text(body).font(.system(size: 15)).foregroundStyle(Theme.ink.opacity(0.9))
                    }
                    Text(review.clientName ?? "A client").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
                    if let response = review.providerResponse, !response.isEmpty {
                        Text(response).font(.system(size: 14)).foregroundStyle(Theme.ink.opacity(0.8))
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .padding(.horizontal, 16)
            }
        }
    }
}
