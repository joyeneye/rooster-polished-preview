#if DEBUG
import Foundation

/// Home's fixture Top 8, for headless captures (-RoosterFixtures). It carries the two hosts from
/// NativeFixtures.rooms() under their room ids, so the LIVE tabs come from the same matching the
/// app does with real data (a Top 8 member who hosts a live room) rather than from a flag.
enum HomeFixtures {
    static func topEight() -> TopEight? {
        guard NativeFixtures.enabled else { return nil }
        return try? FeedAPI.decoder.decode(TopEight.self, from: Data("""
        {"mode": "custom", "editable": true, "members": [
          {"id": "4b1d7c2e-1111-4a6b-9c3d-000000000002", "name": "Marcus Lane", "photo_url": "/assets/slots-ads/podcast-v1.jpg"},
          {"id": "4b1d7c2e-1111-4a6b-9c3d-000000000001", "name": "Nia Carter", "photo_url": "/assets/slots-ads/hair-v1.jpg"},
          {"id": "a4", "name": "Pretty Boi Beats", "photo_url": "/assets/slots-ads/sports-v1.jpg"},
          {"id": "a5", "name": "Drizz", "photo_url": "/assets/slots-ads/barber-v1.jpg"},
          {"id": "a6", "name": "Reallyfe", "photo_url": "/assets/slots-ads/fashion-v1.jpg"},
          {"id": "a1", "name": "Crispbyjmalone", "photo_url": "/assets/slots-ads/rooster-radio.jpg"},
          {"id": "a2", "name": "Kubla Kahn", "photo_url": null}],
         "available_members": [
          {"id": "a1", "name": "Crispbyjmalone"}, {"id": "a2", "name": "Kubla Kahn"}, {"id": "a3", "name": "TBoneCapone"},
          {"id": "a4", "name": "Pretty Boi Beats"}, {"id": "a5", "name": "Drizz"}, {"id": "a6", "name": "Reallyfe"},
          {"id": "4b1d7c2e-1111-4a6b-9c3d-000000000001", "name": "Nia Carter"},
          {"id": "4b1d7c2e-1111-4a6b-9c3d-000000000002", "name": "Marcus Lane"}, {"id": "a9", "name": "Tasha Monroe"}]}
        """.utf8))
    }
}
#endif
