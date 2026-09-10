import { isAdmin, isSignedIn } from '@skipper/shared'

type EvidenceOwner = {
  deletedAt: Date | null
  owner: { email: string; role: string | null; isAnonymous: boolean | null }
}

/** IAP and app login identities may differ. Only an existing operator-owned drive is eligible;
 * importing evidence never transfers ownership or grants access to an ordinary rider's drive. */
export function assertEvidenceOwner(drive: EvidenceOwner | undefined, reviewer: string): void {
  const session = { user: drive?.owner }
  if (!drive || drive.deletedAt || !isSignedIn(session)
    || !(drive.owner.email.toLowerCase() === reviewer.toLowerCase() || isAdmin(session))) {
    throw new Error('QA evidence requires an active drive owned by this reviewer or a signed-in app administrator')
  }
}
