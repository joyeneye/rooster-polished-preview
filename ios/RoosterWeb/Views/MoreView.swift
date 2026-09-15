import SwiftUI

/// The site's More dialog ("Your whole world.") as a native list, with the theme switch that
/// the dialog's footer carries — the only place the site offers it.
struct MoreView: View {
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        NavigationStack(path: $store.morePath) {
            List {
                Section {
                    ForEach(ShellDestination.explore) { row($0) }
                } header: {
                    Text("Explore ROOSTER")
                }
                Section {
                    ForEach(ShellDestination.yours) { row($0) }
                } header: {
                    Text("Yours")
                }
                Section {
                    ForEach(ShellDestination.site) { row($0) }
                }
                Section {
                    Toggle(isOn: Binding(
                        get: { store.theme == .dark },
                        set: { store.setTheme($0 ? .dark : .light) }
                    )) {
                        Label("Dark mode", systemImage: "moon.fill")
                    }
                    .tint(Theme.red)
                } header: {
                    Text("Make it yours.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Your whole world.")
            // Inline, like every web tab. A large title rendered blank at rest here (it only
            // appeared once collapsed), and matching the other tabs is the better call anyway.
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: MoreRoute.self) { route in
                switch route {
                case .destination(let destination): PushedWebScreen(page: store.page(for: destination))
                case .web(let web): PushedWebScreen(page: web.page)
                }
            }
        }
    }

    private func row(_ destination: ShellDestination) -> some View {
        Button {
            _ = store.page(for: destination)
            store.morePath = [.destination(destination)]
        } label: {
            HStack(spacing: 14) {
                Image(systemName: destination.symbol)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.red)
                    .frame(width: 30, height: 30)
                    .background(Theme.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(destination.title).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                    Text(destination.tagline).font(.footnote).foregroundStyle(Theme.muted)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.forward")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.muted.opacity(0.7))
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(Theme.surface)
    }
}
