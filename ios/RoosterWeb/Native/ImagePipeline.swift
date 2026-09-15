import CryptoKit
import ImageIO
import SwiftUI
import UIKit
import WebKit

/// Loads site images for native screens. The site serves photos with `Cache-Control: no-store`
/// and no resized variants (member-profiles.mts:284-296), so without this every avatar would be
/// fetched again at full size on every scroll. Keeps a memory cache of decoded, downsampled
/// images and a disk cache of the original bytes.
actor ImagePipeline {
    static let shared = ImagePipeline()

    private let memory = NSCache<NSString, UIImage>()
    private let folder: URL
    private var inFlight: [String: Task<Data?, Never>] = [:]

    init() {
        memory.totalCostLimit = 96 << 20
        folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("SiteImages", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    }

    func image(for url: URL, pixelSize: CGFloat) async -> UIImage? {
        let key = "\(url.absoluteString)#\(Int(pixelSize))" as NSString
        if let cached = memory.object(forKey: key) { return cached }
        guard let data = await data(for: url), let image = Self.downsample(data, to: pixelSize) else { return nil }
        memory.setObject(image, forKey: key, cost: Int(image.size.width * image.size.height * image.scale * image.scale * 4))
        return image
    }

    private func data(for url: URL) async -> Data? {
        let name = SHA256.hash(data: Data(url.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
        let file = folder.appendingPathComponent(name)
        if let data = try? Data(contentsOf: file) { return data }
        if let task = inFlight[name] { return await task.value }
        let task = Task<Data?, Never> {
            var request = URLRequest(url: url, timeoutInterval: 30)
            for (field, value) in await Self.cookieHeaders(for: url) { request.setValue(value, forHTTPHeaderField: field) }
            guard let (data, response) = try? await URLSession.shared.data(for: request),
                  let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  http.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("image") != false else { return nil }
            try? data.write(to: file, options: .atomic)
            return data
        }
        inFlight[name] = task
        let data = await task.value
        inFlight[name] = nil
        return data
    }

    private static func downsample(_ data: Data, to pixelSize: CGFloat) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(64, pixelSize),
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }

    @MainActor
    private static func cookieHeaders(for url: URL) async -> [String: String] {
        guard let host = url.host?.lowercased() else { return [:] }
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies().filter {
            $0.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ".")) == host
        }
        return HTTPCookie.requestHeaderFields(with: cookies)
    }
}

/// A site image (avatar, poster, album photo) through the pipeline.
struct RemoteImage<Placeholder: View>: View {
    let url: URL?
    /// The largest side this image is drawn at, in points.
    var size: CGFloat = 400
    var contentMode: ContentMode = .fill
    @ViewBuilder var placeholder: () -> Placeholder

    @Environment(\.displayScale) private var scale
    @State private var image: UIImage?
    @State private var loadedURL: URL?

    var body: some View {
        ZStack {
            if let image, loadedURL == url {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode).transition(.opacity)
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            guard let url else { image = nil; return }
            let loaded = await ImagePipeline.shared.image(for: url, pixelSize: size * scale)
            withAnimation(.easeOut(duration: 0.15)) {
                image = loaded
                loadedURL = url
            }
        }
    }
}
