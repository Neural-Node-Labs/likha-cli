#!/usr/bin/env node

/**
 * URL Summarizer AI Agent
 *
 * Fetches a URL, extracts readable content, and summarizes it using DeepSeek AI.
 *
 * Usage:
 *   node summarize.mjs <url>
 *   node summarize.mjs <url> --max-length 200
 *   node summarize.mjs <url> --lang zh
 *
 * Environment:
 *   DEEPSEEK_API_KEY  (required) — DeepSeek API key
 */

import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Config ──────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env if present
try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: resolve(__dirname, '.env') });
} catch {}

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL  = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_MODEL     = 'deepseek-chat';
const MAX_INPUT_CHARS   = 12_000; // trim content to stay within token limits

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const url  = args.find(a => a.startsWith('http://') || a.startsWith('https://'));
const maxLengthIdx = args.indexOf('--max-length');
const maxLength    = maxLengthIdx !== -1 ? parseInt(args[maxLengthIdx + 1], 10) : 150;
const langIdx      = args.indexOf('--lang');
const lang         = langIdx !== -1 ? args[langIdx + 1] : 'en';

if (!url) {
  console.error('Usage: node summarize.mjs <url> [--max-length N] [--lang en|zh|...]');
  process.exit(1);
}

if (!DEEPSEEK_API_KEY) {
  console.error('Error: DEEPSEEK_API_KEY environment variable is not set.');
  process.exit(1);
}

// ── 1. Fetch page content ──────────────────────────────────────────────────
async function fetchPage(url) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (compatible; SummarizeBot/1.0)' });
  const page    = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    const html = await page.content();
    return html;
  } finally {
    await browser.close();
  }
}

// ── 2. Extract readable text ───────────────────────────────────────────────
function extractText(html) {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, nav, footer, header, aside, iframe, noscript, svg, form, button, input, select, textarea').remove();

  const title = $('title').first().text().trim();
  const h1    = $('h1').first().text().trim();

  // Extract meaningful text blocks
  const blocks = [];
  $('p, h2, h3, h4, h5, h6, li, blockquote, td, th, pre, code, article section, .content, .article, .post, .entry, main').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text.length > 20) blocks.push(text);
  });

  // Fallback: grab all text if blocks are too few
  let body = blocks.join('\n\n');
  if (body.length < 100) {
    body = $('body').text().replace(/\s+/g, ' ').trim();
  }

  // Trim to max chars
  if (body.length > MAX_INPUT_CHARS) {
    body = body.slice(0, MAX_INPUT_CHARS) + '...';
  }

  return { title, h1, body };
}

// ── 3. Summarize via DeepSeek ──────────────────────────────────────────────
async function summarize(content, maxLength, lang) {
  const systemPrompt = `You are a precise summarization assistant. Summarize the following web page content in ${lang === 'zh' ? 'Chinese' : lang === 'ja' ? 'Japanese' : 'English'}. Be concise, factual, and capture the key points. Output only the summary, no preamble.`;

  const userPrompt = `Title: ${content.title}\n${content.h1 ? `Heading: ${content.h1}\n` : ''}\nContent:\n${content.body}\n\n---\nSummarize the above in at most ${maxLength} words.`;

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || 'No summary generated.';
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.error(`\n🔍 Fetching: ${url}\n`);

  const start = Date.now();

  try {
    const html    = await fetchPage(url);
    const content = extractText(html);

    console.error(`📄 Title: ${content.title}`);
    console.error(`📊 Content length: ${content.body.length} chars\n`);

    console.error(`🤖 Summarizing (max ${maxLength} words, lang: ${lang})...\n`);

    const summary = await summarize(content, maxLength, lang);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(summary);
    console.error(`\n✅ Done in ${elapsed}s`);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();

