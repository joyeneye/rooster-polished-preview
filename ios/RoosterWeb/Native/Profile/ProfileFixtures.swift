#if DEBUG
import Foundation

/// Tops up the shared profile fixture (NativeFixtures.profile) so a simulator capture fills
/// the concept's full 4 × 2 Top 8. Debug builds only, and only under -RoosterFixtures; the
/// people are the made-up members from the directory fixture, with the site's promo photos.
enum ProfileFixtures {
    static func enrich(_ bundle: ProfileBundle) -> ProfileBundle {
        guard NativeFixtures.enabled, let top = bundle.topEight, top.members.count < 8 else { return bundle }
        let extra: [TopEight.Card] = [
            .init(id: "a6", name: "Nia Carter", photoUrl: "/assets/slots-ads/hair-v1.jpg", profileUrl: nil),
            .init(id: "a7", name: "Brianna Cole", photoUrl: "/assets/slots-ads/rooster-radio.jpg", profileUrl: nil),
            .init(id: "a8", name: "Andre Price", photoUrl: "/assets/slots-ads/podcast-v1.jpg", profileUrl: nil),
        ]
        let known = Set(top.members.map(\.id))
        var copy = bundle
        copy.topEight = TopEight(members: Array((top.members + extra.filter { !known.contains($0.id) }).prefix(8)),
                                 mode: top.mode, editable: top.editable, availableMembers: top.availableMembers)
        return copy
    }
}
#endif
