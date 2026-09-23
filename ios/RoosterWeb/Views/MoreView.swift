import SwiftUI

/// The site's More dialog ("Your whole world.") as a native list. The app is dark only now, so the
/// site's theme switch is gone from here.
struct MoreView: View {
    @EnvironmentObject private var store: ShellStore
    @EnvironmentObject private var session: SessionModel
    @State private var confirmingSignOut = false

    var body: some View {
        NavigationStack(path: $store.morePath) {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    VStack(alignment: .leading, spacing: 6) {
                        RoosterWordmark(size: 18)
                        ScreenTitle(text: "More")
                        Text("Your whole world.").font(.system(size: 15)).foregroundStyle(Theme.muted)
                    }
                    group("Explore ROOSTER", ShellDestination.explore)
                    group("Yours", ShellDestination.yours)
                    group("ROOSTER", ShellDestination.site)
                    Button(role: .destructive) { confirmingSignOut = true } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                            .foregroundStyle(Theme.red)
                    }
                    .buttonStyle(.designGlass)
                }
                .padding(.horizontal, Design.gutter)
                .padding(.top, 8)
                .padding(.bottom, Design.tabBarClearance)
            }
            .background(Theme.background)
            .statusBarScrim()
            .toolbar(.hidden, for: .navigationBar)
            .confirmationDialog("Sign out of ROOSTER?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { Task { await session.signOut() } }
            }
            .navigationDestination(for: AppRoute.self) { route in
                AppRouteView(route: route, stack: .more)
            }
        }
    }

    private func group(_ title: String, _ destinations: [ShellDestination]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            DesignSectionHeader(title: title)
            VStack(spacing: 0) {
                ForEach(Array(destinations.enumerated()), id: \.element) { index, destination in
                    row(destination)
                    if index < destinations.count - 1 {
                        Rectangle().fill(Theme.line).frame(height: 1).padding(.leading, 62)
                    }
                }
            }
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Design.cardRadius, style: .continuous).stroke(Theme.line))
        }
    }

    private func row(_ destination: ShellDestination) -> some View {
        Button {
            store.open(destination)
        } label: {
            HStack(spacing: 14) {
                Image(systemName: destination.symbol)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.red)
                    .frame(width: 34, height: 34)
                    .background(Theme.red.opacity(0.14), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(destination.title).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                    Text(destination.tagline).font(.footnote).foregroundStyle(Theme.muted)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.forward")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.muted.opacity(0.7))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
