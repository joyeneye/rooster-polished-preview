import SwiftUI

// MONA's parts for design/world-class-concept/mona.png: the glowing orb, and a reader that turns
// a markdown-ish answer into paragraphs and icon rows.

/// MONA's avatar: a red glass orb, dark at the heart and burning at the rim, threaded with fine
/// plasma filaments and wrapped in a soft glow. The filaments drift while she is thinking and hold still otherwise (and always under Reduce Motion).
struct MonaOrb: View {
    var size: CGFloat
    var active = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: !active || reduceMotion)) { context in
            orb(phase: active && !reduceMotion ? context.date.timeIntervalSinceReferenceDate : 0)
        }
        .frame(width: size, height: size)
        .shadow(color: Theme.red.opacity(0.75), radius: size * 0.22)
        .shadow(color: Theme.red.opacity(0.35), radius: size * 0.5)
        .accessibilityHidden(true)
    }

    private func orb(phase: Double) -> some View {
        ZStack {
            Circle().fill(Color.black)
            // Dark at the heart, burning at the rim, like a lit glass sphere.
            Circle().fill(RadialGradient(stops: [.init(color: Theme.red.opacity(0.08), location: 0),
                                                 .init(color: Theme.red.opacity(0.3), location: 0.6),
                                                 .init(color: Theme.red.opacity(0.85), location: 0.9),
                                                 .init(color: Theme.red, location: 1)],
                                         center: UnitPoint(x: 0.47, y: 0.47), startRadius: 0, endRadius: size * 0.5))
            Canvas { context, canvas in filaments(context, canvas, phase: phase) }
                .blendMode(.plusLighter)
            // Shade the upper right so the ball has a lit side.
            LinearGradient(colors: [.clear, .black.opacity(0.45)], startPoint: UnitPoint(x: 0.2, y: 0.85), endPoint: UnitPoint(x: 0.85, y: 0.1))
            Circle()
                .stroke(Theme.red, lineWidth: size * 0.05)
                .blur(radius: size * 0.03)
            Circle()
                .stroke(Theme.orange.opacity(0.45), lineWidth: size * 0.012)
                .blur(radius: size * 0.01)
            Ellipse()
                .fill(Color.white.opacity(0.22))
                .frame(width: size * 0.26, height: size * 0.12)
                .rotationEffect(.degrees(35))
                .offset(x: size * 0.16, y: -size * 0.28)
                .blur(radius: size * 0.04)
        }
        .clipShape(Circle())
    }

    /// Fine plasma threads across the whole sphere: tilted elliptical arcs, seeded so the orb
    /// draws the same shape at rest.
    private func filaments(_ context: GraphicsContext, _ canvas: CGSize, phase: Double) {
        let centre = CGPoint(x: canvas.width / 2, y: canvas.height / 2)
        let radius = canvas.width / 2
        func noise(_ n: Int) -> Double {
            var x = UInt64(truncatingIfNeeded: n &* 2_654_435_761 &+ 97)
            x ^= x >> 13; x = x &* 0x5bd1e995; x ^= x >> 15
            return Double(x % 10_000) / 10_000
        }
        for index in 0..<16 {
            let rx = radius * (0.45 + 0.5 * noise(index * 5))
            let ry = radius * (0.32 + 0.55 * noise(index * 5 + 1))
            let tilt = noise(index * 5 + 2) * .pi * 2 + phase * 0.25 * (index.isMultiple(of: 2) ? 1 : -1)
            let start = noise(index * 5 + 3) * .pi * 2
            let span = 1.0 + 2.0 * noise(index * 5 + 4)
            var path = Path()
            for step in 0...32 {
                let t = start + span * Double(step) / 32
                let wobble = 1 + 0.08 * sin(t * 5 + Double(index) + phase)
                let x = cos(t) * rx * wobble, y = sin(t) * ry * wobble
                let point = CGPoint(x: centre.x + x * cos(tilt) - y * sin(tilt),
                                    y: centre.y + x * sin(tilt) + y * cos(tilt))
                if step == 0 { path.move(to: point) } else { path.addLine(to: point) }
            }
            let colour: Color = switch index % 4 {
            case 0: .white.opacity(0.18)
            case 1: Theme.orange.opacity(0.4)
            default: Theme.red.opacity(0.85)
            }
            context.stroke(path, with: .color(colour),
                           style: StrokeStyle(lineWidth: radius * (0.012 + 0.018 * noise(index * 7)), lineCap: .round))
        }
    }
}

/// An answer, read as MONA writes it: paragraphs, the odd heading, and list lines that become
/// rows with an icon, a bold lead and a grey detail.
enum MonaReply {
    enum Block: Hashable {
        case text(String)
        case heading(String)
        case item(title: String, detail: String?, symbol: String)
    }

    static func blocks(_ answer: String) -> [Block] {
        var blocks: [Block] = []
        var paragraph: [String] = []
        func flush() {
            let text = paragraph.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { blocks.append(.text(text)) }
            paragraph = []
        }
        for raw in answer.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty {
                flush()
            } else if let heading = headingText(line) {
                flush()
                blocks.append(.heading(heading))
            } else if let item = listText(line) {
                flush()
                let (title, detail) = split(item)
                blocks.append(.item(title: title, detail: detail, symbol: symbol(for: title + " " + (detail ?? ""))))
            } else {
                paragraph.append(line)
            }
        }
        flush()
        return blocks
    }

    private static func headingText(_ line: String) -> String? {
        guard line.hasPrefix("#") else { return nil }
        let text = line.drop { $0 == "#" }.trimmingCharacters(in: .whitespaces)
        return text.isEmpty ? nil : unbold(text)
    }

    /// "- x", "* x", "• x", "1. x", "1) x" → "x".
    private static func listText(_ line: String) -> String? {
        for marker in ["- ", "* ", "• ", "– "] where line.hasPrefix(marker) {
            return String(line.dropFirst(marker.count)).trimmingCharacters(in: .whitespaces)
        }
        let digits = line.prefix { $0.isNumber }
        guard !digits.isEmpty, digits.count <= 2 else { return nil }
        let rest = line.dropFirst(digits.count)
        guard let mark = rest.first, mark == "." || mark == ")", rest.dropFirst().first == " " else { return nil }
        return String(rest.dropFirst(2)).trimmingCharacters(in: .whitespaces)
    }

    /// "**Week 1**: Tease a clip" or "Week 1 — Tease a clip" → ("Week 1", "Tease a clip").
    static func split(_ item: String) -> (String, String?) {
        if item.hasPrefix("**"), let close = item.dropFirst(2).range(of: "**") {
            let title = String(item[item.index(item.startIndex, offsetBy: 2)..<close.lowerBound])
                .trimmingCharacters(in: CharacterSet(charactersIn: " :"))
            let rest = item[close.upperBound...].trimmingCharacters(in: CharacterSet(charactersIn: " :—–-"))
            return (title, rest.isEmpty ? nil : unbold(rest))
        }
        for separator in [": ", " — ", " – ", " - "] {
            if let range = item.range(of: separator), item.distance(from: item.startIndex, to: range.lowerBound) <= 40 {
                let title = String(item[..<range.lowerBound])
                let rest = String(item[range.upperBound...]).trimmingCharacters(in: .whitespaces)
                return (unbold(title), rest.isEmpty ? nil : unbold(rest))
            }
        }
        return (unbold(item), nil)
    }

    private static func unbold(_ text: String) -> String {
        text.replacingOccurrences(of: "**", with: "").replacingOccurrences(of: "__", with: "")
    }

    /// An icon for a row, from what it talks about.
    static func symbol(for text: String) -> String {
        let text = text.lowercased()
        let table: [(words: [String], symbol: String)] = [
            (["live", "listening", "room", "stream"], "dot.radiowaves.left.and.right"),
            (["link", "pre-save", "presave", "url"], "link"),
            (["clip", "video", "tease", "teaser", "reel", "visual"], "play.rectangle"),
            (["caption", "write", "copy", "post", "bio"], "pencil"),
            (["playlist", "song", "track", "single", "music", "mix"], "music.note"),
            (["collab", "producer", "feature", "people", "roster", "network"], "person.2"),
            (["photo", "cover", "artwork", "image"], "photo"),
            (["email", "message", "dm", "pitch", "outreach"], "paperplane"),
            (["money", "budget", "price", "pay", "sale", "merch"], "dollarsign.circle"),
            (["day", "week", "date", "schedule", "calendar", "release"], "calendar"),
        ]
        return table.first { entry in entry.words.contains { text.contains($0) } }?.symbol ?? "sparkle"
    }

    /// Inline markdown (bold, italics, links) for a paragraph, falling back to the plain text.
    static func attributed(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }
}

/// One of MONA's list rows: the rounded icon tile, a bold line, a grey detail.
struct MonaItemRow: View {
    let title: String
    let detail: String?
    let symbol: String

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .frame(width: 44, height: 44)
                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color.white.opacity(0.08)))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                if let detail {
                    Text(MonaReply.attributed(detail)).font(.system(size: 14)).foregroundStyle(Theme.muted)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

#if DEBUG
/// A made-up exchange for simulator captures under -RoosterFixtures; never in release builds.
enum MonaFixtures {
    static let question = "Help me plan the release for Better Days"
    static let answer = """
    Here's a simple 3-week **plan** to get **Better Days** out into the world:

    - **Week 1**: Tease 15s clip
    - **Week 2**: Pre-save link
    - **Week 3**: Drop + live listening room
    """
}
#endif
