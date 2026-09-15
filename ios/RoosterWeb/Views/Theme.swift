import SwiftUI
import UIKit

/// The site's palette, as locked in jwhitedidit-ios Theme.swift and the polished preview's
/// follow-up note (#f6f5f1 background, white cards, #ce0633 red, #ff7a3d orange, #ffbf46 gold).
/// Dark uses #1c1b1a, the body colour the polished layer actually renders in dark mode
/// (rooster-polish.css:3-4), not the #09090b the page sets on <html> underneath it.
enum Theme {
    static let uiRed = UIColor(hex: 0xCE0633)
    static let uiOrange = UIColor(hex: 0xFF7A3D)
    static let uiGold = UIColor(hex: 0xFFBF46)
    static let uiBackground = UIColor.dynamic(light: 0xF6F5F1, dark: 0x1C1B1A)
    static let uiSurface = UIColor.dynamic(light: 0xFFFFFF, dark: 0x262523)
    static let uiInk = UIColor.dynamic(light: 0x171719, dark: 0xF7F7F8)
    static let uiMuted = UIColor.dynamic(light: 0x62666D, dark: 0xAAAAB2)
    static let uiLine = UIColor.dynamic(light: 0xE6E5E1, dark: 0x303036)

    static let red = Color(uiColor: uiRed)
    static let orange = Color(uiColor: uiOrange)
    static let gold = Color(uiColor: uiGold)
    static let background = Color(uiColor: uiBackground)
    static let surface = Color(uiColor: uiSurface)
    static let ink = Color(uiColor: uiInk)
    static let muted = Color(uiColor: uiMuted)

    static func applyAppearance() {
        let tabBar = UITabBarAppearance()
        tabBar.configureWithOpaqueBackground()
        tabBar.backgroundColor = uiBackground
        tabBar.shadowColor = uiLine
        for layout in [tabBar.stackedLayoutAppearance, tabBar.inlineLayoutAppearance, tabBar.compactInlineLayoutAppearance] {
            layout.normal.iconColor = uiMuted
            layout.normal.titleTextAttributes = [.foregroundColor: uiMuted]
            layout.selected.iconColor = uiRed
            layout.selected.titleTextAttributes = [.foregroundColor: uiRed]
        }
        UITabBar.appearance().standardAppearance = tabBar
        UITabBar.appearance().scrollEdgeAppearance = tabBar

        let navBar = UINavigationBarAppearance()
        navBar.configureWithOpaqueBackground()
        navBar.backgroundColor = uiBackground
        navBar.shadowColor = uiLine
        navBar.titleTextAttributes = [.foregroundColor: uiInk, .font: UIFont.systemFont(ofSize: 17, weight: .semibold)]
        navBar.largeTitleTextAttributes = [.foregroundColor: uiInk]
        UINavigationBar.appearance().standardAppearance = navBar
        UINavigationBar.appearance().scrollEdgeAppearance = navBar
        UINavigationBar.appearance().compactAppearance = navBar
        UINavigationBar.appearance().tintColor = uiRed
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }

    static func dynamic(light: UInt32, dark: UInt32) -> UIColor {
        UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) }
    }
}
