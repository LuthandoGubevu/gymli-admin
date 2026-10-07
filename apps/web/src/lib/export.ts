/**
 * Excel and PDF exports for Accounts. The libraries load only when someone exports,
 * so the app itself stays small.
 */
import { formatRand } from './accounts'

export interface ExportColumn<T> {
  header: string
  value: (row: T) => string | number | null
  /** money = cents, shown as rands */
  type?: 'text' | 'money' | 'number'
  width?: number
}

export interface ExportSpec<T> {
  /** File name without extension */
  file: string
  title: string
  /** e.g. "Body Tone Sandton · 1 Oct 2026 – 31 Oct 2026" */
  subtitle: string
  columns: ExportColumn<T>[]
  rows: T[]
  /** Label + values per column (same order); undefined = blank */
  totals?: (string | number | undefined)[]
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export async function exportExcel<T>(spec: ExportSpec<T>): Promise<void> {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  wb.creator = 'Gymli'
  const ws = wb.addWorksheet(spec.title.slice(0, 31))
  ws.addRow([spec.title]).font = { bold: true, size: 14 }
  ws.addRow([spec.subtitle])
  ws.addRow([])
  const head = ws.addRow(spec.columns.map((c) => c.header))
  head.font = { bold: true }
  for (const r of spec.rows) {
    ws.addRow(spec.columns.map((c) => {
      const v = c.value(r)
      return c.type === 'money' && typeof v === 'number' ? v / 100 : v
    }))
  }
  if (spec.totals) {
    const t = ws.addRow(spec.totals.map((v, i) => (spec.columns[i]?.type === 'money' && typeof v === 'number' ? v / 100 : (v ?? null))))
    t.font = { bold: true }
  }
  spec.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    col.width = c.width ?? (c.type === 'money' ? 14 : 18)
    if (c.type === 'money') col.numFmt = '"R" #,##0.00'
  })
  const buf = await wb.xlsx.writeBuffer()
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${spec.file}.xlsx`)
}

export async function exportPdf<T>(spec: ExportSpec<T>): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: spec.columns.length > 6 ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(spec.title, 14, 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(92, 101, 96)
  doc.text(spec.subtitle, 14, 22)
  const cell = (c: ExportColumn<T>, v: string | number | null | undefined) =>
    v === null || v === undefined ? '' : c.type === 'money' && typeof v === 'number' ? formatRand(v).replace(/ /g, ' ') : String(v)
  autoTable(doc, {
    startY: 28,
    head: [spec.columns.map((c) => c.header)],
    body: spec.rows.map((r) => spec.columns.map((c) => cell(c, c.value(r)))),
    foot: spec.totals ? [spec.totals.map((v, i) => cell(spec.columns[i] ?? { header: '', value: () => null }, v))] : undefined,
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, textColor: [17, 19, 18] },
    headStyles: { fillColor: [17, 19, 18], textColor: [255, 255, 255], fontStyle: 'bold' },
    footStyles: { fillColor: [243, 245, 244], textColor: [17, 19, 18], fontStyle: 'bold' },
    columnStyles: Object.fromEntries(spec.columns.map((c, i) => [i, c.type === 'money' || c.type === 'number' ? { halign: 'right' } : {}])),
    didDrawPage: () => {
      doc.setFontSize(8)
      doc.setTextColor(92, 101, 96)
      doc.text(`Gymli · ${spec.title} · page ${doc.getNumberOfPages()}`, 14, doc.internal.pageSize.getHeight() - 8)
    },
  })
  download(doc.output('blob'), `${spec.file}.pdf`)
}
