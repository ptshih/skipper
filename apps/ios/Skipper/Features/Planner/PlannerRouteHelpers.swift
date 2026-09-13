import Foundation

/// Canonical string key representing a route's propose request identity.
/// Deduplicates identical routes to prevent multiple billed Google Routes calls.
func proposeKey(for route: PlannedRoute) -> String {
    let viaPart = route.via?.joined(separator: ",") ?? ""
    return "\(route.start)->\(route.end):via=[\(viaPart)]"
}

/// Reflow an existing proposal card to the end of the conversation if the route was re-emitted.
func reflowDrawnCard<T: ProposalCardHolder>(
    cards: [T],
    route: PlannedRoute,
    afterTurn: Int
) -> [T] {
    let key = proposeKey(for: route)
    guard let index = cards.firstIndex(where: { proposeKey(for: $0.route) == key }) else {
        return cards
    }
    var copy = cards
    var item = copy.remove(at: index)
    item.afterTurn = afterTurn
    copy.append(item)
    return copy
}

protocol ProposalCardHolder {
    var route: PlannedRoute { get }
    var afterTurn: Int { get set }
}
