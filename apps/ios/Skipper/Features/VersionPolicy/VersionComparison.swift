import Foundation

/// Mirrors packages/shared/src/version.ts, including its forgiving core-segment parsing.
enum VersionComparison {
    static func compare(_ lhs: String, _ rhs: String) -> Int {
        let (a, ap) = split(lhs), (b, bp) = split(rhs)
        for index in 0..<max(a.count, b.count) {
            let av = index < a.count ? numeric(a[index]) : 0
            let bv = index < b.count ? numeric(b[index]) : 0
            if av < bv { return -1 }
            if av > bv { return 1 }
        }
        if ap.isEmpty && bp.isEmpty { return 0 }
        if ap.isEmpty { return 1 }
        if bp.isEmpty { return -1 }
        for index in 0..<max(ap.count, bp.count) {
            if index >= ap.count { return -1 }
            if index >= bp.count { return 1 }
            let av = ap[index], bv = bp[index]
            if av == bv { continue }
            let an = isNumeric(av), bn = isNumeric(bv)
            if an && bn { return numeric(av) < numeric(bv) ? -1 : 1 }
            if an != bn { return an ? -1 : 1 }
            return av.utf16.lexicographicallyPrecedes(bv.utf16) ? -1 : 1
        }
        return 0
    }

    private static func split(_ version: String) -> ([String], [String]) {
        let noBuild = version.components(separatedBy: "+")[0]
        guard let dash = noBuild.firstIndex(of: "-") else {
            return (noBuild.components(separatedBy: "."), [])
        }
        let core = String(noBuild[..<dash])
        let prerelease = String(noBuild[noBuild.index(after: dash)...])
        return (core.components(separatedBy: "."), prerelease.isEmpty ? [] : prerelease.components(separatedBy: "."))
    }

    private static func isNumeric(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.allSatisfy { $0 >= 48 && $0 <= 57 }
    }

    private static func numeric(_ value: String) -> Double {
        isNumeric(value) ? (Double(value) ?? 0) : 0
    }
}
