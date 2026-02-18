# i18n automation (EN / RU)

## How it works

- **EN / RUS** in the navbar switch the site language (stored in localStorage).
- All user-facing text uses `t('Your text')` from `useTranslation()`; keys are in `src/locales/en.json` and `src/locales/ru.json`.
- Missing keys fall back to English.

## Automating translation

### 1. Extract keys from code

Finds every `t("...")` and `t('...')` in `src/`:

```bash
npm run extract-i18n           # list keys
npm run extract-i18n:merge     # add new keys to en.json (value = key)
```

### 2. Translate en → ru

Uses [LibreTranslate](https://libretranslate.com) to fill `ru.json`:

```bash
npm run translate-i18n         # translate only keys missing in ru.json
npm run translate-i18n:all     # re-translate all keys
```

Optional env:

- `LIBRE_TRANSLATE_API_KEY` – API key (recommended for higher limits).
- `LIBRE_TRANSLATE_URL` – custom instance (default: https://libretranslate.com).

### Workflow for new pages / new text

1. Add text in code as `t('Your new string')`.
2. Run `npm run extract-i18n:merge` to add new keys to `en.json`.
3. Run `npm run translate-i18n` to translate only the new keys into `ru.json`.

No need to edit the JSON files by hand unless you want to fix or improve a translation.
