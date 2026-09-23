import SwiftUI

// The Review Room's own parts (design/world-class-concept/review.png), built from DesignKit.

extension View {
    /// The concept's header: "REVIEW ROOM" in Orbitron in the middle, the queue on the right. The
    /// system back button stays so swiping back still works.
    func reviewRoomChrome(queue: Int?) -> some View {
        self
            .background(Theme.background)
            .navigationTitle("Review Room")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarRole(.editor)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("REVIEW ROOM")
                        .font(.roosterDisplay(17, relativeTo: .headline))
                        .tracking(2)
                        .foregroundStyle(Theme.ink)
                        .accessibilityAddTraits(.isHeader)
                }
                if let queue {
                    if #available(iOS 26.0, *) {
                        ToolbarItem(placement: .topBarTrailing) { QueueCount(count: queue) }
                            .sharedBackgroundVisibility(.hidden)
                    } else {
                        ToolbarItem(placement: .topBarTrailing) { QueueCount(count: queue) }
                    }
                }
            }
            .solidTopEdge()
    }

    /// A text field on a card: raised fill, hairline, tile corners.
    func reviewField(minHeight: CGFloat = 46) -> some View {
        self
            .font(.system(size: 15))
            .foregroundStyle(Theme.ink)
            .tint(Theme.red)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(minHeight: minHeight, alignment: .topLeading)
            .background(Theme.raised.opacity(0.6), in: RoundedRectangle(cornerRadius: Design.tileRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Design.tileRadius, style: .continuous).stroke(Theme.line))
    }
}

/// "3 in queue", plain text as in the concept rather than a glass button.
private struct QueueCount: View {
    let count: Int

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "person.2.fill").font(.system(size: 12))
            Text("\(count) in queue").font(.system(size: 13, weight: .medium))
        }
        .foregroundStyle(Theme.muted)
        .fixedSize()
        .accessibilityElement(children: .combine)
    }
}

/// Cover art for a submission. The Review Room doesn't take artwork, so a track gets a sleeve of
/// its own: the brand gradient at an angle set by the track, its initials, and a waveform.
struct TrackCover: View {
    let track: ReviewRoom.Track
    var size: CGFloat = 112

    var body: some View {
        let angle = Double(abs(track.publicId.hashValueStable) % 360)
        ZStack(alignment: .bottomLeading) {
            LinearGradient(colors: [Theme.red, Theme.orange.opacity(0.85), Theme.surface],
                           startPoint: UnitPoint(x: 0.5 + 0.5 * cos(angle * .pi / 180), y: 0),
                           endPoint: UnitPoint(x: 0.5 - 0.5 * cos(angle * .pi / 180), y: 1))
            LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .top, endPoint: .bottom)
            WaveformBars(seed: track.id, progress: 0, bars: 18, height: size * 0.22)
                .opacity(0.5)
                .padding(.horizontal, size * 0.1)
                .frame(maxHeight: .infinity, alignment: .center)
            Text(initials)
                .font(.roosterDisplay(size * 0.2))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .padding(size * 0.09)
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: Design.tileRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Design.tileRadius, style: .continuous).stroke(Color.white.opacity(0.08)))
        .accessibilityHidden(true)
    }

    private var initials: String {
        let words = (track.title?.nilIfEmpty ?? "Untitled").split(separator: " ").prefix(2)
        return words.compactMap(\.first).map(String.init).joined().uppercased()
    }
}

private extension String {
    /// String.hashValue changes every launch; a cover should look the same every time.
    var hashValueStable: Int {
        unicodeScalars.reduce(5381) { ($0 &<< 5) &+ $0 &+ Int($1.value) }
    }
}

/// Chips that wrap onto a second line instead of running off the card.
struct ChipFlow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { x = 0; y += line + spacing; line = 0 }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, width), height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX { x = bounds.minX; y += line + spacing; line = 0 }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}

/// A 1–10 score: red up to the value, grey after, a white thumb. Drag or tap anywhere on it;
/// VoiceOver swipes it up and down.
struct ScoreSlider: View {
    let title: String
    @Binding var value: Int
    var enabled = true

    var body: some View {
        GeometryReader { proxy in
            let thumb: CGFloat = 16
            let fraction = CGFloat(value - 1) / 9
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.raised).frame(height: 5)
                Capsule().fill(Theme.red).frame(width: thumb / 2 + fraction * (proxy.size.width - thumb), height: 5)
                if enabled {
                    Circle().fill(Theme.ink)
                        .frame(width: thumb, height: thumb)
                        .shadow(color: .black.opacity(0.4), radius: 3, y: 1)
                        .offset(x: fraction * (proxy.size.width - thumb))
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { drag in
                guard enabled else { return }
                let raw = (drag.location.x - thumb / 2) / max(1, proxy.size.width - thumb)
                set(Int((min(1, max(0, raw)) * 9).rounded()) + 1)
            })
        }
        .frame(height: 26)
        .accessibilityElement()
        .accessibilityLabel(title)
        .accessibilityValue("\(value) out of 10")
        .accessibilityAdjustableAction { direction in
            guard enabled else { return }
            switch direction {
            case .increment: set(value + 1)
            case .decrement: set(value - 1)
            @unknown default: break
            }
        }
    }

    private func set(_ new: Int) {
        let clamped = min(10, max(1, new))
        guard clamped != value else { return }
        value = clamped
        UISelectionFeedbackGenerator().selectionChanged()
    }
}

/// The overall score as a red ring out of 10.
struct ScoreRing: View {
    let value: Double
    var size: CGFloat = 96

    var body: some View {
        ZStack {
            Circle().stroke(Theme.raised, lineWidth: size * 0.09)
            Circle()
                .trim(from: 0, to: max(0, min(1, value / 10)))
                .stroke(Theme.red, style: StrokeStyle(lineWidth: size * 0.09, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .shadow(color: Theme.red.opacity(0.45), radius: 6)
            Text(value.formatted(.number.precision(.fractionLength(1))))
                .font(.system(size: size * 0.3, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(Theme.ink)
                .contentTransition(.numericText(value: value))
        }
        .frame(width: size, height: size)
        .animation(.snappy, value: value)
        .accessibilityElement()
        .accessibilityLabel("Overall score")
        .accessibilityValue("\(value.formatted(.number.precision(.fractionLength(1)))) out of 10")
    }
}

/// The track's waveform, red where it has played, and a scrubber: drag across it to seek.
/// It draws the file's real loudness once it has downloaded; until then a faint placeholder.
struct ReviewWaveform: View {
    let levels: [Float]?
    let placeholderSeed: Int
    let progress: Double
    let scrub: ((Double) -> Void)?

    var body: some View {
        GeometryReader { proxy in
            let bars = levels ?? []
            let count = max(1, bars.count)
            let gap: CGFloat = 2
            let width = max(1.5, (proxy.size.width - gap * CGFloat(count - 1)) / CGFloat(count))
            Group {
                if bars.isEmpty {
                    WaveformBars(seed: placeholderSeed, progress: 0, bars: 60, height: proxy.size.height)
                        .opacity(0.35)
                } else {
                    HStack(alignment: .center, spacing: gap) {
                        ForEach(bars.indices, id: \.self) { index in
                            Capsule()
                                .fill(Double(index) / Double(count) < progress ? Theme.red : Theme.muted.opacity(0.45))
                                .frame(width: width, height: max(3, proxy.size.height * CGFloat(0.12 + 0.88 * bars[index])))
                        }
                    }
                    .frame(width: proxy.size.width, height: proxy.size.height)
                }
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { drag in
                scrub?(min(1, max(0, drag.location.x / max(1, proxy.size.width))))
            })
        }
        .accessibilityElement()
        .accessibilityLabel("Track position")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: scrub?(min(1, progress + 0.05))
            case .decrement: scrub?(max(0, progress - 0.05))
            @unknown default: break
            }
        }
    }
}

enum TrackTime {
    static func string(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let whole = Int(seconds.rounded(.down))
        return "\(whole / 60):" + String(format: "%02d", whole % 60)
    }
}
