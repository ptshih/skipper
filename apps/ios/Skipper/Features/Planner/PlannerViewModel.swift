import Foundation
import Observation

@MainActor @Observable
final class PlannerViewModel {
    private(set) var turns: [PlannerTurn] = []
    var cards: [ProposalCardItem] = []
    private(set) var selectedRegion: Region? = nil
    private(set) var availableRegions: [Region] = []
    private(set) var isStreaming: Bool = false
    private(set) var streamingSay: String = ""
    private(set) var errorMessage: String? = nil
    private(set) var isSessionDone: Bool = false
    private(set) var conversationEpoch: Int = 0
    private var activeTurnToken: UUID = UUID()
    private var hasEmittedPlannerReady: Bool = false
    private var sentTurnsCount: Int = 0

    private let maxPlanDrawn: Int = 8
    private var sayBuffer = SayBuffer()
    private var creatingCardIds = Set<String>()
    private var inFlightTurnTask: Task<Void, Never>? = nil
    private var inFlightProposalTasks: [String: Task<Void, Never>] = [:]

    let planner: any PlannerService
    let api: any SkipperAPI
    let session: SessionStore
    let storage: StorageService?
    let analytics: AnalyticsTracker?
    private let defaults: UserDefaults

    var canOfferSignIn: Bool {
        AccountEntryPolicy.canOfferSignIn(in: session.state)
    }

    static let selectedRegionKey = "fm.skipper.selectedRegionId"

    init(
        planner: any PlannerService,
        api: any SkipperAPI,
        session: SessionStore,
        storage: StorageService? = nil,
        analytics: AnalyticsTracker? = nil,
        defaults: UserDefaults = .standard
    ) {
        self.planner = planner
        self.api = api
        self.session = session
        self.storage = storage
        self.analytics = analytics
        self.defaults = defaults
    }

    func loadInitialData() async {
        do {
            let bootstrap = try await api.bootstrap(rotation: 0)
            self.availableRegions = bootstrap.regions
            let cachedRegionId = defaults.string(forKey: Self.selectedRegionKey)
            self.selectedRegion = Self.pickRegion(regions: bootstrap.regions, cachedRegionId: cachedRegionId)
            if !hasEmittedPlannerReady && selectedRegion != nil {
                hasEmittedPlannerReady = true
                AnalyticsEvents.plannerReady(track: analytics)
            }
        } catch {
            // Keep default or previous region
        }
    }

    static func pickRegion(regions: [Region], cachedRegionId: String?) -> Region? {
        if let cachedRegionId, let match = regions.first(where: { $0.id == cachedRegionId }) {
            return match
        }
        return regions.first
    }

    func selectRegion(_ region: Region) {
        guard selectedRegion?.id != region.id else { return }
        selectedRegion = region
        defaults.set(region.id, forKey: Self.selectedRegionKey)
        startFresh()
    }

    func startFresh() {
        inFlightTurnTask?.cancel()
        inFlightTurnTask = nil
        for (_, task) in inFlightProposalTasks {
            task.cancel()
        }
        inFlightProposalTasks.removeAll()

        conversationEpoch += 1
        activeTurnToken = UUID()
        turns.removeAll()
        cards.removeAll()
        sayBuffer.reset()
        streamingSay = ""
        isStreaming = false
        isSessionDone = false
        errorMessage = nil
    }

    /// Reconciles proposal card states when SessionStore changes (e.g. after sign-in).
    /// Resets `.needsAccount` cards to `.idle`, preserving the card, route, and UUID idempotency key.
    /// Does NOT auto-create.
    func reconcileSessionState() {
        if session.isSignedIn {
            for index in cards.indices {
                if cards[index].state == .needsAccount {
                    cards[index].state = .idle
                }
            }
        }
    }

    var canRetryTurn: Bool {
        errorMessage != nil && turns.last?.role == .rider && !isStreaming && !isSessionDone
    }

    func retryTurn() async {
        guard canRetryTurn else { return }
        await executeTurn(retry: true)
    }

    func sendTurn(prompt: String) async {
        guard let selectedRegion else {
            self.errorMessage = "Planner is unavailable: no region selected."
            return
        }
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isStreaming, !isSessionDone else { return }

        errorMessage = nil
        let riderTurn = PlannerTurn(role: .rider, text: trimmed)
        turns.append(riderTurn)
        sentTurnsCount += 1

        await executeTurn(retry: false)
    }

    static func collapseConsecutiveTurns(_ turns: [PlannerTurn]) -> [PlannerTurn] {
        var merged: [PlannerTurn] = []
        for turn in turns {
            let trimmed = turn.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            if let last = merged.last, last.role == turn.role {
                merged[merged.count - 1] = PlannerTurn(role: last.role, text: "\(last.text)\n\n\(trimmed)")
            } else {
                merged.append(PlannerTurn(role: turn.role, text: trimmed))
            }
        }
        return merged
    }

    private func executeTurn(retry: Bool) async {
        guard let selectedRegion else {
            self.errorMessage = "Planner is unavailable: no region selected."
            return
        }
        guard !isStreaming, !isSessionDone else { return }

        let currentEpoch = conversationEpoch
        let currentToken = UUID()
        activeTurnToken = currentToken

        errorMessage = nil
        isStreaming = true
        sayBuffer.reset()
        streamingSay = ""

        AnalyticsEvents.planTurnSent(turnIndex: sentTurnsCount, retry: retry, track: analytics)

        let regionId = selectedRegion.id
        let wireTurns = Self.collapseConsecutiveTurns(turns)
        // PlannerClient rejects drawn.count > 8; keep last maxPlanDrawn entries as shipped
        let drawnRoutes = Array(cards.map(\.route).suffix(maxPlanDrawn))
        let request = DrivePlanRequest(
            turns: wireTurns,
            regionId: regionId,
            drawn: drawnRoutes
        )

        inFlightTurnTask?.cancel()
        inFlightTurnTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let response = try await self.planner.turn(request) { [weak self] delta in
                    Task { @MainActor in
                        guard let self, self.conversationEpoch == currentEpoch, self.activeTurnToken == currentToken else { return }
                        self.sayBuffer.appendDelta(delta)
                        self.streamingSay = self.sayBuffer.shown
                    }
                }

                guard self.conversationEpoch == currentEpoch, self.activeTurnToken == currentToken, !Task.isCancelled else { return }

                self.sayBuffer.flushRemaining()
                self.streamingSay = ""
                self.isStreaming = false

                let assistantTurn = PlannerTurn(role: .skipper, text: response.say)
                self.turns.append(assistantTurn)

                if response.done == true {
                    self.isSessionDone = true
                }

                if let route = response.route {
                    guard self.conversationEpoch == currentEpoch else { return }
                    self.handleRouteEmitted(route, afterTurn: self.turns.count - 1, epoch: currentEpoch)
                }
            } catch {
                guard self.conversationEpoch == currentEpoch, self.activeTurnToken == currentToken, !Task.isCancelled else { return }
                self.isStreaming = false
                self.streamingSay = ""
                if let apiError = error as? APIError {
                    if [400, 413, 429].contains(apiError.status) {
                        self.errorMessage = apiError.message
                    } else {
                        self.errorMessage = apiError.message.isEmpty ? "Could not connect to Skipper. Please try again." : apiError.message
                    }
                } else if let contractError = error as? ContractError {
                    self.errorMessage = contractError.message
                } else {
                    self.errorMessage = "Could not connect to Skipper. Please try again."
                }
            }
        }

        // Await completion of task if caller awaits
        await inFlightTurnTask?.value
    }

    private func handleRouteEmitted(_ route: PlannedRoute, afterTurn: Int, epoch: Int) {
        guard conversationEpoch == epoch else { return }
        let key = proposeKey(for: route)
        if cards.contains(where: { proposeKey(for: $0.route) == key }) {
            cards = reflowDrawnCard(cards: cards, route: route, afterTurn: afterTurn)
            // Re-emission: if the existing card was stuck in loading without an active task or had failed, retry proposal
            if let existingIndex = cards.firstIndex(where: { proposeKey(for: $0.route) == key }) {
                let existingCard = cards[existingIndex]
                if existingCard.proposal == nil && (existingCard.proposalError != nil || (existingCard.isLoadingProposal && inFlightProposalTasks[existingCard.id] == nil)) {
                    cards[existingIndex].isLoadingProposal = true
                    cards[existingIndex].proposalError = nil
                    let cardId = existingCard.id
                    let task = Task { @MainActor [weak self] in
                        guard let self else { return }
                        await self.fetchProposal(for: cardId, route: route, epoch: epoch)
                    }
                    inFlightProposalTasks[cardId] = task
                }
            }
        } else {
            let cardId = UUID().uuidString
            let idempotencyKey = UUID()
            let newCard = ProposalCardItem(
                id: cardId,
                afterTurn: afterTurn,
                route: route,
                idempotencyKey: idempotencyKey,
                isLoadingProposal: true
            )
            cards.append(newCard)

            let task = Task { @MainActor [weak self] in
                guard let self else { return }
                await self.fetchProposal(for: cardId, route: route, epoch: epoch)
            }
            inFlightProposalTasks[cardId] = task
        }
    }

    private func fetchProposal(for cardId: String, route: PlannedRoute, epoch: Int) async {
        guard conversationEpoch == epoch, !Task.isCancelled else { return }
        defer { inFlightProposalTasks.removeValue(forKey: cardId) }

        do {
            let proposal = try await api.propose(DriveProposeRequest(route: route))
            guard conversationEpoch == epoch, !Task.isCancelled else { return }
            if let idx = cards.firstIndex(where: { $0.id == cardId }) {
                cards[idx].proposal = proposal
                cards[idx].isLoadingProposal = false
                cards[idx].proposalError = nil
                if proposal.estStopCount == 0 {
                    cards[idx].state = .noStops
                }
            }
            AnalyticsEvents.proposalShown(
                stopCount: proposal.estStopCount,
                durationMin: max(1.0, Double(proposal.durationSeconds) / 60.0),
                roundTrip: proposal.startId == proposal.endId,
                hasClip: proposal.previewClip != nil,
                track: analytics
            )
        } catch {
            guard conversationEpoch == epoch, !Task.isCancelled else { return }
            if let apiError = error as? APIError, apiError.status == 401 {
                if let idx = cards.firstIndex(where: { $0.id == cardId }) {
                    cards[idx].state = .needsAccount
                    cards[idx].isLoadingProposal = false
                }
                AnalyticsEvents.wallShown(source: "propose", track: analytics)
                return
            }
            if let idx = cards.firstIndex(where: { $0.id == cardId }) {
                cards[idx].isLoadingProposal = false
                cards[idx].proposalError = "Could not estimate route."
            }
        }
    }

    func makeDrive(cardId: String, onNavigate: @escaping @MainActor (String) -> Void) async {
        guard let index = cards.firstIndex(where: { $0.id == cardId }) else { return }
        let card = cards[index]

        // Quiet road check: proposals with estStopCount == 0 must not offer or create drives
        guard card.state != .noStops, card.proposal?.estStopCount != 0 else { return }

        // Double-tap synchronous protection
        guard !creatingCardIds.contains(cardId) else { return }
        creatingCardIds.insert(cardId)
        cards[index].state = .creating

        defer {
            creatingCardIds.remove(cardId)
        }

        // Account requirement check: anonymous users cannot spend drive credits
        guard session.isSignedIn else {
            cards[index].state = .needsAccount
            AnalyticsEvents.wallShown(source: "create_drive", track: analytics)
            return
        }

        let request = CreateDriveRequest(route: card.route, idempotencyKey: card.idempotencyKey)

        do {
            let manifest = try await api.create(request)
            guard let driveId = manifest.driveId, !driveId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                if let idx = cards.firstIndex(where: { $0.id == cardId }) {
                    cards[idx].state = .failed(message: "Server returned incomplete drive manifest.")
                }
                return
            }
            if let idx = cards.firstIndex(where: { $0.id == cardId }) {
                cards[idx].state = .made(driveId: driveId)
            }

            AnalyticsEvents.driveCreated(track: analytics)

            // Trigger non-blocking background download if storage service is present
            if let storage {
                let detail = StorageSavedDriveDetail(manifest: manifest)
                Task {
                    _ = try? await storage.downloadDrive(driveId: driveId, detail: detail)
                }
            }

            onNavigate(driveId)
        } catch let apiError as APIError where apiError.status == 401 {
            if let idx = cards.firstIndex(where: { $0.id == cardId }) {
                cards[idx].state = .needsAccount
            }
            AnalyticsEvents.wallShown(source: "create_drive", track: analytics)
        } catch {
            if let idx = cards.firstIndex(where: { $0.id == cardId }) {
                cards[idx].state = .failed(message: error.localizedDescription)
            }
        }
    }
}

extension StorageSavedDriveDetail {
    init(manifest: DriveManifest) {
        let savedClips = manifest.clips.map { clip -> StorageSavedDriveClip in
            let storageKind: StorageSubjectKind? = {
                switch clip.subjectKind {
                case .poi: return .poi
                case .cluster: return .cluster
                case nil: return nil
                }
            }()
            let storageAttributions = clip.attribution?.map { attr in
                StorageAttribution(
                    source: attr.source.rawValue,
                    sourceId: attr.sourceId,
                    title: attr.title,
                    url: attr.url,
                    license: attr.license,
                    retrievedAt: attr.retrievedAt
                )
            }
            return StorageSavedDriveClip(
                seq: clip.seq,
                form: clip.form.rawValue,
                alongSec: clip.alongSec,
                poiId: clip.poiId,
                subjectId: clip.subjectId,
                subjectKind: storageKind,
                name: clip.name,
                lat: clip.lat,
                lng: clip.lng,
                triggerRadiusM: clip.triggerRadiusM,
                approachHeadingDeg: clip.approachHeadingDeg,
                durationMs: clip.durationMs,
                contentType: clip.contentType,
                attribution: storageAttributions,
                revisedAt: clip.revisedAt,
                url: clip.url
            )
        }
        self.init(
            driveId: manifest.driveId,
            label: manifest.label,
            polyline: manifest.polyline.map { [$0.longitude, $0.latitude] },
            distanceMeters: manifest.distanceMeters,
            durationSeconds: manifest.durationSeconds,
            clips: savedClips
        )
    }
}
