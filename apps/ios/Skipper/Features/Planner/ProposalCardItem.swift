import Foundation

enum ProposalCardState: Equatable, Sendable {
    case idle
    case noStops
    case creating
    case needsAccount
    case made(driveId: String)
    case failed(message: String)
}

struct ProposalCardItem: Identifiable, Equatable, Sendable, ProposalCardHolder {
    let id: String
    var afterTurn: Int
    let route: PlannedRoute
    /// One lowercase idempotency UUID minted once per proposal card and strictly preserved across auth walls and retries.
    let idempotencyKey: UUID
    var proposal: DriveProposal?
    var isLoadingProposal: Bool
    var proposalError: String?
    var state: ProposalCardState

    init(
        id: String = UUID().uuidString,
        afterTurn: Int,
        route: PlannedRoute,
        idempotencyKey: UUID = UUID(),
        proposal: DriveProposal? = nil,
        isLoadingProposal: Bool = true,
        proposalError: String? = nil,
        state: ProposalCardState = .idle
    ) {
        self.id = id
        self.afterTurn = afterTurn
        self.route = route
        self.idempotencyKey = idempotencyKey
        self.proposal = proposal
        self.isLoadingProposal = isLoadingProposal
        self.proposalError = proposalError
        self.state = state
    }
}
