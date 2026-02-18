/**
 * Translate en.json → ru.json using LibreTranslate API.
 * New or missing keys in ru.json are translated; existing keys are kept.
 *
 * Set LIBRE_TRANSLATE_API_KEY in env for LibreTranslate (optional on some instances).
 * Or set LIBRE_TRANSLATE_URL to use a self-hosted instance (default: https://libretranslate.com).
 *
 * Usage:
 *   node scripts/translate-i18n.cjs           # translate missing keys only
 *   node scripts/translate-i18n.cjs --all     # re-translate all keys
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const EN_JSON = path.join(SRC_DIR, 'locales', 'en.json');
const RU_JSON = path.join(SRC_DIR, 'locales', 'ru.json');
const API_URL = process.env.LIBRE_TRANSLATE_URL || 'https://libretranslate.com';
const API_KEY = process.env.LIBRE_TRANSLATE_API_KEY || '';

const DELAY_MS = 500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function translateText(text) {
  const url = `${API_URL.replace(/\/$/, '')}/translate`;
  const body = {
    q: text,
    source: 'en',
    target: 'ru',
    format: 'text',
  };
  if (API_KEY) body.api_key = API_KEY;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.translatedText || text;
}

function escapeForJson(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

async function main() {
  const reTranslateAll = process.argv.includes('--all');
  let en, ru;
  try {
    en = JSON.parse(fs.readFileSync(EN_JSON, 'utf8'));
  } catch (err) {
    console.error('Could not read en.json:', err.message);
    process.exit(1);
  }
  try {
    ru = JSON.parse(fs.readFileSync(RU_JSON, 'utf8'));
  } catch {
    ru = {};
  }

  const keysToTranslate = reTranslateAll
    ? Object.keys(en)
    : Object.keys(en).filter((k) => !(k in ru) || ru[k] === k);

  if (keysToTranslate.length === 0) {
    console.log('ru.json is up to date. Use --all to re-translate everything.');
    return;
  }

  console.log(`Translating ${keysToTranslate.length} keys (en → ru)...`);
  if (!API_KEY) console.log('Tip: set LIBRE_TRANSLATE_API_KEY for higher rate limits.');

  for (let i = 0; i < keysToTranslate.length; i++) {
    const key = keysToTranslate[i];
    const source = en[key];
    if (typeof source !== 'string') {
      ru[key] = source;
      continue;
    }
    try {
      const translated = await translateText(source);
      ru[key] = translated;
      process.stdout.write(`\r${i + 1}/${keysToTranslate.length} ${key.slice(0, 40)}...`);
    } catch (err) {
      console.error(`\nFailed for key "${escapeForJson(key.slice(0, 50))}...": ${err.message}`);
      ru[key] = source;
    }
    await sleep(DELAY_MS);
  }

  fs.writeFileSync(RU_JSON, JSON.stringify(ru, null, 2) + '\n', 'utf8');
  console.log(`\nWrote ru.json (${Object.keys(ru).length} keys).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
