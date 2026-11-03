import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PREVIEW_SIZE, REMOVE_BUTTON_SIZE, clampZoom, fitPhotoSize, sentPhotoSize,
} from '../src/logic/photoLayout';
import { formatReply, paragraphsOf, spansOf } from '../src/logic/replyFormat';

const PHONE = { width: 390, height: 844 };

describe('sent photo size', () => {
  test('about 75% of the screen width, keeping a landscape shape', () => {
    assert.deepEqual(sentPhotoSize(PHONE, { width: 1600, height: 1200 }), { width: 293, height: 220 });
  });

  test('a tall photo is capped in height and keeps its shape', () => {
    const s = sentPhotoSize(PHONE, { width: 900, height: 1600 });
    assert.equal(s.height, 420);
    assert.equal(s.width, Math.round(420 * (900 / 1600)));
  });

  test('on a short screen the cap is half the screen height', () => {
    const s = sentPhotoSize({ width: 390, height: 600 }, { width: 900, height: 1600 });
    assert.equal(s.height, 300);
  });

  test('unknown or broken sizes show a square, never zero', () => {
    for (const p of [null, undefined, {}, { width: 0, height: 0 }, { width: 100 }, { width: Number.NaN, height: 5 }]) {
      const s = sentPhotoSize(PHONE, p as any);
      assert.ok(s.width > 0 && s.width === s.height, JSON.stringify(p));
    }
  });

  test('never wider than 75% of the screen', () => {
    for (const w of [320, 390, 768, 1024]) {
      assert.ok(sentPhotoSize({ width: w, height: 2000 }, { width: 4000, height: 100 }).width <= Math.round(w * 0.75));
    }
  });
});

describe('preview and full screen', () => {
  test('the preview is 96 pt with a clear remove button', () => {
    assert.equal(PREVIEW_SIZE, 96);
    assert.ok(REMOVE_BUTTON_SIZE >= 28);
  });

  test('full screen fits inside the screen in either direction', () => {
    assert.deepEqual(fitPhotoSize(PHONE, { width: 2000, height: 1000 }), { width: 390, height: 195 });
    assert.deepEqual(fitPhotoSize(PHONE, { width: 1000, height: 4000 }), { width: 211, height: 844 });
  });

  test('pinch zoom stays between 1x and 4x', () => {
    assert.equal(clampZoom(0.2), 1);
    assert.equal(clampZoom(2.5), 2.5);
    assert.equal(clampZoom(9), 4);
    assert.equal(clampZoom(Number.NaN), 1);
  });
});

describe('reply layout', () => {
  test('each line is its own paragraph; blank lines go', () => {
    assert.deepEqual(paragraphsOf('Here you go:\n\nJollof: ₦2,500\nOfada: ₦3,000\n'), ['Here you go:', 'Jollof: ₦2,500', 'Ofada: ₦3,000']);
  });

  test('only dish names and prices are bold; prices use tabular figures', () => {
    const spans = spansOf('Jollof Rice & Chicken at Iya Ewa Kitchen: ₦2,500 with delivery', ['Jollof Rice & Chicken']);
    assert.deepEqual(spans, [
      { text: 'Jollof Rice & Chicken', bold: true, price: false },
      { text: ' at Iya Ewa Kitchen: ', bold: false, price: false },
      { text: '₦2,500', bold: true, price: true },
      { text: ' with delivery', bold: false, price: false },
    ]);
  });

  test('dish names match any case, whole words only, longest first', () => {
    const spans = spansOf('fried rice & turkey or rice', ['Rice', 'Fried Rice & Turkey']);
    assert.deepEqual(spans.filter((s) => s.bold).map((s) => s.text), ['fried rice & turkey', 'rice']);
    assert.deepEqual(spansOf('ricecake', ['Rice']).filter((s) => s.bold), []);
  });

  test('restaurant names and other words stay regular', () => {
    const p = formatReply('Iya Ewa Kitchen is open.', ['Jollof Rice & Chicken']);
    assert.deepEqual(p, [[{ text: 'Iya Ewa Kitchen is open.', bold: false, price: false }]]);
  });
});
