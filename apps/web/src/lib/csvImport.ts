/** CSV import of the gym's existing list: name, cellphone, paid-until date. */
import { cleanCellphone } from '../data/actions'
import { diffDays, isValidDate, makeDate, type LocalDate } from './dates'

export interface ImportRow {
  line: number
  firstName: string
  lastName: string
  cellphone: string
  paidUntil: LocalDate | null
  error: string | null
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }

/** Splits one CSV line, honouring "quoted, values". */
export function splitCsvLine(line: string, sep = ','): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

/** Accepts 2026-10-31, 31/10/2026, 31-10-2026, 31 Oct 2026, 31 October 2026. Day comes first (South Africa). */
export function parseDateLoose(raw: string): LocalDate | null {
  const s = raw.trim()
  if (!s) return null
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s)
  if (m) return check(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s)
  if (m) return check(year(+m[3]), +m[2], +m[1])
  m = /^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{2,4})$/i.exec(s)
  if (m && MONTHS[m[2].toLowerCase().slice(0, 4)] !== undefined) return check(year(+m[3]), MONTHS[m[2].toLowerCase().slice(0, 4)], +m[1])
  if (m && MONTHS[m[2].toLowerCase().slice(0, 3)] !== undefined) return check(year(+m[3]), MONTHS[m[2].toLowerCase().slice(0, 3)], +m[1])
  return null
}

const year = (y: number) => (y < 100 ? 2000 + y : y)
function check(y: number, m: number, d: number): LocalDate | null {
  const date = makeDate(y, m, d)
  return isValidDate(date) ? date : null
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

/**
 * Reads the CSV. Header row is optional; columns are found by name
 * (name / first name + surname, cellphone / phone / mobile, paid until / expiry).
 */
export function parseMemberCsv(text: string): ImportRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return []
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const head = splitCsvLine(lines[0], sep).map((h) => h.toLowerCase().replace(/[^a-z]/g, ''))
  const find = (...names: string[]) => head.findIndex((h) => names.includes(h))
  let iFirst = find('firstname', 'name1', 'first')
  let iLast = find('surname', 'lastname', 'last')
  let iName = find('name', 'fullname', 'member', 'membername')
  let iPhone = find('cellphone', 'cell', 'phone', 'mobile', 'cellphonenumber', 'phonenumber', 'cellnumber')
  let iUntil = find('paiduntil', 'paidto', 'expiry', 'expires', 'expirydate', 'enddate', 'until', 'paidtill')
  const hasHeader = iPhone >= 0 || iName >= 0 || iFirst >= 0
  if (!hasHeader) {
    iName = 0
    iPhone = 1
    iUntil = 2
    iFirst = -1
    iLast = -1
  }
  const rows: ImportRow[] = []
  lines.slice(hasHeader ? 1 : 0).forEach((line, idx) => {
    const cells = splitCsvLine(line, sep)
    const lineNo = idx + (hasHeader ? 2 : 1)
    const names = iFirst >= 0 ? { firstName: cells[iFirst] ?? '', lastName: iLast >= 0 ? (cells[iLast] ?? '') : '' } : splitName(cells[iName] ?? '')
    const phone = cleanCellphone(cells[iPhone] ?? '')
    const untilRaw = iUntil >= 0 ? (cells[iUntil] ?? '') : ''
    const paidUntil = parseDateLoose(untilRaw)
    let error: string | null = null
    if (!names.firstName) error = 'No name'
    else if (!/^0\d{9}$/.test(phone)) error = 'Cellphone is not 10 digits'
    else if (untilRaw && !paidUntil) error = `Cannot read date “${untilRaw}”`
    rows.push({ line: lineNo, firstName: names.firstName, lastName: names.lastName, cellphone: phone, paidUntil, error })
  })
  return rows
}

/**
 * The paid period created for an imported member: from today to their paid-until date,
 * or a 1-day period on that date when it is already in the past (so they show
 * "Membership ended <date>").
 */
export function importedPeriod(paidUntil: LocalDate, today: LocalDate): { start: LocalDate; days: number } {
  if (paidUntil < today) return { start: paidUntil, days: 1 }
  return { start: today, days: diffDays(today, paidUntil) + 1 }
}
