import PhotosUI
import SwiftUI
import UIKit

/// The sheet behind each create button. `done` gets the site's words for how it went, and the
/// new post when there is one, so WYD can put it at the top.
struct CreateSheet: View {
    let kind: CreateKind
    let actions: SiteActions
    let done: (String?, FeedPost?) -> Void

    var body: some View {
        switch kind {
        case .post: PostComposer(actions: actions, done: done)
        case .photo: PhotoComposer(actions: actions, done: done)
        case .song: SongLinkForm(actions: actions, done: done)
        }
    }
}

// MARK: - Post

/// "Post / Share an update" (index.html:189): a text post to everyone.
private struct PostComposer: View {
    let actions: SiteActions
    let done: (String?, FeedPost?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var sending = false
    @State private var problem: String?
    @FocusState private var focused: Bool

    private var ready: Bool { !sending && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && text.count <= 5000 }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                TextField("What’s happening?", text: $text, axis: .vertical)
                    .font(.rooster(17, weight: .regular))
                    .lineLimit(5...14)
                    .focused($focused)
                    .padding(14)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color(uiColor: Theme.uiLine)))
                HStack {
                    Text("Everyone on ROOSTER can see this.").font(.system(size: 13)).foregroundStyle(Theme.muted)
                    Spacer()
                    Text("\(text.count)/5000").font(.system(size: 12)).foregroundStyle(text.count > 5000 ? Theme.red : Theme.muted)
                }
                if let problem { Text(problem).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.red) }
                Spacer()
            }
            .padding(16)
            .background(Theme.background)
            .navigationTitle("Post")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(sending ? "Posting…" : "Post") { send() }.bold().disabled(!ready)
                }
            }
            .tint(Theme.red)
            .onAppear { focused = true }
        }
    }

    private func send() {
        sending = true
        problem = nil
        Task {
            switch await actions.post(text) {
            case .success(let post):
                done("Posted to WYD.", post)
                dismiss()
            case .failure(let error):
                problem = error.message
            }
            sending = false
        }
    }
}

// MARK: - Take a Pic

/// "Take a Pic" (community-home.js:764-788): a photo, a caption and a place, then it goes up.
/// The simulator has no camera, so it falls back to the photo library there.
private struct PhotoComposer: View {
    let actions: SiteActions
    let done: (String?, FeedPost?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var caption = ""
    @State private var location = ""
    @State private var sending = false
    @State private var problem: String?
    @State private var shooting = UIImagePickerController.isSourceTypeAvailable(.camera)
    @State private var picked: PhotosPickerItem?
    /// One id for this photo, so a retry after a dropped connection can't post it twice.
    @State private var requestId = UUID().uuidString.lowercased()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ZStack {
                        Theme.surface
                        if let image {
                            Image(uiImage: image).resizable().scaledToFit()
                        } else {
                            VStack(spacing: 10) {
                                Image(systemName: "camera").font(.system(size: 30)).foregroundStyle(Theme.muted)
                                Text("No photo yet").font(.rooster(15, weight: .regular)).foregroundStyle(Theme.muted)
                            }
                        }
                    }
                    .aspectRatio(4.0 / 5.0, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                    HStack(spacing: 10) {
                        if UIImagePickerController.isSourceTypeAvailable(.camera) {
                            Button { shooting = true } label: {
                                Label(image == nil ? "Open camera" : "Retake", systemImage: "camera.fill")
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            }
                            .buttonStyle(.borderedProminent).tint(SiteColor.slotsRed)
                        }
                        PhotosPicker(selection: $picked, matching: .images) {
                            Label("Library", systemImage: "photo.on.rectangle").frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.bordered).tint(Theme.red)
                    }

                    TextField("Say something about it (optional)", text: $caption, axis: .vertical)
                        .lineLimit(2...5)
                        .padding(12)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    TextField("Where are you? (optional)", text: $location)
                        .padding(12)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    if let problem { Text(problem).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.red) }
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Take a Pic")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(sending ? "Sharing…" : "Share") { share() }.bold().disabled(image == nil || sending)
                }
            }
            .tint(Theme.red)
            .fullScreenCover(isPresented: $shooting) {
                CameraCapture { taken in
                    if let taken { image = taken; requestId = UUID().uuidString.lowercased() }
                    shooting = false
                }
                .ignoresSafeArea()
            }
            .onChange(of: picked) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self), let loaded = UIImage(data: data) {
                        image = loaded
                        requestId = UUID().uuidString.lowercased()
                    }
                    picked = nil
                }
            }
            .onChange(of: caption) { _, text in if text.count > 500 { caption = String(text.prefix(500)) } }
            .onChange(of: location) { _, text in if text.count > 100 { location = String(text.prefix(100)) } }
        }
    }

    private func share() {
        guard let image else { return }
        sending = true
        problem = nil
        Task {
            switch await actions.postPhoto(image, caption: caption, location: location, requestId: requestId) {
            case .success(let post):
                done("Your photo is on WYD.", post)
                dismiss()
            case .failure(let error):
                problem = error.message
            }
            sending = false
        }
    }
}

/// The system camera, for one still photo.
struct CameraCapture: UIViewControllerRepresentable {
    let finish: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(finish: finish) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let finish: (UIImage?) -> Void
        init(finish: @escaping (UIImage?) -> Void) { self.finish = finish }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            finish(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { finish(nil) }
    }
}

// MARK: - Song

/// "Song / Add music": a YouTube, Spotify or Apple Music link in one of your three song slots
/// (member-songs.mts:390-410). The site's own editor takes YouTube only; the server takes all three.
private struct SongLinkForm: View {
    let actions: SiteActions
    let done: (String?, FeedPost?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var slots: [SongSlots.Slot] = []
    @State private var slot = 1
    @State private var title = ""
    @State private var link = ""
    @State private var loading = true
    @State private var saving = false
    @State private var problem: String?

    private var chosen: SongSlots.Slot? { slots.first { $0.slot == slot } }
    private var ready: Bool {
        !saving && !loading && !title.trimmingCharacters(in: .whitespaces).isEmpty
            && link.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix("https://")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Slot", selection: $slot) {
                        ForEach([1, 2, 3], id: \.self) { number in
                            let current = slots.first { $0.slot == number }
                            Text(current.map { $0.isEmpty ? "Slot \(number) · empty" : "Slot \(number) · \($0.title ?? "song")" }
                                 ?? "Slot \(number)").tag(number)
                        }
                    }
                    if let chosen, !chosen.isEmpty {
                        Text("Saving here replaces “\(chosen.title ?? "this song")”.")
                            .font(.system(size: 13)).foregroundStyle(Theme.muted)
                    }
                } header: {
                    Text("Where it goes on your page")
                }
                Section {
                    TextField("Song title", text: $title)
                    TextField("https://…", text: $link)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                } header: {
                    Text("The song")
                } footer: {
                    Text("Paste a link to one song on YouTube, Spotify or Apple Music.")
                }
                if let problem {
                    Section { Text(problem).foregroundStyle(Theme.red) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Add music")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(saving ? "Saving…" : "Save") { save() }.bold().disabled(!ready)
                }
            }
            .tint(Theme.red)
            .task { await load() }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            slots = try await actions.songs().slots
            slot = slots.first(where: \.isEmpty)?.slot ?? 1
        } catch let error as FeedError {
            problem = error.message
        } catch {
            problem = "Your songs didn't load."
        }
    }

    private func save() {
        saving = true
        problem = nil
        Task {
            if let failure = await actions.addSongLink(slot: slot, revision: chosen?.revision, title: title, url: link) {
                problem = failure.message
            } else {
                done("Your song is on your page.", nil)
                dismiss()
            }
            saving = false
        }
    }
}

// MARK: - Edit Top 8

/// Eight numbered picks, like the site's editor (top-eight-roster.js:83-96). Each person once;
/// they don't have to be on your roster already.
struct TopEightEditor: View {
    @ObservedObject var model: TopEightModel
    let done: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var picks: [String] = Array(repeating: "", count: 8)
    @State private var saving = false
    @State private var problem: String?

    private var people: [TopEight.Card] {
        var seen = Set<String>()
        return ((model.value?.availableMembers ?? []) + (model.value?.members ?? []))
            .filter { seen.insert($0.id).inserted }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(0..<8, id: \.self) { index in
                        Picker(selection: Binding(get: { picks[index] }, set: { choose($0, at: index) })) {
                            Text("Nobody").tag("")
                            ForEach(people) { person in Text(person.name).tag(person.id) }
                        } label: {
                            Text("\(index + 1)").font(.rooster(13)).foregroundStyle(Theme.background)
                                .frame(width: 26, height: 26)
                                .background(Theme.gold, in: Circle())
                        }
                    }
                } footer: {
                    Text("Picking someone already in your Top 8 moves them to that number.")
                }
                Section {
                    Button("Clear Top 8", role: .destructive) { picks = Array(repeating: "", count: 8) }
                }
                if let problem { Section { Text(problem).foregroundStyle(Theme.red) } }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Edit Top 8")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(saving ? "Saving…" : "Save Top 8") { save() }.bold().disabled(saving)
                }
            }
            .tint(Theme.red)
            .onAppear {
                let current = (model.value?.members ?? []).prefix(8).map(\.id)
                picks = current + Array(repeating: "", count: 8 - current.count)
            }
        }
    }

    /// The site's order has no gaps and no repeats, so a repeat pick moves that person.
    private func choose(_ id: String, at index: Int) {
        if !id.isEmpty, let previous = picks.firstIndex(of: id), previous != index { picks[previous] = "" }
        picks[index] = id
    }

    private func save() {
        saving = true
        problem = nil
        Task {
            if let failure = await model.save(picks.filter { !$0.isEmpty }) {
                problem = failure.message
            } else {
                done("Your Top 8 is saved.")
                dismiss()
            }
            saving = false
        }
    }
}
