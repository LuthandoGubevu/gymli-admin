import { describe, expect, it } from 'vitest'
import { importedPeriod, parseDateLoose, parseMemberCsv } from '../../src/lib/csvImport'
import { matchesSearch } from '../../src/components/member/search'
import { cleanCellphone, checkMemberInput } from '../../src/data/actions'
import { maskCellphone, initials } from '../../src/lib/types'

describe('CSV import', () => {
  it('reads South African date styles, day first', () => {
    expect(parseDateLoose('2026-10-31')).toBe('2026-10-31')
    expect(parseDateLoose('31/10/2026')).toBe('2026-10-31')
    expect(parseDateLoose('5/1/27')).toBe('2027-01-05')
    expect(parseDateLoose('31 Oct 2026')).toBe('2026-10-31')
    expect(parseDateLoose('9 September 2026')).toBe('2026-09-09')
    expect(parseDateLoose('31/02/2026')).toBeNull()
    expect(parseDateLoose('soon')).toBeNull()
  })
  it('reads a file with a header row', () => {
    const rows = parseMemberCsv('Name,Cellphone,Paid until\n"Pieter van Wyk",082 334 9910,05/10/2026\nThabo Nkosi,+27825554101,\nBad,123,1/1/2026')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ firstName: 'Pieter', lastName: 'van Wyk', cellphone: '0823349910', paidUntil: '2026-10-05', error: null })
    expect(rows[1]).toMatchObject({ cellphone: '0825554101', paidUntil: null, error: null })
    expect(rows[2].error).toBe('Cellphone is not 10 digits')
  })
  it('reads semicolon files without a header', () => {
    const rows = parseMemberCsv('Sipho Dlamini;0836620019;2026-10-01')
    expect(rows[0]).toMatchObject({ firstName: 'Sipho', lastName: 'Dlamini', paidUntil: '2026-10-01' })
  })
  it('imported period runs from today to paid-until', () => {
    expect(importedPeriod('2026-10-31', '2026-10-01')).toEqual({ start: '2026-10-01', days: 31 })
    expect(importedPeriod('2026-09-30', '2026-10-01')).toEqual({ start: '2026-09-30', days: 1 })
  })
})

describe('members helpers', () => {
  const m = { id: '1', number: 1007, firstName: 'Thabo', lastName: 'Nkosi', cellphone: '0825554101', periods: [], fingerprint: null, createdAt: 0, deleted: false }
  it('search by name, GY-number and cellphone', () => {
    expect(matchesSearch(m, 'thabo')).toBe(true)
    expect(matchesSearch(m, 'nkosi th')).toBe(true)
    expect(matchesSearch(m, 'GY-1007')).toBe(true)
    expect(matchesSearch(m, '4101')).toBe(true)
    expect(matchesSearch(m, '27825554101')).toBe(true)
    expect(matchesSearch(m, 'lerato')).toBe(false)
  })
  it('cellphones', () => {
    expect(cleanCellphone('+27 82 555 4101')).toBe('0825554101')
    expect(maskCellphone('0825554101')).toBe('082 *** 4101')
    expect(checkMemberInput({ firstName: 'A', lastName: 'B', cellphone: '12345' }).cellphone).toBeTruthy()
    expect(checkMemberInput({ firstName: 'A', lastName: 'B', cellphone: '082 555 4101' })).toEqual({})
  })
  it('initials use first and last name', () => {
    expect(initials('Pieter van Wyk')).toBe('PW')
    expect(initials('Thabo Nkosi')).toBe('TN')
  })
})
