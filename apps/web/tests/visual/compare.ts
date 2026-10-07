/**
 * Visual check against design/gymli-design.html.
 *
 * For each screen: screenshot the matching section of the design file and the built app
 * (at 1440px and 390px), then write side-by-side images and an HTML report to
 * tests/visual/output/. Needs the emulator (seeded) and `npm run dev:emu` running.
 *
 *   npm run visual
 */
import { chromium, type Browser, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { collection, connectFirestoreEmulator, doc, getDocs, getFirestore, query, setDoc, where } from 'firebase/firestore'

const here = dirname(fileURLToPath(import.meta.url))
const DESIGN = resolve(here, '../../../../design/gymli-design.html')
const OUT = join(here, 'output')
const APP = process.env.APP_URL ?? 'http://localhost:5173'
const CHROME = process.env.CHROME_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined)

interface Shot {
  key: string
  design?: string
  path: (ids: Record<string, string>) => string
  prepare?: (p: Page) => Promise<void>
}

const SHOTS: Shot[] = [
  { key: 'today', design: '01 Today', path: () => '/' },
  { key: 'members', design: '02 Members', path: () => '/members' },
  { key: 'profile', design: '03 Member profile', path: (ids) => `/members/${ids.thabo}` },
  {
    key: 'log-payment',
    design: '04 Log payment',
    path: (ids) => `/members/${ids.thabo}`,
    prepare: async (p) => {
      await p.getByRole('button', { name: 'Log payment' }).first().click()
      await p.getByRole('radio', { name: /3\s*months/ }).click()
    },
  },
  {
    key: 'enrol',
    design: '06a Enrol fingerprint',
    path: (ids) => `/members/${ids.ntombi}`,
    prepare: async (p) => {
      await p.getByRole('button', { name: /^(re-)?enrol$/i }).first().click()
    },
  },
  { key: 'mobile-profile', design: '07 Mobile profile', path: (ids) => `/members/${ids.lerato}` },
  { key: 'door-log', path: () => '/door-log' },
  { key: 'settings', path: () => '/settings' },
]

/** Keeps the seeded check-in PC "online" so status chips match the design. */
async function heartbeat(): Promise<() => void> {
  const app = initializeApp({ apiKey: 'demo-key', projectId: 'demo-gymli' }, 'visual')
  const auth = getAuth(app)
  const db = getFirestore(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  const { user } = await signInWithEmailAndPassword(auth, 'turnstile1@gymli.local', 'gymli-demo-2026')
  const beat = () => setDoc(doc(db, 'devices', user.uid), { name: 'Turnstile 1', branchId: 'sandton', lastSeenAt: Date.now(), mode: 'simulation', readerConnected: true, relayConnected: true, pendingLogs: 0, appVersion: 'visual' })
  await beat()
  const t = setInterval(beat, 5_000)
  const members = await getDocs(query(collection(db, 'members'), where('branchId', '==', 'sandton')))
  const ids: Record<string, string> = {}
  for (const m of members.docs) ids[String(m.data().firstName).toLowerCase()] = m.id
  ;(globalThis as Record<string, unknown>).__ids = ids
  return () => clearInterval(t)
}

async function designShots(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await page.goto('file://' + DESIGN)
  await page.waitForSelector('[data-screen-label]', { timeout: 20_000 })
  await page.waitForTimeout(2500)
  for (const s of SHOTS.filter((x) => x.design)) {
    // The frame inside each labelled section is the screen itself.
    const frame = page.locator(`[data-screen-label="${s.design}"] > div:nth-child(2)`)
    await frame.screenshot({ path: join(OUT, `${s.key}-design.png`) })
  }
  await page.close()
}

async function appShots(browser: Browser, width: number, ids: Record<string, string>) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
  const page = await ctx.newPage()
  await page.goto(APP)
  await page.fill('input[type=email]', 'zodwa@gymli.co.za')
  await page.fill('input[type=password]', 'gymli-demo-2026')
  await page.click('button[type=submit]')
  await page.waitForSelector('text=Today at the gym')
  for (const s of SHOTS) {
    if (s.key === 'settings') {
      // settings is for managers
      continue
    }
    await page.goto(APP + s.path(ids))
    await page.waitForTimeout(1500)
    if (s.prepare) {
      await s.prepare(page)
      await page.waitForTimeout(800)
    }
    await page.screenshot({ path: join(OUT, `${s.key}-app-${width}.png`), fullPage: !s.prepare })
  }
  await ctx.close()
  // manager screens
  const mctx = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true })
  const mpage = await mctx.newPage()
  await mpage.goto(APP)
  await mpage.fill('input[type=email]', 'grace@gymli.co.za')
  await mpage.fill('input[type=password]', 'gymli-demo-2026')
  await mpage.click('button[type=submit]')
  await mpage.waitForSelector('text=Today at the gym')
  await mpage.goto(APP + '/settings')
  await mpage.waitForTimeout(1500)
  await mpage.screenshot({ path: join(OUT, `settings-app-${width}.png`), fullPage: true })
  await mctx.close()
}

const dataUri = (file: string) => `data:image/png;base64,${readFileSync(join(OUT, file)).toString('base64')}`

async function sideBySide(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 2000, height: 1000 } })
  const rows = SHOTS.map(
    (s) => `<section><h2>${s.key}${s.design ? ` — design “${s.design}”` : ' — not in the design'}</h2><div class="row">
      ${s.design ? `<figure><figcaption>Design</figcaption><img src="${s.key}-design.png"></figure>` : ''}
      <figure><figcaption>App 1440</figcaption><img src="${s.key}-app-1440.png"></figure>
      <figure class="phone"><figcaption>App 390</figcaption><img src="${s.key}-app-390.png"></figure></div></section>`,
  ).join('\n')
  const html = `<!doctype html><meta charset="utf-8"><title>Gymli visual check</title><style>
    body{font:14px system-ui;margin:24px;background:#f4f4f4} h2{font-size:16px} .row{display:flex;gap:16px;align-items:flex-start}
    figure{margin:0;flex:1;min-width:0} figure.phone{flex:0 0 260px} img{width:100%;border:1px solid #ccc;background:#fff} figcaption{font-weight:600;margin-bottom:4px}
  </style><h1>Gymli — design vs app</h1>${rows}`
  writeFileSync(join(OUT, 'report.html'), html)
  for (const s of SHOTS.filter((x) => x.design)) {
    await page.setContent(`<body style="margin:0;display:flex;gap:24px;background:#fff;padding:24px;font:600 22px system-ui">
      <div style="flex:1"><div>Design</div><img style="width:100%" src="${dataUri(`${s.key}-design.png`)}"></div>
      <div style="flex:1"><div>App · 1440</div><img style="width:100%" src="${dataUri(`${s.key}-app-1440.png`)}"></div></body>`)
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(OUT, `${s.key}-compare.png`), fullPage: true })
  }
  await page.close()
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const stop = await heartbeat()
  const ids = (globalThis as Record<string, unknown>).__ids as Record<string, string>
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--allow-file-access-from-files'] })
  try {
    await designShots(browser)
    await appShots(browser, 1440, ids)
    await appShots(browser, 390, ids)
    await sideBySide(browser)
  } finally {
    await browser.close()
    stop()
  }
  console.log(`Wrote ${OUT}/report.html`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
