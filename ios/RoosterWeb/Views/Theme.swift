import SwiftUI
import UIKit

/// The world-class concept palette (design/world-class-concept): one dark ground, one red.
/// The app is dark only now — every token is the same in both appearances, so a light-mode
/// phone still gets the concept's look.
enum Theme {
    static let uiRed = UIColor(hex: 0xE3262F)
    static let uiOrange = UIColor(hex: 0xFF7A3D)
    static let uiGold = UIColor(hex: 0xFFBF46)
    static let uiBackground = UIColor(hex: 0x0B0B0D)
    static let uiSurface = UIColor(hex: 0x151518)
    static let uiRaised = UIColor(hex: 0x1D1D22)
    static let uiInk = UIColor(hex: 0xF5F5F7)
    static let uiMuted = UIColor(hex: 0x9A9AA2)
    static let uiLine = UIColor(hex: 0x26262B)

    static let red = Color(uiColor: uiRed)
    static let orange = Color(uiColor: uiOrange)
    static let gold = Color(uiColor: uiGold)
    static let background = Color(uiColor: uiBackground)
    static let surface = Color(uiColor: uiSurface)
    /// A step up from surface: fields, chips, the inside of a card.
    static let raised = Color(uiColor: uiRaised)
    static let ink = Color(uiColor: uiInk)
    static let muted = Color(uiColor: uiMuted)
    static let line = Color(uiColor: uiLine)
    /// Money coming in, the one place green is used.
    static let green = Color(hex: 0x2FB55D)

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
