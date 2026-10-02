/**
 * The pre-trial acceptance test (CLAUDE.md / brief §4), run end to end:
 * web app (browser) ⇄ Firebase emulator ⇄ Gymli Check-in (real engine + sync, simulated reader/relay).
 */
import { expect, test, type Page } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHECKIN = resolve(dirname(fileURLToPath(import.meta.url)), '../../../checkin/src/Gymli.Checkin.App')

class Kiosk {
  private proc: ChildProcessWithoutNullStreams
  private lines: string[] = []
  private cursor = 0

  constructor() {
    const data = mkdtempSync(join(tmpdir(), 'gymli-kiosk-'))
    this.proc = spawn('dotnet', ['run', '--project', CHECKIN, '--no-build', '--', '--agent'], {
      env: {
        ...process.env,
        GYMLI_DATA: data,
        GYMLI_EMULATOR_HOST: '127.0.0.1',
        GYMLI_PROJECT_ID: 'demo-gymli',
        GYMLI_DATABASE_ID: '(default)',
        GYMLI_API_KEY: 'demo-key',
        GYMLI_DEVICE_EMAIL: 'turnstile1@gymli.local',
        GYMLI_DEVICE_PASSWORD: 'gymli-demo-2026',
      },
    })
    let buf = ''
    this.proc.stdout.on('data', (d) => {
      buf += d.toString()
      const parts = buf.split('\n')
      buf = parts.pop()!
      this.lines.push(...parts.map((l) => l.trim()).filter(Boolean))
    })
  }

  send(cmd: string) {
    this.proc.stdin.write(cmd + '\n')
  }

  /** Waits for the next output line matching re (after everything already read). */
  async expectLine(re: RegExp, timeout = 20_000): Promise<string> {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      for (; this.cursor < this.lines.length; this.cursor++) {
        if (re.test(this.lines[this.cursor])) return this.lines[this.cursor++]
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error(`Kiosk never printed ${re}. Output:\n${this.lines.slice(-20).join('\n')}`)
  }

  /** Lines printed from now on, for checking that something did NOT happen. */
  mark() {
    return this.lines.length
  }
  since(mark: number) {
    return this.lines.slice(mark)
  }

  async waitForMember(number: number, predicate = () => true) {
    // the kiosk syncs every few seconds; poll its status
    for (let i = 0; i < 40; i++) {
      this.send('status')
      const s = await this.expectLine(/^STATUS/)
      if (/members=\d+/.test(s) && predicate()) return s
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error(`member ${number} never synced`)
  }

  stop() {
    this.send('quit')
    this.proc.kill()
  }
}

async function login(page: Page) {
  await page.goto('/')
  await page.fill('input[type=email]', 'zodwa@gymli.co.za')
  await page.fill('input[type=password]', 'gymli-demo-2026')
  await page.click('button[type=submit]')
  await expect(page.getByText('Today at the gym')).toBeVisible()
}

async function scan(kiosk: Kiosk, number: number | 'unknown') {
  const m = kiosk.mark()
  kiosk.send(`scan ${number}`)
  const result = await kiosk.expectLine(/^RESULT /)
  // the result stays on screen ~4 s before the next scan is read
  await new Promise((r) => setTimeout(r, 300))
  return { result, pulsed: () => kiosk.since(m).some((l) => l.startsWith('PULSE')) }
}

test('acceptance: enrol, pay, scan, expire, renew, offline, unknown finger', async ({ page }) => {
  const kiosk = new Kiosk()
  try {
    await kiosk.expectLine(/^READY/, 60_000)
    await login(page)

    // 1. Add member → enrol fingerprint (4 scans) → log 1 month → scan → WELCOME + relay pulse
    const suffix = Date.now().toString().slice(-6)
    await page.goto('/members/new')
    await page.getByLabel('First name').fill('Accept')
    await page.getByLabel('Surname').fill(`Test${suffix}`)
    await page.getByLabel('Cellphone').fill(`082${suffix}0`.slice(0, 10))
    await page.getByRole('button', { name: 'Add member' }).last().click()
    await expect(page.getByRole('dialog', { name: 'Enrol fingerprint' })).toBeVisible()
    const subtitle = await page.getByRole('dialog').getByText(/GY-\d+/).first().textContent()
    const number = Number(/GY-(\d+)/.exec(subtitle!)![1])

    for (let i = 1; i <= 4; i++) {
      await page.getByRole('button', { name: 'Capture scan' }).click()
      await kiosk.expectLine(new RegExp(`^ENROL ${i}/4`), 30_000)
    }
    await expect(page.getByTestId('enrol-headline')).toHaveText('Fingerprint enrolled', { timeout: 20_000 })
    await page.getByRole('dialog').getByRole('button', { name: 'Log payment' }).click()
    await page.getByRole('radio', { name: /^1\s*month/ }).click()
    await page.getByRole('button', { name: 'Save and update access' }).click()
    await expect(page.getByText(/can enter until/)).toBeVisible()

    // wait until the kiosk has the payment (sync every few seconds)
    let first = await scanUntil(kiosk, number, /allowed/)
    expect(first.result).toContain(`Accept Test${suffix}`)
    expect(first.pulsed()).toBe(true)

    // 2. Move the clock past the end date → DENIED "Membership ended…" → no pulse
    kiosk.send('clock 40')
    await kiosk.expectLine(/^CLOCK 40/)
    const expired = await scan(kiosk, number)
    expect(expired.result).toMatch(/^RESULT denied Membership ended /)
    expect(expired.pulsed()).toBe(false)

    // 3. Log 3 months → scan within seconds → WELCOME
    await page.getByRole('button', { name: 'Log payment' }).first().click()
    await page.getByRole('radio', { name: /^3\s*months/ }).click()
    await page.getByRole('button', { name: 'Save and update access' }).click()
    const started = Date.now()
    const renewed = await scanUntil(kiosk, number, /allowed/)
    expect(renewed.pulsed()).toBe(true)
    expect(Date.now() - started).toBeLessThan(30_000)
    kiosk.send('clock 0')
    await kiosk.expectLine(/^CLOCK 0/)

    // 4. Unplug the internet → scans still work → reconnect → door logs appear in the web app
    kiosk.send('net off')
    await kiosk.expectLine(/^NET off/)
    await new Promise((r) => setTimeout(r, 7_000)) // one sync round, so the kiosk notices it is offline
    const offline = await scan(kiosk, number)
    expect(offline.result).toMatch(/^RESULT allowed/)
    expect(offline.pulsed()).toBe(true)
    kiosk.send('status')
    expect(await kiosk.expectLine(/^STATUS/)).toMatch(/pending=[1-9]/)
    kiosk.send('net on')
    await kiosk.expectLine(/^NET on/)
    await page.goto('/door-log')
    await expect(page.getByText('while offline').first()).toBeVisible({ timeout: 30_000 })

    // 5. Unknown finger → DENIED "Fingerprint not recognised"
    const unknown = await scan(kiosk, 'unknown')
    expect(unknown.result).toBe('RESULT denied Fingerprint not recognised')
    expect(unknown.pulsed()).toBe(false)
  } finally {
    kiosk.stop()
  }
})

/** Scans every few seconds until the kiosk's result matches (waits for sync). */
async function scanUntil(kiosk: Kiosk, number: number, want: RegExp) {
  for (let i = 0; i < 8; i++) {
    const r = await scan(kiosk, number)
    if (want.test(r.result)) return r
    await new Promise((res) => setTimeout(res, 4_500))
  }
  throw new Error(`kiosk never showed ${want} for GY-${number}`)
}
