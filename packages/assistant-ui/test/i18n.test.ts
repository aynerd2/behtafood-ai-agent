import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SERVER_MESSAGES } from '../../agent-core/src/messages';
import { TRANSLATIONS, TRANSLATION_KEYS, UI_LANGUAGES, UNVERIFIED_LANGUAGES, t, uiLanguageOf } from '../src/i18n/translations';
import { localize, stepLabel } from '../src/i18n/localize';
import { STAGE_LABEL } from '../src/logic/tracking';

const varsOf = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  test('every key exists in every language', () => {
    for (const lang of UI_LANGUAGES) {
      const missing = TRANSLATION_KEYS.filter((k) => !TRANSLATIONS[lang][k]);
      assert.deepEqual(missing, [], `${lang} is missing keys`);
    }
  });

  test('no language has keys English does not', () => {
    for (const lang of UI_LANGUAGES) {
      const extra = Object.keys(TRANSLATIONS[lang]).filter((k) => !(TRANSLATION_KEYS as string[]).includes(k));
      assert.deepEqual(extra, [], lang);
    }
  });

  test('every translation keeps exactly the variables of the English string', () => {
    for (const lang of UI_LANGUAGES) {
      for (const k of TRANSLATION_KEYS) {
        assert.deepEqual(varsOf(TRANSLATIONS[lang][k]!), varsOf(TRANSLATIONS.en[k]!), `${lang} ${k}`);
      }
    }
  });

  test('variables are filled in; unknown ones stay visible', () => {
    assert.equal(t('yo', 'step.searched', { count: 3 }), 'Wá ilé oúnjẹ: 3 ló ṣí');
    assert.equal(t('en', 'card.approveAmount', { amount: '₦2,500' }), 'Approve ₦2,500');
    assert.equal(t('en', 'card.approveAmount'), 'Approve {amount}');
  });

  test('Auto and unknown codes use English for the interface', () => {
    assert.equal(uiLanguageOf('auto'), 'en');
    assert.equal(uiLanguageOf('fr'), 'en');
    assert.equal(uiLanguageOf(undefined), 'en');
    assert.equal(t('auto', 'buttons.approve'), 'Approve');
  });

  test('Yoruba, Hausa and Igbo are marked unverified', () => {
    assert.deepEqual([...UNVERIFIED_LANGUAGES].sort(), ['ha', 'ig', 'yo']);
  });

  test('no em or en dash in any string', () => {
    for (const lang of UI_LANGUAGES) for (const k of TRANSLATION_KEYS) assert.doesNotMatch(TRANSLATIONS[lang][k]!, /[—–]/, `${lang} ${k}`);
  });

  test('button names match what the server tells the model', () => {
    for (const lang of UI_LANGUAGES) {
      const b = SERVER_MESSAGES[lang].buttons;
      assert.equal(TRANSLATIONS[lang]['buttons.approve'], b.approve, lang);
      assert.equal(TRANSLATIONS[lang]['buttons.cancel'], b.cancel, lang);
      assert.equal(TRANSLATIONS[lang]['buttons.askAgain'], b.askAgain, lang);
      assert.equal(TRANSLATIONS[lang]['buttons.viewOrder'], b.viewOrder, lang);
      assert.equal(TRANSLATIONS[lang]['buttons.send'], b.send, lang);
    }
  });

  test('server messages exist in every language with the same variables', () => {
    for (const lang of UI_LANGUAGES) {
      for (const [k, v] of Object.entries(SERVER_MESSAGES.en)) {
        if (typeof v !== 'string') continue;
        const tr = (SERVER_MESSAGES[lang] as any)[k] as string;
        assert.ok(tr, `${lang} ${k}`);
        assert.deepEqual(varsOf(tr), varsOf(v), `${lang} ${k}`);
        assert.doesNotMatch(tr, /[—–]/, `${lang} ${k}`);
      }
    }
  });
});

describe('localize: app text in the chosen language', () => {
  test('English text the logic makes is shown from its key', () => {
    assert.equal(localize('Waiting for your approval', 'ha'), 'Ana jiran amincewarka');
    assert.equal(localize('Order placed: BF-12', 'pcm'), 'Order don enter: BF-12');
    assert.equal(localize('Cancelled. Nothing was ordered.', 'ig'), 'Akagbuola ya. Ọ dịghị ihe a tụrụ.');
  });

  test('nested values are translated too', () => {
    assert.equal(
      localize('The restaurant has been preparing your order for 5 minutes. Would you like to send a polite reminder?', 'yo'),
      'Ilé oúnjẹ ti ń se oúnjẹ rẹ fún ìṣẹ́jú 5. Ṣé kí n rán wọn létí?',
    );
    assert.equal(localize(`Order BF-9: ${STAGE_LABEL.on_the_way}`, 'ha'), 'Oda BF-9: Odarka tana kan hanya');
  });

  test('every tracking stage label has a translation', () => {
    for (const label of Object.values(STAGE_LABEL)) {
      assert.notEqual(localize(label, 'yo'), label, label);
    }
  });

  test('unknown text (names, server text) is shown as it is', () => {
    assert.equal(localize('Iya Ewa Kitchen', 'yo'), 'Iya Ewa Kitchen');
    assert.equal(localize('Na only food I fit help with.', 'pcm'), 'Na only food I fit help with.');
  });

  test('English stays English', () => {
    assert.equal(localize('Quote expired', 'en'), 'Quote expired');
    assert.equal(localize('Quote expired', 'auto'), 'Quote expired');
  });

  test('server steps use their key, with the order status translated', () => {
    assert.equal(stepLabel({ label: 'Searched restaurants: 2 open', labelKey: 'step.searched', labelParams: { count: 2 } }, 'pcm'), 'Check restaurants: 2 dey open');
    assert.equal(
      stepLabel({ label: 'x', labelKey: 'step.orderStatus', labelParams: { reference: 'BF-1', status: 'preparing' } }, 'en'),
      'Checked order BF-1: The restaurant is preparing your order',
    );
    // Older servers send only the English label.
    assert.equal(stepLabel({ label: 'Read menu: Iya Ewa Kitchen' }, 'yo'), 'Ka àtòjọ oúnjẹ: Iya Ewa Kitchen');
  });
});

describe('no hard-coded English on any assistant screen', () => {
  const dir = join(import.meta.dirname, '..', 'src', 'ui');
  const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'));

  test('JSX text, labels, placeholders and hints come from the translations', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(join(dir, f), 'utf8').split('\n');
      lines.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '').replace(/\{\/\*.*?\*\/\}/g, '');
        // Literal text between JSX tags.
        if (/(?<![=])>\s*[A-Za-z][A-Za-z ,.'’!?…:]{2,}\s*</.test(code)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
        // Literal strings in user-facing props.
        if (/\b(placeholder|accessibilityLabel|accessibilityHint|title|label)=["'][A-Za-z]/.test(code)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
        // Literal English sentences in braces, e.g. {'Working…'} or label={`Approve ${x}`}.
        if (/(=|\{)\s*['`][A-Z][a-z]+ [a-z]+[^'`]*['`]/.test(code) && !/fontFamily|import|require|Ionicons|name=/.test(code)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    assert.deepEqual(offenders, []);
  });
});
