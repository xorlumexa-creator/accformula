/**
 * Country / dial-code / currency / language data for the signup form.
 *
 * Sourced from the `world-countries` package instead of hand-typed, so the
 * ~250 rows of names/dial-codes/currencies aren't at risk of manual transcription
 * errors. Run `npm install world-countries` (or `bun add world-countries`) —
 * it's not yet in this project's package.json.
 *
 * NOTE: world-countries has changed its calling-code field shape across major
 * versions (older: `callingCode: string[]`, newer: `idd: { root, suffixes }`).
 * The extraction below handles both so this doesn't silently break on whichever
 * version actually gets installed — but if country counts/dial codes look wrong
 * after installing, check node_modules/world-countries/dist/countries.json
 * against the shape assumed here first.
 */
import rawCountries from 'world-countries';

export interface CountryOption {
  code: string;        // ISO 3166-1 alpha-2, e.g. "BD"
  name: string;         // common name, e.g. "Bangladesh"
  flag: string;         // emoji flag
  dialCode: string;     // e.g. "+880"
  currencyCode: string; // primary currency, e.g. "BDT"
}

function extractDialCode(c: any): string {
  // Newer shape
  if (c.idd?.root) {
    const suffix = c.idd.suffixes?.[0] ?? '';
    return `${c.idd.root}${suffix}`;
  }
  // Legacy shape
  if (Array.isArray(c.callingCode) && c.callingCode[0]) {
    return `+${c.callingCode[0]}`;
  }
  return '';
}

function extractCurrency(c: any): string {
  if (c.currencies && typeof c.currencies === 'object') {
    const keys = Object.keys(c.currencies);
    if (keys.length) return keys[0];
  }
  return '';
}

export const COUNTRIES: CountryOption[] = (rawCountries as any[])
  .map((c) => ({
    code: c.cca2,
    name: c.name?.common ?? c.cca2,
    flag: c.flag ?? '',
    dialCode: extractDialCode(c),
    currencyCode: extractCurrency(c),
  }))
  .filter((c) => c.code && c.name)
  .sort((a, b) => a.name.localeCompare(b.name));

export const PHONE_CODES = COUNTRIES
  .filter((c) => c.dialCode)
  // dedupe identical dial codes (e.g. NANP countries sharing +1), keep the
  // first (largest/most common) country for each
  .filter((c, i, arr) => arr.findIndex((x) => x.dialCode === c.dialCode) === i)
  .sort((a, b) => a.dialCode.localeCompare(b.dialCode));

export interface CurrencyOption {
  code: string;
  label: string;
}

// Currency *names* aren't reliably present on every world-countries entry
// depending on version, so we label with the code itself plus a representative
// country name — accurate without depending on a field that may be missing.
export const CURRENCIES: CurrencyOption[] = Array.from(
  COUNTRIES.reduce((map, c) => {
    if (c.currencyCode && !map.has(c.currencyCode)) {
      map.set(c.currencyCode, c.name);
    }
    return map;
  }, new Map<string, string>())
).map(([code, exampleCountry]) => ({ code, label: `${code} — ${exampleCountry}` }))
  .sort((a, b) => a.code.localeCompare(b.code));

export interface LanguageOption {
  code: string;
  name: string;
}

export const LANGUAGES: LanguageOption[] = Array.from(
  (rawCountries as any[]).reduce((map, c) => {
    const langs = c.languages;
    if (langs && typeof langs === 'object') {
      for (const [code, name] of Object.entries(langs)) {
        if (!map.has(code)) map.set(code, name as string);
      }
    }
    return map;
  }, new Map<string, string>())
).map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));
       
