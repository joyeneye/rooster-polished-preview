import PhotosUI
import SwiftUI

/// The rest of a business's setup: its details, its pictures, what it offers and who does the work.
/// Opening hours are set when the business is created and have no edit endpoint anywhere
/// (booking-api.mts:158), so they are not shown here.
struct BookingSetupView: View {
    @ObservedObject var model: BookingDashboardModel
    let business: BookingAccount.Business
    @State private var editingService: BookingService?
    @State private var addingService = false
    @State private var editingStaff: BookingStaff?
    @State private var addingStaff = false
    @State private var editingDetails = false
    @State private var notice: String?

    var body: some View {
        List {
            Section("The business") {
                Button { editingDetails = true } label: {
                    row("Name, contact and address", "building.2.fill")
                }
            }

            Section("Pictures") {
                PhotoRow(title: "Logo", current: model.details?.logoUrl, model: model, field: "logoUrl", notice: $notice)
                PhotoRow(title: "Cover photo", current: model.details?.coverUrl, model: model, field: "coverUrl", notice: $notice)
                GalleryRow(model: model, notice: $notice)
            }

            Section("What you offer") {
                Button { addingService = true } label: { row("Add a service", "plus.circle.fill", tint: Theme.red) }
                ForEach(model.services?.services ?? []) { service in
                    Button { editingService = service } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(service.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                                HStack(spacing: 6) {
                                    if let minutes = service.durationMinutes { Text("\(minutes) min") }
                                    if let price = Money.string(service.priceCents, currency: business.currency) { Text("· \(price)") }
                                    if service.active == false { Text("· Hidden") }
                                }
                                .font(.system(size: 12)).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            Image(systemName: "chevron.forward").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted.opacity(0.7))
                        }
                    }
                    .buttonStyle(.plain)
                }
            }

            Section("Who does the work") {
                Button { addingStaff = true } label: { row("Add someone", "person.badge.plus.fill", tint: Theme.red) }
                ForEach(model.services?.staff ?? []) { person in
                    Button { editingStaff = person } label: {
                        HStack(spacing: 12) {
                            MemberAvatar(name: person.name, photoPath: person.photoUrl, size: 38)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(person.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                                Text(person.role?.nilIfEmpty ?? "Team").font(.system(size: 12)).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            Image(systemName: "chevron.forward").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted.opacity(0.7))
                        }
                    }
                    .buttonStyle(.plain)
                }
            }

            Section("When you're open") {
                NavigationLink {
                    BookingHoursView(model: model)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "clock.fill").font(.system(size: 15)).foregroundStyle(Theme.red).frame(width: 26)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Opening hours").foregroundStyle(Theme.ink)
                            Text(model.hoursSummary).font(.system(size: 12)).foregroundStyle(Theme.muted)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .nativeScreenChrome("Setup")
        .notice($notice)
        .task { await model.loadDetails() }
        .sheet(isPresented: $editingDetails) { DetailsSheet(model: model, notice: $notice) }
        .sheet(isPresented: $addingService) { ServiceSheet(model: model, service: nil, notice: $notice) }
        .sheet(item: $editingService) { ServiceSheet(model: model, service: $0, notice: $notice) }
        .sheet(isPresented: $addingStaff) { StaffSheet(model: model, person: nil, notice: $notice) }
        .sheet(item: $editingStaff) { StaffSheet(model: model, person: $0, notice: $notice) }
    }

    private func row(_ title: String, _ symbol: String, tint: Color = Theme.ink) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).font(.system(size: 15)).foregroundStyle(Theme.red).frame(width: 26)
            Text(title).foregroundStyle(tint)
            Spacer()
            Image(systemName: "chevron.forward").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted.opacity(0.7))
        }
    }
}

// MARK: - Pictures

private struct PhotoRow: View {
    let title: String
    let current: String?
    @ObservedObject var model: BookingDashboardModel
    let field: String
    @Binding var notice: String?
    @State private var picked: PhotosPickerItem?
    @State private var working = false
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        PhotosPicker(selection: $picked, matching: .images) {
            HStack(spacing: 12) {
                RemoteImage(url: current.flatMap { store.siteURL($0) }, size: 60) {
                    ZStack {
                        Theme.red.opacity(0.08)
                        Image(systemName: "photo").foregroundStyle(Theme.red)
                    }
                }
                .frame(width: 54, height: 54)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                Text(title).foregroundStyle(Theme.ink)
                Spacer()
                if working { ProgressView().tint(Theme.red) } else {
                    Text(current?.nilIfEmpty == nil ? "Add" : "Change").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.red)
                }
            }
        }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            working = true
            Task {
                defer { working = false; picked = nil }
                notice = await model.upload(item, into: field)
            }
        }
    }
}

private struct GalleryRow: View {
    @ObservedObject var model: BookingDashboardModel
    @Binding var notice: String?
    @State private var picked: PhotosPickerItem?
    @State private var working = false
    @EnvironmentObject private var store: ShellStore

    private var gallery: [String] { model.details?.gallery ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Gallery").foregroundStyle(Theme.ink)
                Spacer()
                PhotosPicker(selection: $picked, matching: .images) {
                    if working { ProgressView().tint(Theme.red) } else {
                        Text("Add photo").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.red)
                    }
                }
            }
            if !gallery.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(gallery, id: \.self) { photo in
                            RemoteImage(url: store.siteURL(photo), size: 120) { Theme.muted.opacity(0.12) }
                                .frame(width: 84, height: 84)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(alignment: .topTrailing) {
                                    Button {
                                        Task { notice = await model.removeFromGallery(photo) }
                                    } label: {
                                        Image(systemName: "xmark.circle.fill").font(.system(size: 18))
                                            .foregroundStyle(.white, .black.opacity(0.5))
                                    }
                                    .padding(3)
                                }
                        }
                    }
                }
            }
        }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            working = true
            Task {
                defer { working = false; picked = nil }
                notice = await model.upload(item, into: "gallery")
            }
        }
    }
}

// MARK: - Details

private struct DetailsSheet: View {
    @ObservedObject var model: BookingDashboardModel
    @Binding var notice: String?
    @Environment(\.dismiss) private var dismiss
    @State private var draft = BookingDetailsDraft()
    @State private var saving = false

    private let zones = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
                         "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("Business name", text: $draft.name)
                }
                Section("What you do") {
                    TextField("Tell people what you offer…", text: $draft.description, axis: .vertical).lineLimit(3...8)
                    Picker("Craft", selection: $draft.categoryId) {
                        Text("Not set").tag(0)
                        ForEach(model.categories) { Text($0.name).tag($0.id) }
                    }
                }
                Section("How clients reach you") {
                    TextField("Phone", text: $draft.phone).keyboardType(.phonePad)
                    TextField("Email", text: $draft.email).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                    TextField("Shop or website link", text: $draft.shop).keyboardType(.URL).textInputAutocapitalization(.never)
                }
                Section("Where you are") {
                    TextField("Address", text: $draft.addressLine1)
                    TextField("Suite, floor (optional)", text: $draft.addressLine2)
                    TextField("City", text: $draft.city)
                    TextField("State or region", text: $draft.region)
                    TextField("Postcode", text: $draft.postalCode)
                    Picker("Time zone", selection: $draft.timezone) {
                        ForEach(zones, id: \.self) { zone in
                            Text(zone.split(separator: "/").last?.replacingOccurrences(of: "_", with: " ") ?? zone).tag(zone)
                        }
                    }
                }
                Section("Cancellation policy") {
                    TextField("What happens if a client cancels…", text: $draft.cancellation, axis: .vertical).lineLimit(2...6)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .tint(Theme.red)
            .navigationTitle("The business")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") {
                        saving = true
                        Task {
                            notice = await model.saveDetails(draft) ?? "Saved."
                            saving = false
                            dismiss()
                        }
                    }
                    .bold()
                    .disabled(saving || draft.name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .task { draft = model.draft() }
        }
    }
}

// MARK: - Services and staff

private struct ServiceSheet: View {
    @ObservedObject var model: BookingDashboardModel
    let service: BookingService?
    @Binding var notice: String?
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var price = ""
    @State private var minutes = 60
    @State private var online = true
    @State private var active = true
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Service") {
                    TextField("What is it called?", text: $name)
                    TextField("Description (optional)", text: $description, axis: .vertical).lineLimit(2...5)
                }
                Section("Price and time") {
                    HStack {
                        Text("Price")
                        Spacer()
                        TextField("0", text: $price).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 120)
                    }
                    Stepper("\(minutes) minutes", value: $minutes, in: 5...480, step: 5)
                }
                Section {
                    Toggle("Clients can book it online", isOn: $online).tint(Theme.red)
                    if service != nil {
                        Toggle("Show on your page", isOn: $active).tint(Theme.red)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .tint(Theme.red)
            .navigationTitle(service == nil ? "New service" : "Edit service")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") { save() }
                        .bold()
                        .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .task {
                guard let service else { return }
                name = service.name
                description = service.description ?? ""
                price = service.priceCents.map { String(format: "%.2f", Double($0) / 100) } ?? ""
                minutes = service.durationMinutes ?? 60
                online = service.onlineBookingEnabled != false
                active = service.active != false
            }
        }
    }

    private func save() {
        saving = true
        var body: [String: Any] = [
            "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
            "description": description.trimmingCharacters(in: .whitespacesAndNewlines),
            "priceCents": Int((Double(price.replacingOccurrences(of: ",", with: "")) ?? 0) * 100),
            "durationMinutes": minutes,
            "onlineBookingEnabled": online,
        ]
        if let service {
            body["serviceId"] = service.id
            body["active"] = active
        }
        Task {
            notice = await model.saveService(body, existing: service != nil) ?? "Saved."
            saving = false
            dismiss()
        }
    }
}

private struct StaffSheet: View {
    @ObservedObject var model: BookingDashboardModel
    let person: BookingStaff?
    @Binding var notice: String?
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var role = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var bio = ""
    @State private var active = true
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Who") {
                    TextField("Name", text: $name)
                    TextField("Role, like Barber or Stylist", text: $role)
                }
                Section("Contact (stays private)") {
                    TextField("Email", text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                    TextField("Phone", text: $phone).keyboardType(.phonePad)
                }
                Section("About them") {
                    TextField("A line or two clients will see", text: $bio, axis: .vertical).lineLimit(2...6)
                }
                if person != nil {
                    Section {
                        Toggle("Taking bookings", isOn: $active).tint(Theme.red)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .tint(Theme.red)
            .navigationTitle(person == nil ? "Add someone" : "Edit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") { save() }
                        .bold()
                        .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .task {
                guard let person else { return }
                name = person.name
                role = person.role ?? ""
                bio = person.bio ?? ""
            }
        }
    }

    private func save() {
        saving = true
        var body: [String: Any] = [
            "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
            "role": role.trimmingCharacters(in: .whitespacesAndNewlines),
            "email": email.trimmingCharacters(in: .whitespacesAndNewlines),
            "phone": phone.trimmingCharacters(in: .whitespacesAndNewlines),
            "bio": bio.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
        if let person {
            body["staffId"] = person.id
            body["active"] = active
        }
        Task {
            notice = await model.saveStaff(body, existing: person != nil) ?? "Saved."
            saving = false
            dismiss()
        }
    }
}

/// The fields the details form edits (booking-api.mts:167-182).
struct BookingDetailsDraft {
    var name = ""
    var description = ""
    var categoryId = 0
    var phone = ""
    var email = ""
    var shop = ""
    var addressLine1 = ""
    var addressLine2 = ""
    var city = ""
    var region = ""
    var postalCode = ""
    var timezone = "America/Chicago"
    var cancellation = ""

    init() {}

    /// What the form starts with, read off the business's own row.
    init(_ details: BookingDetails) {
        name = details.name
        description = details.description ?? ""
        categoryId = details.categoryId ?? 0
        phone = details.phone ?? ""
        email = details.email ?? ""
        shop = details.socialLinks?["shop"] ?? ""
        addressLine1 = details.addressLine1 ?? ""
        addressLine2 = details.addressLine2 ?? ""
        city = details.city ?? ""
        region = details.region ?? ""
        postalCode = details.postalCode ?? ""
        timezone = details.timezone?.nilIfEmpty ?? "America/Chicago"
        cancellation = details.policies?["cancellation"] ?? ""
    }
}
