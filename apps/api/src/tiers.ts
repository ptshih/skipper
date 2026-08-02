// ⚠ THIS FILE IS NOW A RE-EXPORT. The access predicates moved to `@skipper/shared` in the 1.1 sweep
// (packages/shared/src/access.ts), because the API and the app each carried their own copy and their
// agreement was a COMMENT ("mirroring the server's tierOf") rather than a fact — while INV-9 makes
// that predicate decide both what a rider sees and whether the server hands them a gated route. A
// drift between the two was invisible on both sides, and one had already happened: the client's
// `isAdmin` did not exclude anonymous sessions until step 8b.
//
// Kept as a module rather than deleted so the API's existing importers are untouched and so this
// note sits where someone looking for the API's access logic will actually find it. The one home is
// @skipper/shared; add nothing here.

export { isAdmin, isSignedIn, tierOf, type AccessSession, type AccessSession as TierSession } from '@skipper/shared'
