import { describe, expect, it } from 'vitest'
import { checkId, checkPassport, checkSaId, formatSaId, maskId } from '../../src/lib/idNumber'
import { checkMemberInput, EMPTY_MEMBER_INPUT } from '../../src/data/actions'

const today = '2026-10-02'

describe('SA ID numbers', () => {
  it('accepts valid numbers and reads the date of birth', () => {
    expect(checkSaId('9203155108088', today)).toEqual({ ok: true, dateOfBirth: '1992-03-15' })
    expect(checkSaId('920315 5108 088', today).ok).toBe(true) // spaces are fine
    expect(checkSaId('0501015123083', today).dateOfBirth).toBe('2005-01-01')
    expect(checkSaId('8612050158082', today).dateOfBirth).toBe('1986-12-05')
  })
  it('handles 29 February in a leap year', () => {
    expect(checkSaId('0002290123088', today)).toEqual({ ok: true, dateOfBirth: '2000-02-29' })
  })
  it('a year later than this year is in the 1900s', () => {
    expect(checkSaId('9907075801081', today).dateOfBirth).toBe('1999-07-07')
  })
  it('rejects the wrong length', () => {
    expect(checkSaId('92031551080', today)).toMatchObject({ ok: false, error: 'An SA ID number has 13 digits' })
  })
  it('rejects an impossible date', () => {
    expect(checkSaId('9213155108088', today).error).toBe('The first 6 digits are not a valid date of birth')
    expect(checkSaId('0102295108088', today).ok).toBe(false) // 29 Feb 2001 does not exist
  })
  it('rejects a wrong check digit', () => {
    expect(checkSaId('9203155108087', today)).toMatchObject({ ok: false, error: 'Check the number: one digit is wrong' })
  })
  it('rejects a citizenship digit other than 0 or 1', () => {
    expect(checkSaId('9203155108288', today).ok).toBe(false)
  })
  it('formats and masks', () => {
    expect(formatSaId('9203155108088')).toBe('920315 5108 088')
    expect(maskId('sa', '088')).toBe('•••••• •••• 088')
    expect(maskId('passport', 'X12')).toBe('•••••X12')
  })
})

describe('passport numbers', () => {
  it('accepts 6 to 20 letters and numbers', () => {
    expect(checkPassport('A12345678').ok).toBe(true)
    expect(checkPassport('ab 123 456').ok).toBe(true)
    expect(checkPassport('A1-2').ok).toBe(false)
    expect(checkId('passport', '12345', today).ok).toBe(false)
  })
})

describe('member form checks', () => {
  const base = { ...EMPTY_MEMBER_INPUT, firstName: 'Thabo', lastName: 'Nkosi', cellphone: '082 555 4101' }
  it('the ID number is required for a new member', () => {
    expect(checkMemberInput(base, today, true).idNumber).toBe('Enter the SA ID number')
    expect(checkMemberInput({ ...base, idNumber: '9203155108088' }, today, true)).toEqual({})
  })
  it('editing without touching the ID is fine', () => {
    expect(checkMemberInput(base, today, false)).toEqual({})
  })
  it('passports need a typed date of birth', () => {
    const p = { ...base, idType: 'passport' as const, idNumber: 'A12345678' }
    expect(checkMemberInput(p, today, true).dateOfBirth).toBe('Enter the date of birth')
    expect(checkMemberInput({ ...p, dateOfBirth: '1990-05-01' }, today, true)).toEqual({})
  })
  it('email and emergency contact are checked when filled in', () => {
    const ok = { ...base, idNumber: '9203155108088' }
    expect(checkMemberInput({ ...ok, email: 'not-an-email' }, today, true).email).toBeTruthy()
    expect(checkMemberInput({ ...ok, email: 'thabo@gmail.com' }, today, true)).toEqual({})
    expect(checkMemberInput({ ...ok, emergencyPhone: '0832107788' }, today, true).emergencyName).toBe('Enter their name')
    expect(checkMemberInput({ ...ok, emergencyName: 'Nomvula', emergencyPhone: '123' }, today, true).emergencyPhone).toBeTruthy()
  })
})
