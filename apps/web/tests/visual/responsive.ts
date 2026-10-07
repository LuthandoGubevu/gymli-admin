/**
 * Width sweep: every screen, both roles, phone to desktop. Fails (exit 1) when a page
 * scrolls sideways or the top bar wraps onto a second line. Screenshots go to
 * tests/visual/output/responsive/.
 *
 *   npm run emulators   (seeded with npm run seed)
 *   npm run dev:emu
 *   npm run visual:responsive
 */
import { chromium, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'output', 'responsive')
const BASE = process.env.APP_URL ?? 'http://localhost:5173'
const CHROME = process.env.CHROME_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined)
const WIDTHS = [390, 768, 820, 1024, 1180, 1280, 1376, 1440]
const PASSWORD = 'gymli-demo-2026'

interface Step {
  name: string
  go: (p: Page) => Promise<void>
}

const visit = (path: string) => async (p: Page) => {
  await p.goto(BASE + path)
  await p.waitForTimeout(900)
}

const STEPS: Record<'manager' | 'front_desk', Step[]> = {
  manager: [
    { name: 'today', go: visit('/') },
    { name: 'members', go: visit('/members') },
    {
      name: 'profile',
      go: async (p) => {
        await visit('/members')(p)
        await p.getByPlaceholder('Search name, cellphone or GY-number').first().fill('1007')
        await p.waitForTimeout(400)
        await p.getByText('Thabo Nkosi').first().click()
        await p.waitForTimeout(900)
      },
    },
    {
      name: 'log-payment',
      go: async (p) => {
        await p.getByRole('button', { name: /^Log payment$/ }).first().click()
        await p.waitForTimeout(600)
      },
    },
    { name: 'add-member', go: visit('/members/new') },
    { name: 'door-log', go: visit('/door-log') },
    { name: 'accounts', go: visit('/accounts') },
    ...['Daily cash-up', 'Branches', 'Renewals due', 'Busiest hours'].map((t) => ({
      name: 'accounts-' + t.toLowerCase().replace(/\W+/g, '-'),
      go: async (p: Page) => {
        await p.getByRole('tab', { name: t }).click()
        await p.waitForTimeout(700)
      },
    })),
    { name: 'settings', go: visit('/settings') },
  ],
  front_desk: [
    { name: 'today', go: visit('/') },
    { name: 'members', go: visit('/members') },
    { name: 'door-log', go: visit('/door-log') },
  ],
}

async function signIn(p: Page, email: string) {
  await p.goto(BASE + '/')
  await p.getByLabel(/email/i).fill(email)
  await p.getByLabel(/password/i).fill(PASSWORD)
  await p.getByRole('button', { name: /sign in/i }).click()
  await p.getByText('Today at the gym').waitFor({ timeout: 20_000 })
}

async function check(p: Page, label: string, problems: string[]) {
  const r = await p.evaluate(() => {
    const bar = document.querySelector('[data-testid="topbar"]') as HTMLElement | null
    return { scroll: document.documentElement.scrollWidth, width: window.innerWidth, bar: bar ? bar.getBoundingClientRect().height : null }
  })
  const expectedBar = r.width < 768 ? 44 : 56
  if (r.scroll > r.width) problems.push(`${label}: page scrolls sideways (${r.scroll} > ${r.width})`)
  // 0 = hidden (the phone member profile has its own header)
  if (r.bar !== null && r.bar > 0 && Math.round(r.bar) !== expectedBar) problems.push(`${label}: top bar is ${Math.round(r.bar)}px high (wrapped)`)
  await p.screenshot({ path: join(OUT, `${label}.png`), fullPage: true })
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: CHROME })
  const problems: string[] = []
  for (const [role, email] of [['manager', 'grace@gymli.co.za'], ['front_desk', 'zodwa@gymli.co.za']] as const) {
    for (const w of WIDTHS) {
      const page = await browser.newPage({ viewport: { width: w, height: w < 768 ? 844 : 900 } })
      await signIn(page, email)
      for (const s of STEPS[role]) {
        await s.go(page)
        await check(page, `${role}-${w}-${s.name}`, problems)
      }
      await page.close()
    }
  }
  // Sign-in page
  for (const w of WIDTHS) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } })
    await page.goto(BASE + '/')
    await page.waitForTimeout(600)
    await check(page, `signin-${w}`, problems)
    await page.close()
  }
  await browser.close()
  if (problems.length) {
    console.log(problems.join('\n'))
    console.log(`${problems.length} problem(s)`)
    process.exit(1)
  }
  console.log(`No overflow or wrapped top bar at ${WIDTHS.join(', ')} px`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
