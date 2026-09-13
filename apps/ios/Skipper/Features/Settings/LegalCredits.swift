import Foundation

/// Bundled with the soundtrack so credits remain readable without a connection.
/// Per-clip attribution is separate and travels with each narration.
enum LegalCredits {
    struct Source: Identifiable {
        let name: String
        let use: String
        let license: String?
        let licenseURL: URL?
        let sourceURL: URL
        let note: String
        var id: String { name }
    }

    struct Music: Identifiable {
        let artist: String
        let tracks: [String]
        let via: String
        let sourceURL: URL
        var id: String { artist }
        let license = "CC BY 4.0"
        let licenseURL = LegalCredits.ccBy
    }

    static let ccBy = URL(string: "https://creativecommons.org/licenses/by/4.0/")!
    static let sources: [Source] = [
        .init(name: "Wikipedia",
              use: "The stories: the facts behind the tales the skipper tells at each stop.",
              license: "CC BY-SA 4.0", licenseURL: URL(string: "https://creativecommons.org/licenses/by-sa/4.0/")!,
              sourceURL: URL(string: "https://www.wikipedia.org")!,
              note: "Article text is reused under CC BY-SA: credit is required, and adaptations carry the same license."),
        .init(name: "Wikidata",
              use: "The details: the dates, elevations, and namesakes behind certain stops.",
              license: "CC0 1.0", licenseURL: URL(string: "https://creativecommons.org/publicdomain/zero/1.0/")!,
              sourceURL: URL(string: "https://www.wikidata.org")!,
              note: "Structured data dedicated to the public domain under CC0, free to use without attribution; credited here for transparency."),
        .init(name: "Macrostrat",
              use: "The ground: the bedrock type and age under each stop, for the geology notes.",
              license: "CC BY 4.0", licenseURL: ccBy,
              sourceURL: URL(string: "https://macrostrat.org")!,
              note: "Built on U.S. Geological Survey geologic maps, which are in the public domain."),
        .init(name: "Google Places",
              use: "The places: names and categories for destinations along a route.",
              license: nil, licenseURL: nil,
              sourceURL: URL(string: "https://www.google.com/maps")!,
              note: "Used under the Google Maps Platform Terms of Service. Powered by Google.")
    ]

    // Keep all twelve CC BY tracks in Resources/Music-Licenses.md visibly credited.
    static let music: [Music] = [
        .init(artist: "Scott Buckley", tracks: ["Homeward", "Simplicity", "Wanderlust", "Journeys", "Felicity", "Ice Cream"],
              via: "scottbuckley.com.au", sourceURL: URL(string: "https://www.scottbuckley.com.au")!),
        .init(artist: "Jason Shaw", tracks: ["Green Leaves", "Redwood Trail", "Paper Wings", "Landra’s Dream"],
              via: "Audionautix", sourceURL: URL(string: "https://audionautix.com")!),
        .init(artist: "Mr Smith", tracks: ["Small Town"],
              via: "Free Music Archive", sourceURL: URL(string: "https://freemusicarchive.org/music/mr-smith/")!),
        .init(artist: "Beat Mekanik", tracks: ["Strummin’ with Robin Smith"],
              via: "Free Music Archive", sourceURL: URL(string: "https://freemusicarchive.org/music/beat-mekanik/")!)
    ]

    static let additionalMusic = "Additional drive music by Sonican, kaazoom, Moonpub, and music_for_videos, under the Pixabay Content License."
    static let pixabayLicenseURL = URL(string: "https://pixabay.com/service/license-summary/")!
}
