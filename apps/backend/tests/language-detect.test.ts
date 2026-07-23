import { detectLanguage, languageName } from '../src/utils/language-detect';

describe('detectLanguage', () => {
  it('detects Arabic', () => {
    expect(detectLanguage('مرحبا، بدي أعرف سعر الخدمة')).toBe('ar');
  });

  it('keeps Arabic for mixed Arabic + Latin brand names', () => {
    expect(detectLanguage('بدي اشتري CRM Pro License شو سعره؟')).toBe('ar');
  });

  it('detects English', () => {
    expect(detectLanguage('Hello, how much is the premium plan?')).toBe('en');
  });

  it('detects Spanish', () => {
    expect(detectLanguage('Hola, ¿cuánto cuesta el plan premium? Gracias')).toBe('es');
  });

  it('detects French', () => {
    expect(detectLanguage('Bonjour, je voudrais connaître le prix')).toBe('fr');
  });

  it('detects German', () => {
    expect(detectLanguage('Hallo, wie viel kostet das? Danke')).toBe('de');
  });

  it('detects Russian', () => {
    expect(detectLanguage('Здравствуйте, сколько это стоит?')).toBe('ru');
  });

  it('detects Chinese', () => {
    expect(detectLanguage('你好，这个多少钱？')).toBe('zh');
  });

  it('detects Japanese via kana even with Han characters', () => {
    expect(detectLanguage('こんにちは、値段はいくらですか')).toBe('ja');
  });

  it('detects Korean', () => {
    expect(detectLanguage('안녕하세요 가격이 얼마인가요')).toBe('ko');
  });

  it('returns unknown for pure numbers/URLs', () => {
    expect(detectLanguage('12345 https://example.com')).toBe('unknown');
  });

  it('returns unknown for bare brand tokens with no language evidence', () => {
    expect(detectLanguage('CRM XZQ-9')).toBe('unknown');
  });
});

describe('languageName', () => {
  it('maps codes to prompt-friendly names', () => {
    expect(languageName('ar')).toBe('Arabic');
    expect(languageName('en')).toBe('English');
  });

  it('returns null for unknown codes', () => {
    expect(languageName('unknown')).toBeNull();
    expect(languageName(null)).toBeNull();
  });
});
