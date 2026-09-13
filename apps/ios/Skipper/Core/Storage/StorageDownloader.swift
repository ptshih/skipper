import Foundation

public protocol StorageFileDownloader: Sendable {
    func downloadFile(
        from url: URL,
        to destURL: URL,
        name: String,
        onProgress: (@Sendable (Int64, Int64) -> Void)?
    ) async throws
}

public final class StorageDefaultDownloader: StorageFileDownloader, Sendable {
    public static let defaultTimeoutSeconds: TimeInterval = 30.0
    public static let maxAttempts: Int = 3
    public static let retryBaseDelaySeconds: TimeInterval = 0.4

    private let session: URLSession

    public init(session: URLSession? = nil) {
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = Self.defaultTimeoutSeconds
            config.timeoutIntervalForResource = Self.defaultTimeoutSeconds
            config.waitsForConnectivity = false
            self.session = URLSession(configuration: config)
        }
    }

    public func downloadFile(
        from url: URL,
        to destURL: URL,
        name: String,
        onProgress: (@Sendable (Int64, Int64) -> Void)? = nil
    ) async throws {
        try Task.checkCancellation()
        let fileManager = FileManager.default

        // If destination already holds non-zero regular bytes, collision is already landed
        if let existingAttrs = try? fileManager.attributesOfItem(atPath: destURL.path),
           let existingSize = existingAttrs[.size] as? Int64, existingSize > 0,
           (existingAttrs[.type] as? FileAttributeType) == .typeRegular {
            onProgress?(existingSize, existingSize)
            return
        }

        var lastError: Error?

        for attempt in 1...Self.maxAttempts {
            if Task.isCancelled {
                throw StorageError.downloadCanceled
            }

            var downloadedLocation: URL?
            do {
                let (tempLocation, response) = try await session.download(from: url)
                downloadedLocation = tempLocation

                if Task.isCancelled {
                    if let downloadedLocation {
                        try? fileManager.removeItem(at: downloadedLocation)
                    }
                    throw StorageError.downloadCanceled
                }

                if let httpResponse = response as? HTTPURLResponse, !(200...299).contains(httpResponse.statusCode) {
                    if let downloadedLocation {
                        try? fileManager.removeItem(at: downloadedLocation)
                    }
                    throw StorageError.downloadFailed(
                        name: name,
                        underlying: "HTTP \(httpResponse.statusCode)"
                    )
                }

                // Verify downloaded temp file presence and non-zero regular bytes
                let attrs = try fileManager.attributesOfItem(atPath: tempLocation.path)
                let size = attrs[.size] as? Int64 ?? 0
                guard size > 0, (attrs[.type] as? FileAttributeType) == .typeRegular else {
                    try? fileManager.removeItem(at: tempLocation)
                    throw StorageError.downloadFailed(name: name, underlying: "Zero bytes landed")
                }

                // Ensure parent directory exists
                let parentDir = destURL.deletingLastPathComponent()
                if !fileManager.fileExists(atPath: parentDir.path) {
                    try? fileManager.createDirectory(at: parentDir, withIntermediateDirectories: true)
                }

                // Check again for destination presence before move
                if let destAttrs = try? fileManager.attributesOfItem(atPath: destURL.path),
                   let destSize = destAttrs[.size] as? Int64, destSize > 0,
                   (destAttrs[.type] as? FileAttributeType) == .typeRegular {
                    // Collision: another concurrent writer landed it! Drop our temp, keep destination.
                    try? fileManager.removeItem(at: tempLocation)
                    onProgress?(destSize, destSize)
                    return
                }

                // Atomic NO-OVERWRITE placement
                do {
                    try fileManager.moveItem(at: tempLocation, to: destURL)
                    onProgress?(size, size)
                    return
                } catch {
                    // If move failed because destination already exists with bytes, treat collision as landed
                    if let destAttrs = try? fileManager.attributesOfItem(atPath: destURL.path),
                       let destSize = destAttrs[.size] as? Int64, destSize > 0,
                       (destAttrs[.type] as? FileAttributeType) == .typeRegular {
                        try? fileManager.removeItem(at: tempLocation)
                        onProgress?(destSize, destSize)
                        return
                    }
                    try? fileManager.removeItem(at: tempLocation)
                    throw error
                }
            } catch {
                if let downloadedLocation {
                    try? fileManager.removeItem(at: downloadedLocation)
                }

                if Task.isCancelled || (error as? URLError)?.code == .cancelled {
                    throw StorageError.downloadCanceled
                }

                lastError = error

                if attempt < Self.maxAttempts {
                    let delay = Self.retryBaseDelaySeconds * pow(2.0, Double(attempt - 1))
                    let delayNanoseconds = UInt64(delay * 1_000_000_000)
                    try await Task.sleep(nanoseconds: delayNanoseconds)
                }
            }
        }

        throw lastError ?? StorageError.downloadFailed(name: name, underlying: "Exhausted retries")
    }

    // MARK: - Free Space Guard

    public static func assertFreeSpaceFor(
        durationsMs: [Int?],
        message: String = "Not enough free space to download this drive.",
        path: String? = nil
    ) throws {
        let estBytes = StorageUtils.estimateDownloadBytes(durationsMs: durationsMs)
        guard estBytes > 0 else { return }

        let checkPath = path ?? (FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.path ?? "/")
        do {
            let attrs = try FileManager.default.attributesOfFileSystem(forPath: checkPath)
            if let free = attrs[.systemFreeSize] as? Int64, free > 0 {
                let required = Int64(Double(estBytes) * 1.5) + 5_000_000
                if free < required {
                    throw StorageError.insufficientStorage(message: message)
                }
            }
        } catch let err as StorageError {
            throw err
        } catch {
            // Unreadable disk space reading fails open
        }
    }
}
