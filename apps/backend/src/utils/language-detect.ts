/**
 * Lightweight, dependency-free language detection for inbound customer
 * messages. Deterministic and fast (runs on every inbound message): script
 * analysis first (Arabic, Cyrillic, CJK, ...), then Latin-alphabet languages
 * via stop-word evidence. Returns an ISO 639-1 code or 'unknown' — callers
 * treat 'unknown' as "mirror the customer's language" rather than guessing.
 *
 * Provider-agnostic on purpose: the channel pipeline calls this once per
 * inbound message regardless of channel, so every current and future
 * provider gets detection for free.
 */

interface ScriptRange {
  code: string;
  regex: RegExp;
}

const SCRIPTS: ScriptRange[] = [
  { code: 'ar', regex: /[؀-ۿݐ-ݿࢠ-ࣿ]/g },
  { code: 'he', regex: /[֐-׿]/g },
  { code: 'ru', regex: /[Ѐ-ӿ]/g },
  { code: 'el', regex: /[Ͱ-Ͽ]/g },
  { code: 'hi', regex: /[ऀ-ॿ]/g },
  { code: 'th', regex: /[฀-๿]/g },
  { code: 'ko', regex: /[가-힯ᄀ-ᇿ]/g },
  { code: 'ja', regex: /[぀-ヿ]/g },
  { code: 'zh', regex: /[一-鿿]/g },
];

const LATIN_REGEX = /[a-z]/gi;

/** Common short words with high discriminative power per language. */
const LATIN_STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'is', 'are', 'you', 'what', 'how', 'much', 'can', 'do', 'have', 'want', 'need', 'price', 'hello', 'hi', 'thanks', 'please', 'my', 'your', 'this', 'it'],
  es: ['el', 'la', 'los', 'las', 'es', 'que', 'como', 'cuanto', 'cuánto', 'hola', 'gracias', 'por', 'para', 'quiero', 'necesito', 'precio', 'usted', 'tienes', 'una', 'con'],
  fr: ['le', 'la', 'les', 'est', 'que', 'comment', 'combien', 'bonjour', 'merci', 'pour', 'je', 'vous', 'avec', 'prix', 'voudrais', 'une', 'des', 'être'],
  de: ['der', 'die', 'das', 'ist', 'und', 'wie', 'viel', 'hallo', 'danke', 'bitte', 'ich', 'sie', 'mit', 'preis', 'möchte', 'eine', 'für', 'nicht'],
  tr: ['bir', 've', 'bu', 'ne', 'kadar', 'merhaba', 'teşekkür', 'fiyat', 'istiyorum', 'için', 'var', 'mı', 'nasıl', 'ben', 'siz'],
  it: ['il', 'la', 'che', 'come', 'quanto', 'ciao', 'grazie', 'per', 'io', 'voglio', 'prezzo', 'una', 'con', 'sono', 'del'],
  pt: ['o', 'a', 'os', 'as', 'que', 'como', 'quanto', 'olá', 'obrigado', 'para', 'eu', 'quero', 'preço', 'uma', 'com', 'você'],
};

/** Human-readable names used inside AI prompts. */
const LANGUAGE_NAMES: Record<string, string> = {
  ar: 'Arabic',
  he: 'Hebrew',
  ru: 'Russian',
  el: 'Greek',
  hi: 'Hindi',
  th: 'Thai',
  ko: 'Korean',
  ja: 'Japanese',
  zh: 'Chinese',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  tr: 'Turkish',
  it: 'Italian',
  pt: 'Portuguese',
};

/** Detect the dominant language of a message. */
export function detectLanguage(text: string): string {
  // Ignore content that carries no language signal.
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, ' ')
    .replace(/\d+/g, ' ');
  if (!cleaned.trim()) return 'unknown';

  // 1. Script counts. The dominant non-Latin script wins outright when it
  //    covers a meaningful share of the letters (mixed messages like
  //    "بدي CRM Pro" stay Arabic).
  const counts = new Map<string, number>();
  for (const { code, regex } of SCRIPTS) {
    const matches = cleaned.match(regex);
    if (matches) counts.set(code, matches.length);
  }
  const latinCount = cleaned.match(LATIN_REGEX)?.length ?? 0;

  let bestScript: string | null = null;
  let bestScriptCount = 0;
  for (const [code, count] of counts) {
    if (count > bestScriptCount) {
      bestScript = code;
      bestScriptCount = count;
    }
  }

  const totalLetters = bestScriptCount + latinCount;
  if (bestScript && totalLetters > 0 && bestScriptCount / totalLetters >= 0.3) {
    // Japanese kana implies Japanese even when Han characters dominate.
    if (bestScript === 'zh' && counts.has('ja')) return 'ja';
    return bestScript;
  }

  // 2. Latin languages: stop-word evidence over whole words.
  if (latinCount === 0) return 'unknown';
  const words = cleaned.toLowerCase().split(/[^a-zà-ÿçğıöşü]+/i).filter(Boolean);
  if (words.length === 0) return 'unknown';
  const wordSet = new Set(words);

  let bestLatin = 'unknown';
  let bestHits = 0;
  for (const [code, stopwords] of Object.entries(LATIN_STOPWORDS)) {
    let hits = 0;
    for (const w of stopwords) if (wordSet.has(w)) hits += 1;
    if (hits > bestHits) {
      bestHits = hits;
      bestLatin = code;
    }
  }
  return bestHits > 0 ? bestLatin : 'unknown';
}

/** Prompt-friendly language name; null for 'unknown'/unmapped codes. */
export function languageName(code: string | null | undefined): string | null {
  if (!code) return null;
  return LANGUAGE_NAMES[code] ?? null;
}
