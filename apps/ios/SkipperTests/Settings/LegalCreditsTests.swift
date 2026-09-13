import XCTest
@testable import Skipper

final class LegalCreditsTests: XCTestCase {
    func testBundledCatalogKeepsDistinctDataLicenses() {
        let sources = Dictionary(uniqueKeysWithValues: LegalCredits.sources.map { ($0.name, $0) })
        XCTAssertEqual(Set(sources.keys), ["Wikipedia", "Wikidata", "Macrostrat", "Google Places"])
        XCTAssertEqual(sources["Wikipedia"]?.license, "CC BY-SA 4.0")
        XCTAssertEqual(sources["Wikipedia"]?.licenseURL?.absoluteString, "https://creativecommons.org/licenses/by-sa/4.0/")
        XCTAssertEqual(sources["Wikidata"]?.license, "CC0 1.0")
        XCTAssertEqual(sources["Wikidata"]?.licenseURL?.absoluteString, "https://creativecommons.org/publicdomain/zero/1.0/")
        XCTAssertEqual(sources["Macrostrat"]?.license, "CC BY 4.0")
        XCTAssertEqual(sources["Macrostrat"]?.sourceURL.absoluteString, "https://macrostrat.org")
        XCTAssertNil(sources["Google Places"]?.license)
    }

    func testEveryBundledCCByTrackRetainsArtistAndLicenseLink() {
        // Frozen expectations from the shipped soundtrack, independent of the rendering implementation.
        let expected = [
            "Scott Buckley": ["Homeward", "Simplicity", "Wanderlust", "Journeys", "Felicity", "Ice Cream"],
            "Jason Shaw": ["Green Leaves", "Redwood Trail", "Paper Wings", "Landra’s Dream"],
            "Mr Smith": ["Small Town"],
            "Beat Mekanik": ["Strummin’ with Robin Smith"]
        ]
        XCTAssertEqual(Dictionary(uniqueKeysWithValues: LegalCredits.music.map { ($0.artist, $0.tracks) }), expected)
        for credit in LegalCredits.music {
            XCTAssertEqual(credit.license, "CC BY 4.0")
            XCTAssertEqual(credit.licenseURL.absoluteString, "https://creativecommons.org/licenses/by/4.0/")
            XCTAssertEqual(credit.sourceURL.scheme, "https")
            XCTAssertNotNil(credit.sourceURL.host)
        }
    }
}
