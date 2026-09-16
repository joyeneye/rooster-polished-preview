import Foundation
import WebKit

enum FeedError: Error, Equatable {
    /// 401/403: sign-in needed. The message is the server's own.
    case locked(String)
    case failed(String)

    var message: String {
        switch self {
        case .locked(let message), .failed(let message): message
        }
    }
}

/// The site's JSON endpoints, called natively. Requests carry the web views' cookies, so once
/// a member is signed in on a web page the feed is theirs too.
struct FeedAPI {
    let base: URL
    var session: URLSession = .shared

    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    private struct StoriesBody: Decodable { let stories: [Story] }
    private struct CountBody: Decodable { let claimed: Int; let goal: Int? }
    private struct ErrorBody: Decodable { let error: String? }
    struct ActionResult: Decodable { let active: Bool?; let count: Int? }

    func stories() async throws -> [Story] {
        try await get("/api/slots/discover", as: StoriesBody.self, timeout: 12.5).stories
    }

    /// filter is "for_you" or "following" (community-home.js loadStage).
    func feed(filter: String, cursor: String? = nil) async throws -> FeedPage {
        var path = "/api/community/feed?filter=\(filter)&connection=everyone&limit=10"
        if let cursor, let encoded = cursor.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "&cursor=\(encoded)"
        }
        return try await get(path, as: FeedPage.self)
    }

    func memberCount() async throws -> Int {
        let body = try await get("/api/member-count", as: CountBody.self, timeout: 8)
        return max(0, min(500, body.claimed))
    }

    /// like, repost, bookmark and comment (with a body) — PATCH /api/community/feed.
    func act(postID: String, action: String, body: String? = nil) async throws -> ActionResult {
        var payload: [String: Any] = ["post_id": Int(postID) ?? postID, "action": action]
        if let body { payload["body"] = body }
        var request = try await request("/api/community/feed", timeout: 15)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        return try await send(request, as: ActionResult.self)
    }

    /// A write the bridge lets through (live rooms and the chat room, api/preview.js).
    func post<T: Decodable>(_ path: String, body: [String: Any], as type: T.Type, timeout: TimeInterval = 15) async throws -> T {
        var request = try await request(path, timeout: timeout)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await send(request, as: type)
    }

    /// A change the bridge lets through (a business's booking pages).
    func patch<T: Decodable>(_ path: String, body: [String: Any], as type: T.Type, timeout: TimeInterval = 15) async throws -> T {
        var request = try await request(path, timeout: timeout)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await send(request, as: type)
    }

    /// A file the bridge lets through (booking logos, covers and gallery photos).
    func upload<T: Decodable>(_ path: String, fields: [String: String], file: Data, filename: String,
                              contentType: String, as type: T.Type) async throws -> T {
        let boundary = "rooster-\(UUID().uuidString)"
        var body = Data()
        func append(_ text: String) { body.append(Data(text.utf8)) }
        for (name, value) in fields {
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n")
        }
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n")
        append("Content-Type: \(contentType)\r\n\r\n")
        body.append(file)
        append("\r\n--\(boundary)--\r\n")

        var request = try await request(path, timeout: 60)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        return try await send(request, as: type)
    }

    /// Any site JSON read, decoded with snake_case keys. Native screens use this for their data.
    func get<T: Decodable>(_ path: String, as type: T.Type, timeout: TimeInterval = 15) async throws -> T {
        try await send(request(path, timeout: timeout), as: type)
    }

    private func request(_ path: String, timeout: TimeInterval) async throws -> URLRequest {
        guard let url = ShellURL.resolve(path, base: base) else { throw FeedError.failed("ROOSTER could not connect.") }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        // The feed function rejects writes without a same-origin Origin (member-auth assertSameOrigin).
        request.setValue(base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        for (field, value) in await Self.cookieHeaders(for: url) {
            request.setValue(value, forHTTPHeaderField: field)
        }
        return request
    }

    private func send<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw FeedError.failed("ROOSTER could not connect.")
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? Self.decoder.decode(ErrorBody.self, from: data))?.error ?? "ROOSTER could not connect."
            throw status == 401 || status == 403 ? FeedError.locked(message) : FeedError.failed(message)
        }
        do {
            return try Self.decoder.decode(type, from: data)
        } catch {
            throw FeedError.failed("ROOSTER sent something unexpected.")
        }
    }

    @MainActor
    private static func cookieHeaders(for url: URL) async -> [String: String] {
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        guard let host = url.host?.lowercased() else { return [:] }
        let matching = cookies.filter { cookie in
            let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
            return host == domain || host.hasSuffix("." + domain)
        }
        return HTTPCookie.requestHeaderFields(with: matching)
    }
}
