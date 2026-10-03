/**
 * Sample members and scans (from the design), relative to "today".
 * Used by seed.ts (emulator) and demo.ts (real project, for presentations).
 */
import type { PeriodKind } from '../src/lib/access'
/* ---------------- Sample members ---------------- */

export interface PeriodSpec {
  kind: PeriodKind
  qty: number
  /** end of the period, as an offset from today; start is worked out from it */
  endOffset: number
  by: 'zodwa' | 'sibusiso'
  time: string
}

export interface MemberSpec {
  number: number
  first: string
  last: string
  phone: string
  periods: PeriodSpec[]
  enrolled: boolean
  sinceOffset: number
}

export const m1 = (endOffset: number, by: PeriodSpec['by'] = 'zodwa', time = '07:12'): PeriodSpec => ({ kind: 'months', qty: 1, endOffset, by, time })
export const mN = (qty: number, endOffset: number, by: PeriodSpec['by'] = 'zodwa', time = '06:30'): PeriodSpec => ({ kind: 'months', qty, endOffset, by, time })

export const MEMBERS: MemberSpec[] = [
  { number: 1001, first: 'Keabetswe', last: 'Tau', phone: '0812305547', periods: [m1(30, 'zodwa', '06:05')], enrolled: true, sinceOffset: -120 },
  { number: 1002, first: 'Lerato', last: 'Mokoena', phone: '0794411264', periods: [mN(3, -31, 'sibusiso', '05:58'), m1(-1, 'zodwa', '06:40')], enrolled: true, sinceOffset: -122 },
  { number: 1003, first: 'Themba', last: 'Khoza', phone: '0827718830', periods: [m1(24)], enrolled: true, sinceOffset: -200 },
  { number: 1004, first: 'Ayanda', last: 'Zulu', phone: '0613392045', periods: [mN(3, 3, 'zodwa', '17:20')], enrolled: true, sinceOffset: -90 },
  { number: 1005, first: 'Precious', last: 'Mahlaba', phone: '0725519902', periods: [mN(12, 210)], enrolled: true, sinceOffset: -155 },
  { number: 1006, first: 'Sipho', last: 'Dlamini', phone: '0836620019', periods: [m1(0, 'sibusiso', '06:12')], enrolled: true, sinceOffset: -60 },
  { number: 1007, first: 'Thabo', last: 'Nkosi', phone: '0825554101', periods: [m1(-121, 'zodwa', '06:15'), mN(3, -24, 'sibusiso', '17:40'), m1(6, 'zodwa', '07:12')], enrolled: true, sinceOffset: -151 },
  { number: 1008, first: 'Johan', last: 'Botha', phone: '0824406619', periods: [m1(-11)], enrolled: true, sinceOffset: -300 },
  { number: 1009, first: 'Lindiwe', last: 'Shabalala', phone: '0749021188', periods: [mN(6, 100)], enrolled: true, sinceOffset: -260 },
  { number: 1010, first: 'Bongani', last: 'Mthembu', phone: '0731278840', periods: [m1(-3, 'sibusiso')], enrolled: true, sinceOffset: -95 },
  { number: 1011, first: 'Andile', last: 'Ngcobo', phone: '0658843021', periods: [m1(19)], enrolled: true, sinceOffset: -45 },
  { number: 1012, first: 'Willem', last: 'Pretorius', phone: '0828870053', periods: [mN(3, 41)], enrolled: true, sinceOffset: -400 },
  { number: 1013, first: 'Chantelle', last: 'Jacobs', phone: '0841197756', periods: [mN(3, 33, 'sibusiso')], enrolled: true, sinceOffset: -58 },
  { number: 1014, first: 'Ayesha', last: 'Khan', phone: '0792234418', periods: [m1(12)], enrolled: true, sinceOffset: -80 },
  { number: 1015, first: 'Kagiso', last: 'Molefe', phone: '0763305582', periods: [mN(6, 6, 'zodwa', '05:50')], enrolled: true, sinceOffset: -176 },
  { number: 1016, first: 'Ruan', last: 'Steyn', phone: '0827730941', periods: [mN(3, 45)], enrolled: true, sinceOffset: -180 },
  { number: 1017, first: 'Riaan', last: 'Pillay', phone: '0846612207', periods: [mN(6, 91, 'sibusiso')], enrolled: true, sinceOffset: -190 },
  { number: 1018, first: 'Naledi', last: 'Khumalo', phone: '0718804432', periods: [m1(1)], enrolled: true, sinceOffset: -30 },
  { number: 1019, first: 'Pieter', last: 'van Wyk', phone: '0823349910', periods: [m1(4, 'sibusiso')], enrolled: true, sinceOffset: -70 },
  { number: 1020, first: 'Busisiwe', last: 'Nxumalo', phone: '0736652267', periods: [m1(21)], enrolled: true, sinceOffset: -40 },
  { number: 1021, first: 'Fatima', last: 'Patel', phone: '0847743307', periods: [mN(3, -6, 'sibusiso')], enrolled: true, sinceOffset: -100 },
  { number: 1022, first: 'Nomsa', last: 'Ndlovu', phone: '0762218875', periods: [m1(-17)], enrolled: true, sinceOffset: -130 },
  { number: 1023, first: 'Tshepo', last: 'Maseko', phone: '0815567734', periods: [m1(15, 'sibusiso')], enrolled: true, sinceOffset: -75 },
  { number: 1024, first: 'Mpho', last: 'Sithole', phone: '0728891120', periods: [m1(-29)], enrolled: true, sinceOffset: -88 },
  { number: 1025, first: 'Kabelo', last: 'Mabena', phone: '0619906678', periods: [m1(17)], enrolled: true, sinceOffset: -50 },
  { number: 1026, first: 'Nadia', last: 'Adams', phone: '0843301196', periods: [mN(12, 300)], enrolled: true, sinceOffset: -70 },
  { number: 1027, first: 'Zanele', last: 'Mahlangu', phone: '0794458823', periods: [m1(-44, 'sibusiso')], enrolled: true, sinceOffset: -110 },
  { number: 1028, first: 'Sizwe', last: 'Ntuli', phone: '0712267745', periods: [m1(27)], enrolled: true, sinceOffset: -33 },
  { number: 1029, first: 'Refilwe', last: 'Moloi', phone: '0830074419', periods: [mN(3, 62, 'sibusiso')], enrolled: true, sinceOffset: -29 },
  { number: 1030, first: 'Ntombi', last: 'Cele', phone: '0760043312', periods: [], enrolled: false, sinceOffset: 0 },
]

/** Turnstile scans for today (design 01) and a few earlier days for the calendars. */
export const SCANS: { number: number | null; offset: number; time: string }[] = [
  { number: 1016, offset: 0, time: '08:15' },
  { number: 1017, offset: 0, time: '08:02' },
  { number: 1018, offset: 0, time: '07:20' },
  { number: 1006, offset: 0, time: '07:05' },
  { number: null, offset: 0, time: '06:47' },
  { number: 1011, offset: 0, time: '06:31' },
  { number: 1010, offset: 0, time: '06:22' },
  { number: 1004, offset: 0, time: '06:10' },
  { number: 1007, offset: 0, time: '06:03' },
  { number: 1002, offset: 0, time: '05:55' },
  { number: 1019, offset: 0, time: '05:48' },
  { number: 1015, offset: 0, time: '05:41' },
  { number: 1007, offset: -3, time: '06:10' },
  { number: 1007, offset: -2, time: '06:02' },
  { number: 1002, offset: -3, time: '05:50' },
  { number: 1002, offset: -1, time: '05:52' },
  { number: 1001, offset: -1, time: '06:20' },
]

/** A valid-looking SA ID for sample member n: born in the 1980s/90s, check digit computed. */
export function sampleSaId(n: number): string {
  const yy = 80 + (n % 20)
  const mm = String((n % 12) + 1).padStart(2, '0')
  const dd = String((n % 28) + 1).padStart(2, '0')
  const base = `${yy}${mm}${dd}${String(5000 + (n % 4000)).padStart(4, '0')}08`
  let sum = 0
  for (let i = 0; i < 12; i++) {
    let d = Number(base[11 - i])
    if (i % 2 === 0) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return base + String((10 - (sum % 10)) % 10)
}
