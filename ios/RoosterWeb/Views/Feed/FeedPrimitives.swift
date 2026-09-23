import AVFoundation
import SwiftUI
import UIKit

extension Font {
    /// Chakra Petch, the polished layer's heading face (--rp-heading).
    static func rooster(_ size: CGFloat, weight: Font.Weight = .bold, relativeTo style: TextStyle = .title) -> Font {
        let name = switch weight {
        case .regular: "ChakraPetch-Regular"
        case .medium: "ChakraPetch-Medium"
        case .semibold: "ChakraPetch-SemiBold"
        default: "ChakraPetch-Bold"
        }
        return .custom(name, size: size, relativeTo: style)
    }

    /// Orbitron 800, used for one thing on the site: a member's name on their profile card.
    static func roosterDisplay(_ size: CGFloat, relativeTo style: TextStyle = .largeTitle) -> Font {
        .custom("Orbitron-ExtraBold", size: size, relativeTo: style)
    }

    /// Space Mono, the site's label face ("WYD FEED", "OF 500 SPOTS CLAIMED").
    static func roosterMono(_ size: CGFloat, bold: Bool = true, relativeTo style: TextStyle = .caption) -> Font {
        .custom(bold ? "SpaceMono-Bold" : "SpaceMono-Regular", size: size, relativeTo: style)
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(uiColor: UIColor(hex: hex).withAlphaComponent(opacity))
    }
}

/// The ROOSTER "R" mark, drawn from the paths in assets/rooster-logo.svg so it stays sharp at any size.
struct RoosterMarkShape: Shape {
    func path(in rect: CGRect) -> Path {
        // The mark's strokes span roughly x 12…52, y 13…53 in the SVG's own units.
        let scale = min(rect.width, rect.height) / 48
        let origin = CGPoint(x: rect.midX - 32 * scale, y: rect.midY - 33 * scale)
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: origin.x + x * scale, y: origin.y + y * scale) }
        var path = Path()
        path.move(to: p(12, 53))
        path.addLine(to: p(12, 27))
        path.addLine(to: p(38, 27))
        path.addCurve(to: p(46, 19.8), control1: p(42.8, 27), control2: p(46, 24))
        path.addCurve(to: p(38, 13), control1: p(46, 15.6), control2: p(42.8, 13))
        path.addLine(to: p(14, 13))
        path.move(to: p(27, 53))
        path.addLine(to: p(27, 37))
        path.addLine(to: p(37, 37))
        path.addLine(to: p(52, 53))
        path.addLine(to: p(40, 53))
        path.addLine(to: p(27, 39))
        return path
    }
}

struct RoosterMark: View {
    var size: CGFloat = 40
    var light = false

    var body: some View {
        RoosterMarkShape()
            .stroke(
                light
                    ? AnyShapeStyle(Color(hex: 0xFFF6E8))
                    : AnyShapeStyle(LinearGradient(colors: [Color(hex: 0xED1745), Color(hex: 0xF33B3E), Color(hex: 0xFFB347)],
                                                   startPoint: .bottomLeading, endPoint: .topTrailing)),
                style: StrokeStyle(lineWidth: size * 8 / 48, lineCap: .round, lineJoin: .round)
            )
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// A site asset (poster, avatar) by its site-relative path.
struct SiteImage: View {
    let path: String?
    var contentMode: ContentMode = .fill
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        AsyncImage(url: path.flatMap { store.siteURL($0) }, transaction: Transaction(animation: .easeOut(duration: 0.2))) { phase in
            switch phase {
            case .success(let image): image.resizable().aspectRatio(contentMode: contentMode)
            default: Color.black.opacity(0.08)
            }
        }
    }
}

/// A muted-by-default looping video that plays only while its card is on screen.
struct LoopingVideo: UIViewRepresentable {
    let url: URL
    let isPlaying: Bool
    let isMuted: Bool
    var gravity: AVLayerVideoGravity = .resizeAspectFill

    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        view.playerLayer.videoGravity = gravity
        let player = AVQueuePlayer()
        player.isMuted = isMuted
        player.preventsDisplaySleepDuringVideoPlayback = true
        context.coordinator.looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
        view.playerLayer.player = player
        return view
    }

    func updateUIView(_ view: PlayerView, context: Context) {
        guard let player = view.playerLayer.player else { return }
        player.isMuted = isMuted
        if isPlaying {
            if player.timeControlStatus != .playing { player.play() }
        } else {
            player.pause()
        }
    }

    static func dismantleUIView(_ view: PlayerView, coordinator: Coordinator) {
        view.playerLayer.player?.pause()
        coordinator.looper?.disableLooping()
        view.playerLayer.player = nil
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var looper: AVPlayerLooper?
    }

    final class PlayerView: UIView {
        override static var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}

/// Pressed cards and buttons shrink slightly, the way system controls respond to touch.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.snappy(duration: 0.18), value: configuration.isPressed)
    }
}
