import Foundation
import WebKit

enum IdentityError: Error, Equatable {
    /// Identity refused the credentials or token (400/401/422). Carries a message fit to show.
    case rejected(String)
    case message(String)

    var text: String {
        switch self {
        case .rejected(let text), .message(let text): text
        }
    }
}

/// Netlify Identity (GoTrue) through the site's /.netlify/identity pass-through (api/identity.js),
/// plus the access check every members page makes first.
struct IdentityAPI {
    let base: URL
    var session: URLSession = .shared

    struct Tokens: Decodable {
        let accessToken: String
        let refreshToken: String?
    }

    struct AccessState: Decodable {
        let signedIn: Bool
        let approved: Bool
        let status: String?
        let message: String?
    }

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    func token(grant: [String: String]) async throws -> Tokens {
        var request = request("/.netlify/identity/token", method: "POST")
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(Self.form(grant).utf8)
        let (data, status) = try await send(request)
        guard (200..<300).contains(status) else { throw Self.failure(data, status: status, signingIn: grant["grant_type"] == "password") }
        return try Self.decoder.decode(Tokens.self, from: data)
    }

    func recover(email: String) async throws {
        var request = request("/.netlify/identity/recover", method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["email": email])
        let (data, status) = try await send(request)
        guard (200..<300).contains(status) else { throw Self.failure(data, status: status, signingIn: false) }
    }

    func logout(jwt: String) async {
        var request = request("/.netlify/identity/logout", method: "POST")
        request.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        _ = try? await send(request)
    }

    /// /api/access/state with the session cookie: signed in? approved?
    @MainActor
    func accessState() async throws -> AccessState {
        var request = request("/api/access/state", method: "GET")
        guard let url = request.url else { throw IdentityError.message("ROOSTER could not connect.") }
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies().filter { cookie in
            cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) == url.host
        }
        for (field, value) in HTTPCookie.requestHeaderFields(with: cookies) {
            request.setValue(value, forHTTPHeaderField: field)
        }
        let (data, status) = try await send(request)
        guard (200..<300).contains(status) else { throw IdentityError.message("ROOSTER could not connect.") }
        return try Self.decoder.decode(AccessState.self, from: data)
    }

    // MARK: -

    private func request(_ path: String, method: String) -> URLRequest {
        var request = URLRequest(url: ShellURL.resolve(path, base: base) ?? base, timeoutInterval: 20)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        // Same origin as the site, which api/identity.js requires for sign-in calls.
        request.setValue(base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        request.httpShouldHandleCookies = false
        return request
    }

    private func send(_ request: URLRequest) async throws -> (Data, Int) {
        do {
            let (data, response) = try await session.data(for: request)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        } catch {
            throw IdentityError.message("ROOSTER could not connect. Check your connection and try again.")
        }
    }

    static func form(_ fields: [String: String]) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return fields.sorted { $0.key < $1.key }
            .map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }
            .joined(separator: "&")
    }

    /// GoTrue's own wording is terse ("invalid_grant"); say what happened instead.
    static func failure(_ data: Data, status: Int, signingIn: Bool) -> IdentityError {
        let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let description = (body?["error_description"] as? String) ?? (body?["msg"] as? String) ?? (body?["error"] as? String) ?? ""
        if description.localizedCaseInsensitiveContains("not confirmed") {
            return .rejected("Confirm your email first. Check your inbox for the link from ROOSTER.")
        }
        if [400, 401, 422].contains(status) {
            return .rejected(signingIn ? "That email and password don't match a ROOSTER account." : "That didn't work. Check the email address and try again.")
        }
        if status == 429 { return .message("Too many tries. Wait a minute, then try again.") }
        return .message("ROOSTER sign-in is unavailable right now. Try again in a moment.")
    }
}
