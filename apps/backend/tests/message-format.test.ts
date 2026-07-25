import { formatOutgoingText } from '../src/utils/message-format';

/**
 * Outgoing text normalizer. Messaging channels render our text literally, so a
 * stray markdown token is visible to the customer. These cases lock in the two
 * hard requirements: markdown never survives, and nothing else is mangled.
 */
describe('formatOutgoingText', () => {
  it('unwraps bold and italic markers', () => {
    expect(formatOutgoingText('**CRM Pro License**')).toBe('CRM Pro License');
    expect(formatOutgoingText('*CRM Pro License*')).toBe('CRM Pro License');
    expect(formatOutgoingText('__bold__')).toBe('bold');
    expect(formatOutgoingText('_italic_')).toBe('italic');
  });

  it('unwraps emphasis mid-line without touching the surrounding text', () => {
    expect(
      formatOutgoingText('2. *CRM Pro License [Software]*: 120 JOD — annual'),
    ).toBe('2. CRM Pro License [Software]: 120 JOD — annual');
    expect(formatOutgoingText('Price: **120 JOD** today only')).toBe(
      'Price: 120 JOD today only',
    );
  });

  it('strips markdown headings', () => {
    expect(formatOutgoingText('### Our products\nPOS Terminal X1')).toBe(
      'Our products\nPOS Terminal X1',
    );
    expect(formatOutgoingText('# Title')).toBe('Title');
  });

  it('converts markdown bullets to "• "', () => {
    expect(formatOutgoingText('- item one\n- item two')).toBe(
      '• item one\n• item two',
    );
    expect(formatOutgoingText('* item one\n+ item two')).toBe(
      '• item one\n• item two',
    );
  });

  it('keeps code content but drops backticks and fences', () => {
    expect(formatOutgoingText('Use `ORDER-12` as the reference')).toBe(
      'Use ORDER-12 as the reference',
    );
    expect(formatOutgoingText('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('collapses 3+ blank lines and trims trailing spaces', () => {
    expect(formatOutgoingText('a   \n\n\n\n\nb  ')).toBe('a\n\nb');
  });

  it('leaves URLs, emoji, Arabic and arithmetic intact', () => {
    const url = 'See https://example.com/a_b_c?x=1 for details 🎉';
    expect(formatOutgoingText(url)).toBe(url);
    const arabic = 'مرحباً! سعر ترخيص CRM Pro هو 120 دينار أردني 😊';
    expect(formatOutgoingText(arabic)).toBe(arabic);
    expect(formatOutgoingText('2*3 = 6 and snake_case_name stays')).toBe(
      '2*3 = 6 and snake_case_name stays',
    );
  });

  it('does not eat the "###" suggestion delimiter', () => {
    expect(formatOutgoingText('First reply\n###\nSecond reply')).toBe(
      'First reply\n###\nSecond reply',
    );
  });

  it('is idempotent on a second pass', () => {
    const messy = [
      '### Products',
      '',
      '- *POS Terminal X1*: **250 JOD** — fast checkout   ',
      '- `CRM Pro License`: 120 JOD',
      '',
      '',
      '',
      'Anything else? 2*3 https://x.dev/a_b مرحبا',
    ].join('\n');
    const once = formatOutgoingText(messy);
    expect(once).toBe(formatOutgoingText(once));
    expect(once).not.toContain('**');
    expect(once).not.toContain('`');
    expect(once).not.toContain('#');
    expect(once).toContain('• POS Terminal X1: 250 JOD — fast checkout');
    expect(once).toContain('• CRM Pro License: 120 JOD');
    // Untouched: arithmetic, URL underscores, Arabic.
    expect(once).toContain('2*3 https://x.dev/a_b مرحبا');
  });
});
