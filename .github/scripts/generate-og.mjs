// Renders og-image.png (1200x630) from assets/og-template.html, replacing
// placeholders with live stats fetched from the GitHub Issues API.
//
// Invoked by .github/workflows/og-image.yml on schedule + push + dispatch.

import { chromium } from 'playwright';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const REPO = 'jeferson-scheibler/git-show-dati';
const DEMO_DAY = new Date('2026-07-02T19:00:00-03:00');
const TEMPLATE_PATH = path.join(REPO_ROOT, 'assets', 'og-template.html');
const OUTPUT_PATH = path.join(REPO_ROOT, 'og-image.png');
const TEMP_PATH = path.join(REPO_ROOT, 'og-temp.html');

async function fetchStats() {
  try {
    const url = `https://api.github.com/repos/${REPO}/issues?labels=submissao&state=all&per_page=100`;
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'git-show-og-generator',
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(`GitHub API returned ${res.status}; falling back to zero stats.`);
      return { submissions: 0, finalists: 0 };
    }
    const issues = (await res.json()).filter((i) => !i.pull_request);
    return {
      submissions: issues.length,
      finalists: issues.filter((i) => i.labels.some((l) => l.name === 'finalista')).length,
    };
  } catch (err) {
    console.warn('Stats fetch failed:', err.message);
    return { submissions: 0, finalists: 0 };
  }
}

function daysToDemo() {
  const diff = DEMO_DAY.getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / 86400000);
}

async function main() {
  const stats = await fetchStats();
  const days = daysToDemo();
  console.log(`stats: submissions=${stats.submissions} finalists=${stats.finalists} days=${days}`);

  const template = await readFile(TEMPLATE_PATH, 'utf8');
  const html = template
    .replaceAll('{{SUBMISSIONS_COUNT}}', String(stats.submissions))
    .replaceAll('{{FINALISTS_COUNT}}', String(stats.finalists))
    .replaceAll('{{DAYS_REMAINING}}', String(days));

  await writeFile(TEMP_PATH, html);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto('file://' + TEMP_PATH);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    // small extra wait so the radial gradients and CRT overlay rasterize cleanly
    await page.waitForTimeout(400);
    await page.screenshot({
      path: OUTPUT_PATH,
      type: 'png',
      clip: { x: 0, y: 0, width: 1200, height: 630 },
    });
    console.log(`wrote ${OUTPUT_PATH}`);
  } finally {
    await browser.close();
    try { await unlink(TEMP_PATH); } catch (_) {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
