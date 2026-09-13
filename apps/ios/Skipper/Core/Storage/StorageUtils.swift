import Foundation

public enum StorageUtils {
    public static let unknownRev = "0"
    public static let approxBytesPerSec: Int64 = 8_000 // 64 kbps AAC

    private static let uuidRegex: NSRegularExpression = {
        try! NSRegularExpression(pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    }()

    // MARK: - Extension Mapping

    public static func extForContentType(_ contentType: String?) -> String {
        guard let contentType else { return "mp3" }
        let trimmed = contentType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch trimmed {
        case "audio/mpeg", "audio/mp3":
            return "mp3"
        case "audio/wav", "audio/x-wav":
            return "wav"
        case "audio/aac":
            return "aac"
        case "audio/mp4", "audio/x-m4a", "audio/m4a":
            return "m4a"
        case "audio/ogg", "application/ogg":
            return "ogg"
        default:
            return "mp3"
        }
    }

    // MARK: - Safe Filenames & Subject Keys

    public static func isSafeSubjectId(_ id: Any?) -> Bool {
        guard let idString = id as? String, !idString.isEmpty else { return false }
        let range = NSRange(location: 0, length: idString.utf16.count)
        return uuidRegex.firstMatch(in: idString, options: [], range: range) != nil
    }

    public static func isSafeLocalName(_ name: Any?) -> Bool {
        guard let nameString = name as? String, !nameString.isEmpty else { return false }
        if nameString == "." || nameString == ".." { return false }
        if nameString.contains("/") || nameString.contains("\\") || nameString.contains("\0") { return false }
        return true
    }

    public static func revisionToken(_ revisedAt: Any?) -> String {
        guard let revString = revisedAt as? String, !revString.isEmpty else {
            return unknownRev
        }

        // Normalize fractional seconds to exactly 3 digits (matching ECMAScript Date.parse truncation)
        // e.g. .1 -> .100, .12 -> .120, .123 -> .123, .123456 -> .123, .9999 -> .999
        var normalized = revString
        if let dotIndex = revString.firstIndex(of: ".") {
            let afterDot = revString[revString.index(after: dotIndex)...]
            var digits = ""
            var remainderIndex = afterDot.startIndex
            for ch in afterDot {
                if ch.isNumber {
                    digits.append(ch)
                    remainderIndex = revString.index(after: remainderIndex)
                } else {
                    break
                }
            }
            if !digits.isEmpty {
                let msDigits: String
                if digits.count >= 3 {
                    msDigits = String(digits.prefix(3))
                } else {
                    msDigits = digits.padding(toLength: 3, withPad: "0", startingAt: 0)
                }
                let remainder = revString[remainderIndex...]
                normalized = "\(revString[..<dotIndex]).\(msDigits)\(remainder)"
            }
        }

        let isoOptions: [ISO8601DateFormatter.Options] = [
            [.withInternetDateTime, .withFractionalSeconds],
            [.withInternetDateTime],
            [.withFullDate, .withTime, .withColonSeparatorInTime, .withTimeZone]
        ]
        for opts in isoOptions {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = opts
            if let date = formatter.date(from: normalized) {
                let ms = Int64(round(date.timeIntervalSince1970 * 1000))
                return ms >= 0 ? String(ms) : unknownRev
            }
        }
        let posixFormats = [
            "yyyy-MM-dd'T'HH:mm:ss.SSSSSSZZZZZ",
            "yyyy-MM-dd'T'HH:mm:ss.SSSZZZZZ",
            "yyyy-MM-dd'T'HH:mm:ssZZZZZ",
            "yyyy-MM-dd'T'HH:mmZZZZZ"
        ]
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = TimeZone(secondsFromGMT: 0)
        for fmt in posixFormats {
            df.dateFormat = fmt
            if let date = df.date(from: normalized) {
                let ms = Int64(round(date.timeIntervalSince1970 * 1000))
                return ms >= 0 ? String(ms) : unknownRev
            }
        }
        return unknownRev
    }

    public static func storeFileName(key: StorageStoreKey, contentType: String) throws -> String {
        guard isSafeSubjectId(key.subjectId),
              !key.rev.isEmpty,
              key.rev.allSatisfy({ $0.isNumber }) else {
            throw StorageError.unsafeSubjectKey
        }
        let ext = extForContentType(contentType)
        return "\(key.subjectKind.rawValue)-\(key.subjectId).\(key.rev).\(ext)"
    }

    public static func parseStoreFileName(_ name: Any?) -> StorageStoreKey? {
        guard let nameString = name as? String else { return nil }
        let parts = nameString.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        let head = String(parts[0])
        let rev = String(parts[1])
        let ext = String(parts[2])

        guard !head.isEmpty, !rev.isEmpty, !ext.isEmpty else { return nil }
        guard rev.allSatisfy({ $0.isNumber }) else { return nil }
        guard ext.allSatisfy({ $0.isLetter || $0.isNumber }) else { return nil }

        guard let dashIndex = head.firstIndex(of: "-"), dashIndex > head.startIndex else {
            return nil
        }

        let kindPart = String(head[..<dashIndex])
        let subjectIdPart = String(head[head.index(after: dashIndex)...])

        guard let kind = StorageSubjectKind(rawValue: kindPart) else { return nil }
        guard isSafeSubjectId(subjectIdPart) else { return nil }

        return StorageStoreKey(subjectId: subjectIdPart, subjectKind: kind, rev: rev)
    }

    public static func storeKeyForClip(
        poiId: Any?,
        subjectId: Any?,
        subjectKind: Any?,
        revisedAt: Any?
    ) -> StorageStoreKey? {
        let rev = revisionToken(revisedAt)
        let kindString = subjectKind as? String

        if subjectId != nil {
            guard isSafeSubjectId(subjectId) else { return nil }
            let sId = subjectId as! String
            if kindString == nil {
                return StorageStoreKey(subjectId: sId, subjectKind: .poi, rev: rev)
            }
            if let kind = StorageSubjectKind(rawValue: kindString!) {
                return StorageStoreKey(subjectId: sId, subjectKind: kind, rev: rev)
            }
            return nil
        }

        if kindString == "cluster" {
            return nil
        }

        if isSafeSubjectId(poiId) {
            return StorageStoreKey(subjectId: poiId as! String, subjectKind: .poi, rev: rev)
        }

        return nil
    }

    // MARK: - Completeness & Audio Predicates

    public static func hasDownloadableAudio(contentType: String?) -> Bool {
        guard let contentType else { return false }
        return !contentType.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public static func expectedAudioSeqs(_ clips: [StorageSavedDriveClip]) -> [Int] {
        return clips
            .filter { hasDownloadableAudio(contentType: $0.contentType) }
            .map { $0.seq }
            .sorted()
    }

    public static func missingAudioSeqs(expectedSeqs: [Int], savedSeqs: [Int]) -> [Int] {
        let saved = Set(savedSeqs)
        return expectedSeqs.filter { !saved.contains($0) }.sorted()
    }

    // MARK: - Gate Evaluation

    public static func decideDriveGate(
        online: Bool,
        hasAnyLocal: Bool,
        missingCount: Int
    ) -> StorageDriveGate {
        if hasAnyLocal && missingCount == 0 {
            return .play
        }
        if online {
            return .needsDownload
        }
        if hasAnyLocal {
            return .play
        }
        return .nothingSaved
    }

    // MARK: - Content Signature & Freshness

    public static func contentSignature(detailClips: [[String: Any]]) -> String {
        var parts: [String] = []
        for c in detailClips {
            guard let seq = c["seq"] as? Int else { continue }
            let rev = (c["revisedAt"] as? String) ?? ""
            parts.push("\(seq):\(rev)")
        }
        parts.sort()
        return parts.joined(separator: ",")
    }

    public static func daysSinceIso(_ isoString: String?, now: Date = Date()) -> Double? {
        guard let isoString, !isoString.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = formatter.date(from: isoString)
        if date == nil {
            formatter.formatOptions = [.withInternetDateTime]
            date = formatter.date(from: isoString)
        }
        guard let validDate = date else { return nil }
        let ageSeconds = now.timeIntervalSince(validDate)
        return max(0, ageSeconds / (24.0 * 3600.0))
    }

    public static func isPastTtl(_ isoString: String?, now: Date = Date(), ttlDays: Double = 30.0) -> Bool {
        guard let days = daysSinceIso(isoString, now: now) else { return false }
        return days > ttlDays
    }

    // MARK: - Keep Set & Sweep Math

    public static func driveIdsToSweep(onDisk: [String], keep: [String], busy: [String] = []) -> [String] {
        let keepSet = Set(keep)
        let busySet = Set(busy)
        var out = [String]()
        var seen = Set<String>()
        for id in onDisk {
            if !keepSet.contains(id) && !busySet.contains(id) && !seen.contains(id) {
                out.append(id)
                seen.insert(id)
            }
        }
        return out
    }

    public static func storeKeepSet(manifests: [[String: Any]]) -> Set<String> {
        var keep = Set<String>()
        for m in manifests {
            guard let clips = m["clips"] as? [String: Any] else { continue }
            for (_, value) in clips {
                guard let e = value as? [String: Any] else { continue }
                let shared = e["shared"] as? Bool ?? false
                if shared, let name = e["name"] as? String, !name.isEmpty {
                    keep.insert(name)
                }
            }
        }
        return keep
    }

    public static func orphanStoreNames(
        onDisk: [String],
        keep: Set<String>,
        busy: Set<String> = []
    ) -> [String] {
        var out = [String]()
        var seen = Set<String>()
        for name in onDisk {
            if keep.contains(name) || busy.contains(name) {
                continue
            }
            if parseStoreFileName(name) == nil {
                continue
            }
            if !seen.contains(name) {
                seen.insert(name)
                out.append(name)
            }
        }
        return out
    }

    // MARK: - Clip Resolution

    public static func resolveClipRef(
        planned: StorageStoredClipRef,
        plannedPresent: Bool,
        saved: StorageStoredClipRef?,
        savedPresent: Bool
    ) -> (ref: StorageStoredClipRef?, missing: Bool) {
        if plannedPresent {
            return (ref: planned, missing: false)
        }
        if let saved, savedPresent {
            return (ref: saved, missing: true)
        }
        return (ref: nil, missing: true)
    }

    public static func estimateDownloadBytes(durationsMs: [Int?]) -> Int64 {
        return durationsMs.reduce(0) { sum, ms in
            let sec = Double(max(0, ms ?? 0)) / 1000.0
            return sum + Int64(sec * Double(approxBytesPerSec))
        }
    }

    // MARK: - V4 -> V5 Pure Migration Planning

    public static func planV4Rekey(raw: [String: Any]) -> [StorageV4RekeyStep] {
        guard (raw["version"] as? Int) == 4 else { return [] }
        guard let clips = raw["clips"] as? [String: Any] else { return [] }
        let detail = raw["detail"] as? [String: Any]
        let detailClips = (detail?["clips"] as? [[String: Any]]) ?? []

        var bySeq = [Int: [String: Any]]()
        for d in detailClips {
            if let s = d["seq"] as? Int, bySeq[s] == nil {
                bySeq[s] = d
            }
        }

        var steps = [StorageV4RekeyStep]()
        for (seqStr, value) in clips {
            guard let seq = Int(seqStr) else { continue }
            guard let e = value as? [String: Any] else { continue }
            guard let fromName = e["name"] as? String, !fromName.isEmpty else { continue }
            let contentType = (e["contentType"] as? String) ?? ""
            let durationMs = e["durationMs"] as? Int

            let d = bySeq[seq]
            let key = d != nil ? storeKeyForClip(
                poiId: d?["poiId"],
                subjectId: d?["subjectId"],
                subjectKind: d?["subjectKind"],
                revisedAt: d?["revisedAt"]
            ) : nil

            let toName: String?
            if let key {
                toName = try? storeFileName(key: key, contentType: contentType)
            } else {
                toName = nil
            }

            steps.append(StorageV4RekeyStep(
                seq: seq,
                fromName: fromName,
                toName: toName,
                contentType: contentType,
                durationMs: durationMs
            ))
        }

        steps.sort { $0.seq < $1.seq }
        return steps
    }

    public static func migrateV4ToV5(
        raw: [String: Any],
        placed: Set<String>
    ) -> [String: Any]? {
        guard (raw["version"] as? Int) == 4 else { return raw }
        let steps = planV4Rekey(raw: raw)
        var newClips = [String: [String: Any]]()

        for step in steps {
            let toName = step.toName
            let landed = toName != nil && placed.contains(toName!)
            let name = landed ? toName! : step.fromName

            var entry: [String: Any] = [
                "name": name,
                "contentType": step.contentType,
                "shared": landed
            ]
            if let dur = step.durationMs {
                entry["durationMs"] = dur
            } else {
                entry["durationMs"] = NSNull()
            }
            newClips[String(step.seq)] = entry
        }

        var updated = raw
        updated["version"] = 5
        updated["clips"] = newClips
        return updated
    }
}

private extension Array {
    mutating func push(_ element: Element) {
        append(element)
    }
}
