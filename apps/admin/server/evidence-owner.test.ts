import { expect, test } from 'bun:test'
import { assertEvidenceOwner } from './evidence-owner'

const reviewer = 'reviewer@example.test'
const drive = (email: string, role: string | null = 'user', isAnonymous: boolean | null = false) => ({
  deletedAt: null, owner: { email, role, isAnonymous },
})

test('same operator account is accepted across email casing', () => {
  expect(() => assertEvidenceOwner(drive('REVIEWER@example.test'), reviewer)).not.toThrow()
})
test('a separate app administrator can supply an operator QA drive', () => {
  expect(() => assertEvidenceOwner(drive('app@example.test', 'admin'), reviewer)).not.toThrow()
  expect(() => assertEvidenceOwner(drive('app@example.test', 'admin', null), reviewer)).not.toThrow()
})
test('unrelated ordinary and unknown-role accounts cannot supply evidence', () => {
  for (const role of ['user', null, 'superadmin', 'admin,user'])
    expect(() => assertEvidenceOwner(drive('rider@example.test', role), reviewer)).toThrow()
})
test('anonymous accounts cannot qualify by either email or an erroneous admin role', () => {
  expect(() => assertEvidenceOwner(drive(reviewer, 'user', true), reviewer)).toThrow()
  expect(() => assertEvidenceOwner(drive('guest@example.test', 'admin', true), reviewer)).toThrow()
})
test('missing, orphaned and deleted drives are ineligible', () => {
  // The inner join returns no row for both nonexistent drives and missing owners.
  expect(() => assertEvidenceOwner(undefined, reviewer)).toThrow()
  expect(() => assertEvidenceOwner({ ...drive(reviewer, 'admin'), deletedAt: new Date() }, reviewer)).toThrow()
})
