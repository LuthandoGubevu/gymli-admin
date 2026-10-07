import { describe, expect, it } from 'vitest'
import { pickBranch } from '../../src/lib/branch'

const branches = [
  { id: 'b1', name: 'Sandton' },
  { id: 'b2', name: 'Soweto' },
]

describe('pickBranch', () => {
  it('front desk always gets their own branch, whatever was chosen', () => {
    expect(pickBranch({ role: 'front_desk', branchId: 'b2' }, branches, 'b1')?.id).toBe('b2')
  })
  it('front desk without a branch gets none', () => {
    expect(pickBranch({ role: 'front_desk', branchId: null }, branches, 'b1')).toBeNull()
  })
  it('a manager gets the branch they chose', () => {
    expect(pickBranch({ role: 'manager', branchId: null }, branches, 'b2')?.id).toBe('b2')
  })
  it('a manager falls back to the first branch when the choice is gone', () => {
    expect(pickBranch({ role: 'manager', branchId: null }, branches, 'deleted')?.id).toBe('b1')
    expect(pickBranch({ role: 'manager', branchId: null }, branches, null)?.id).toBe('b1')
  })
  it('no branches yet means none', () => {
    expect(pickBranch({ role: 'manager', branchId: null }, [], null)).toBeNull()
  })
})
