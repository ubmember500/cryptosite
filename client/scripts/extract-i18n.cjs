/**
 * Extract i18n keys from the codebase.
 * Finds t("...") and t('...') calls in .jsx and .js under src/.
 * Outputs keys to stdout or merges new keys into en.json.
 *
 * Usage:
 *   node scripts/extract-i18n.cjs              # print unique keys
 *   node scripts/extract-i18n.cjs --merge     # add missing keys to en.json (key = value)
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const EN_JSON = path.join(SRC_DIR, 'locales', 'en.json');

function findJsFiles(dir, list = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== 'node_modules' && e.name !== 'locales') {
      findJsFiles(full, list);
    } else if (e.isFile() && /\.(jsx?|tsx?)$/.test(e.name)) {
      list.push(full);
    }
  }
  return list;
}

// Match t("...") and t('...') and t("...", { ... }) - capture the first argument
const T_CALL_REGEX = /\bt\s*\(\s*["']([^"']*(?:\\.[^"']*)*)["']/g;

function extractKeysFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const keys = new Set();
  let m;
  while ((m = T_CALL_REGEX.exec(content)) !== null) {
    const key = m[1].replace(/\\'/g, "'").replace(/\\"/g, '"');
    if (key.length > 0 && !key.startsWith(' ')) keys.add(key);
  }
  return keys;
}

function main() {
  const merge = process.argv.includes('--merge');
  const files = findJsFiles(SRC_DIR);
  const allKeys = new Set();
  for (const f of files) {
    for (const k of extractKeysFromFile(f)) allKeys.add(k);
  }

  if (merge) {
    let en = {};
    try {
      en = JSON.parse(fs.readFileSync(EN_JSON, 'utf8'));
    } catch (err) {
      console.error('Could not read en.json:', err.message);
      process.exit(1);
    }
    let added = 0;
    for (const key of allKeys) {
      if (!(key in en)) {
        en[key] = key;
        added++;
      }
    }
    fs.writeFileSync(EN_JSON, JSON.stringify(en, null, 2) + '\n', 'utf8');
    console.log(`en.json: ${Object.keys(en).length} keys (${added} new).`);
  } else {
    const sorted = [...allKeys].sort();
    sorted.forEach((k) => console.log(k));
    console.error(`\nTotal: ${sorted.length} unique keys. Use --merge to add missing keys to en.json.`);
  }
}

main();
