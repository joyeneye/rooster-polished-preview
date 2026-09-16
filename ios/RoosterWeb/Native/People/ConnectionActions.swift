import Foundation

/// Sending and answering roster requests (friends.mts:197-229, 252-267).
///
/// The site writes its own plain-English replies for every outcome — already friends,
/// already asked, they asked you first — so the app shows what the site says rather
/// than inventing its own wording.
struct ConnectionActions {
    let api: FeedAPI

    private struct Reply: Decodable {
        let state: String?
        let message: String?
        let requestId: String?
    }

    /// What the site made of it: the message to show, and where the two of you now stand.
    struct Outcome {
        let message: String
        let state: Relationship?
    }

    /// Asks someone to be on your roster. The member is a query parameter, not a body
    /// field (friends.mts:42-46), and repeated sends never accept a request.
    func request(_ memberId: String) async -> Outcome {
        guard !memberId.isEmpty else { return Outcome(message: "That profile isn't available.", state: nil) }
        do {
            let reply = try await api.post("/api/friends/add?target_id=\(ProfileModel.encode(memberId))",
                                           body: [:], as: Reply.self)
            return Outcome(message: reply.message ?? "Roster request sent.",
                           state: reply.state.flatMap(Relationship.init(rawValue:)))
        } catch let error as FeedError {
            return Outcome(message: error.message, state: nil)
        } catch {
            return Outcome(message: "That request didn't send. Try again.", state: nil)
        }
    }

    /// Answers one waiting for you. The site refuses a second answer with a 409
    /// (friends.mts:265), which surfaces as its own message.
    func answer(_ requestId: String, accept: Bool) async -> String {
        do {
            let reply = try await api.post("/api/friend-requests/respond",
                                           body: ["request_id": requestId, "action": accept ? "accept" : "decline"],
                                           as: Reply.self)
            return reply.message ?? (accept ? "They're on your roster." : "Request declined.")
        } catch let error as FeedError {
            return error.message
        } catch {
            return "That didn't go through. Try again."
        }
    }
}
