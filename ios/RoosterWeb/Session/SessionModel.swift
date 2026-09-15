import Foundation
import SwiftUI
import WebKit

/// The member's ROOSTER session. Nothing in the app shows until it is signed in and approved.
///
/// The session lives in the same cookies the site's own Identity SDK uses (nf_jwt and
/// nf_refresh, roster-session.js), in the data store every web view shares. Web pages pick it
/// up and refresh it themselves, so the app reads the cookies each time rather than keeping its
/// own copy that the site's refresh would leave stale.
@MainActor
final class SessionModel: ObservableObject {
    enum State: Equatable {
        /// Restoring a saved session at launch.
        case checking
        case signedOut
        /// Signed in, but the account isn't approved yet. Carries the server's message.
        case pending(String)
        case signedIn
    }

    @Published private(set) var state: State = .checking
    /// Changes on every sign-in, so the signed-in app is rebuilt with fresh web views.
    @Published private(set) var generation = 0

    let base: URL
    private let identity: IdentityAPI
    private var refreshTask: Task<Void, Never>?

    init(base: URL = ShellConfig.baseURL) {
        self.base = base
        identity = IdentityAPI(base: base)
    }

    // MARK: Launch

    func restore() async {
        guard state == .checking else { return }
        let savedRefresh = await cookie(Self.refreshCookie)
        let savedJWT = await cookie(Self.jwtCookie)
        guard savedRefresh != nil || savedJWT != nil else {
            state = .signedOut
            return
        }
        switch await ensureFresh() {
        case .valid, .offline:
            await confirmAccess(offlineIsFine: true)
        case .ended:
            await clear()
            state = .signedOut
        }
    }

    // MARK: Signing in and out

    func signIn(email: String, password: String) async throws {
        let tokens = try await identity.token(grant: ["grant_type": "password", "username": email, "password": password])
        await store(tokens)
        await confirmAccess(offlineIsFine: false)
        switch state {
        case .signedIn, .pending:
            return
        case .checking, .signedOut:
            throw IdentityError.message("ROOSTER couldn't check your account. Try again in a moment.")
        }
    }

    func sendPasswordReset(to email: String) async throws {
        try await identity.recover(email: email)
    }

    func signOut() async {
        if let jwt = await cookie(Self.jwtCookie) {
            await identity.logout(jwt: jwt)
        }
        await clear()
        state = .signedOut
    }

    /// A native screen got 401/403 from the API. Refresh the session; if it has really ended,
    /// return to the sign-in screen.
    func revalidate() {
        guard state == .signedIn else { return }
        Task {
            switch await ensureFresh(force: true) {
            case .ended:
                await clear()
                state = .signedOut
            case .valid:
                await confirmAccess(offlineIsFine: true)
            case .offline:
                break
            }
        }
    }

    /// Keeps the access token fresh while the app is open (it lasts an hour).
    func appBecameActive() {
        guard state == .signedIn else { return }
        refreshTask?.cancel()
        refreshTask = Task {
            while !Task.isCancelled {
                if case .ended = await ensureFresh() {
                    await clear()
                    state = .signedOut
                    return
                }
                try? await Task.sleep(for: .seconds(300))
            }
        }
    }

    func appResignedActive() {
        refreshTask?.cancel()
        refreshTask = nil
    }

    // MARK: Tokens

    private enum Freshness { case valid, offline, ended }

    private func ensureFresh(force: Bool = false) async -> Freshness {
        let jwt = await cookie(Self.jwtCookie)
        if !force, let jwt, let expiry = JWT.expiry(jwt), expiry.timeIntervalSinceNow > 600 { return .valid }
        guard let refresh = await cookie(Self.refreshCookie) else { return jwt == nil ? .ended : .valid }
        do {
            let tokens = try await identity.token(grant: ["grant_type": "refresh_token", "refresh_token": refresh])
            await store(tokens)
            return .valid
        } catch IdentityError.rejected {
            // A web page may have refreshed with the same token a moment earlier; refresh tokens are
            // single use. If the cookie has moved on, that refresh is the one that counts.
            if let current = await cookie(Self.refreshCookie), current != refresh { return .valid }
            return .ended
        } catch {
            return .offline
        }
    }

    /// Approval comes from /api/access/state, the same check every members page makes first.
    private func confirmAccess(offlineIsFine: Bool) async {
        do {
            let access = try await identity.accessState()
            if access.approved {
                if state != .signedIn { generation += 1 }
                state = .signedIn
                appBecameActive()
            } else if access.signedIn {
                state = .pending(access.message ?? "Your ROOSTER account is waiting for approval.")
            } else {
                await clear()
                state = .signedOut
            }
        } catch {
            if offlineIsFine {
                if state != .signedIn { generation += 1 }
                state = .signedIn
            } else {
                state = .signedOut
            }
        }
    }

    // MARK: Cookies

    static let jwtCookie = "nf_jwt"
    static let refreshCookie = "nf_refresh"

    private var cookieStore: WKHTTPCookieStore { WKWebsiteDataStore.default().httpCookieStore }

    private var hosts: [String] {
        Array(Set([base.host].compactMap { $0 } + ShellConfig.siteHosts))
    }

    private func cookie(_ name: String) async -> String? {
        guard let host = base.host else { return nil }
        let cookies = await cookieStore.allCookies()
        return cookies.first { $0.name == name && $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) == host }
            .flatMap { $0.value.removingPercentEncoding ?? $0.value }
    }

    private func store(_ tokens: IdentityAPI.Tokens) async {
        for host in hosts {
            await set(Self.jwtCookie, tokens.accessToken, host: host)
            if let refresh = tokens.refreshToken { await set(Self.refreshCookie, refresh, host: host) }
        }
    }

    /// Matches what the site's patched SDK writes: path /, secure, SameSite=Lax, 30 days, readable
    /// by page scripts (patch-identity.mjs).
    private func set(_ name: String, _ value: String, host: String) async {
        var properties: [HTTPCookiePropertyKey: Any] = [
            .name: name,
            .value: value.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_.~"))) ?? value,
            .domain: host,
            .path: "/",
            .expires: Date().addingTimeInterval(30 * 86_400),
            .sameSitePolicy: HTTPCookieStringPolicy.sameSiteLax,
        ]
        if base.scheme == "https" { properties[.secure] = "TRUE" }
        guard let cookie = HTTPCookie(properties: properties) else { return }
        await cookieStore.setCookie(cookie)
    }

    /// Signs out of every web view too: the Identity cookies and the SDK's saved user.
    private func clear() async {
        refreshTask?.cancel()
        let cookies = await cookieStore.allCookies()
        for cookie in cookies where [Self.jwtCookie, Self.refreshCookie].contains(cookie.name) {
            await cookieStore.deleteCookie(cookie)
        }
        let store = WKWebsiteDataStore.default()
        let types: Set<String> = [WKWebsiteDataTypeLocalStorage, WKWebsiteDataTypeSessionStorage]
        let records = await store.dataRecords(ofTypes: types)
        let site = records.filter { record in hosts.contains { $0.hasSuffix(record.displayName) || record.displayName.hasSuffix($0) } }
        await store.removeData(ofTypes: types, for: site)
    }
}

enum JWT {
    static func expiry(_ token: String) -> Date? {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return nil }
        var payload = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
        guard let data = Data(base64Encoded: payload),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = object["exp"] as? Double else { return nil }
        return Date(timeIntervalSince1970: exp)
    }
}
