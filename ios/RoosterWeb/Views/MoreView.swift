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
            .navigationDestination(for: ShellDestination.self) { destination in
                MoreDestinationScreen(page: store.page(for: destination))
            }
        }
    }

    private func row(_ destination: ShellDestination) -> some View {
        Button {
            _ = store.page(for: destination)
            store.morePath = [destination]
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

/// A More destination. Back walks the page's own history first, then returns to the list.
private struct MoreDestinationScreen: View {
    @ObservedObject var page: WebPage

    var body: some View {
        WebScreen(page: page)
            .navigationBarBackButtonHidden(page.canGoBack)
            .toolbar {
                if page.canGoBack {
                    ToolbarItem(placement: .topBarLeading) {
                        Button(action: page.goBack) {
                            Image(systemName: "chevron.backward").font(.system(size: 17, weight: .semibold))
                        }
                        .accessibilityLabel("Back")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if let url = page.shareURL {
                        ShareLink(item: url) {
                            Image(systemName: "square.and.arrow.up").font(.system(size: 16, weight: .semibold))
                        }
                        .accessibilityLabel("Share")
                    }
                }
            }
    }
}
