import type { Branch, Staff } from './types'

/** Which branch to show: front desk always their own; managers their last choice, else the first. */
export function pickBranch(staff: Pick<Staff, 'role' | 'branchId'>, branches: Branch[], chosen: string | null): Branch | null {
  if (staff.role !== 'manager') return branches.find((b) => b.id === staff.branchId) ?? null
  return branches.find((b) => b.id === chosen) ?? branches[0] ?? null
}
