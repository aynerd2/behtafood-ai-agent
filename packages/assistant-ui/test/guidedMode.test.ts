// Guided mode, part 2: the Chat/Guided switch, Stop, pause-on-touch, and
// when the panel is a small bar or an expanded sheet.

import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { GuideSession, guidedLayout, initialGuideMode, type GuideMode } from '../src/logic/guidedMode';
import type { GuideAction } from '../src/logic/guide';
import { applyRunEvents, initialState, startTurn, turnAccepted } from '../src/logic/conversation';
import { approveResolved, approveStarted } from '../src/logic/approval';
import { applySnapshot, newTracking } from '../src/logic/tracking';
import { NOW, PLACED, ev, happyRun, resetSeq } from './fixtures';

beforeEach(resetSeq);

const act = (n: number): GuideAction => ({ kind: 'show_restaurants', key: `a${n}`, restaurantIds: [`r${n}`], label: `step ${n}` });

function session(mode: GuideMode = 'guided') {
  const applied: string[] = [];
  let clears = 0;
  const s = new GuideSession({ mode, apply: (a) => applied.push(a.key), clear: () => (clears += 1) });
  s.setOpen(true);
  return { s, applied, clears: () => clears };
}

describe('remembered mode', () => {
  test('Guided on the first run, then whatever the customer chose last', () => {
    assert.equal(initialGuideMode(null), 'guided');
    assert.equal(initialGuideMode('nonsense'), 'guided');
    assert.equal(initialGuideMode('chat'), 'chat');
    assert.equal(initialGuideMode('guided'), 'guided');
  });
});

describe('Guided mode', () => {
  test('applies each step as it arrives, in order', () => {
    const { s, applied } = session();
    s.receive(act(1));
    s.receive(act(2));
    assert.deepEqual(applied, ['a1', 'a2']);
    assert.equal(s.status, 'navigating');
    assert.equal(s.current?.label, 'step 2');
  });

  test('Chat mode never navigates', () => {
    const { s, applied } = session('chat');
    s.receive(act(1));
    assert.deepEqual(applied, []);
    assert.equal(s.status, 'chat');
  });

  test('nothing navigates while the panel is closed', () => {
    const { s, applied } = session();
    s.setOpen(false);
    s.receive(act(1));
    assert.deepEqual(applied, []);
  });
});

describe('switching mid-run', () => {
  test('Guided -> Chat stops all navigation at once and clears highlights', () => {
    const { s, applied, clears } = session();
    s.receive(act(1));
    s.setMode('chat');
    assert.equal(clears(), 1);
    s.receive(act(2));
    s.receive(act(3));
    assert.deepEqual(applied, ['a1']);
  });

  test('Chat -> Guided continues from the latest step only, without replaying old ones', () => {
    const { s, applied } = session('chat');
    s.receive(act(1));
    s.receive(act(2));
    s.receive(act(3));
    s.setMode('guided');
    assert.deepEqual(applied, ['a3']);
    s.receive(act(4));
    assert.deepEqual(applied, ['a3', 'a4']);
  });

  test('switching back and forth never applies a step twice', () => {
    const { s, applied } = session();
    s.receive(act(1));
    s.setMode('chat');
    s.setMode('guided');
    assert.deepEqual(applied, ['a1']);
  });
});

describe('Stop', () => {
  test('stops navigation for the rest of the run and clears highlights; the next message starts again', () => {
    const { s, applied, clears } = session();
    s.receive(act(1));
    s.stop();
    assert.equal(s.status, 'stopped');
    assert.equal(clears(), 1);
    s.receive(act(2));
    assert.deepEqual(applied, ['a1']);
    s.newRun();
    s.receive(act(3));
    assert.deepEqual(applied, ['a1', 'a3']);
  });
});

describe('pause on touch', () => {
  test('a touch on the app pauses guided navigation; steps keep arriving but are not applied', () => {
    const { s, applied } = session();
    s.receive(act(1));
    s.touch();
    assert.equal(s.status, 'paused');
    s.receive(act(2));
    s.receive(act(3));
    assert.deepEqual(applied, ['a1']);
    assert.equal(s.current?.label, 'step 3', 'the bar still shows the real current step');
  });

  test('Resume continues from the latest step only', () => {
    const { s, applied } = session();
    s.receive(act(1));
    s.touch();
    s.receive(act(2));
    s.receive(act(3));
    s.resume();
    assert.deepEqual(applied, ['a1', 'a3']);
    assert.equal(s.status, 'navigating');
  });

  test('a touch does nothing in Chat mode, with the panel closed, or after Stop', () => {
    const chat = session('chat');
    chat.s.touch();
    assert.equal(chat.s.status, 'chat');
    const closed = session();
    closed.s.setOpen(false);
    closed.s.touch();
    assert.equal(closed.s.paused, false);
    const stopped = session();
    stopped.s.stop();
    stopped.s.touch();
    assert.equal(stopped.s.status, 'stopped');
  });

  test('a new message resumes guided navigation', () => {
    const { s, applied } = session();
    s.touch();
    s.newRun();
    s.receive(act(1));
    assert.deepEqual(applied, ['a1']);
  });

  test('listeners hear every change', () => {
    const { s } = session();
    let n = 0;
    s.subscribe(() => (n += 1));
    s.receive(act(1));
    s.touch();
    s.resume();
    s.setMode('chat');
    assert.equal(n, 4);
  });
});

describe('pacing: one step on screen at a time', () => {
  /** A fake timer: run(ms) fires everything due. */
  function timers() {
    let now = 0;
    let jobs: { at: number; fn: () => void; id: number }[] = [];
    let id = 0;
    return {
      schedule: (fn: () => void, ms: number) => {
        const job = { at: now + ms, fn, id: ++id };
        jobs.push(job);
        return () => (jobs = jobs.filter((j) => j.id !== job.id));
      },
      run(ms: number) {
        now += ms;
        for (;;) {
          const due = jobs.filter((j) => j.at <= now).sort((a, b) => a.at - b.at)[0];
          if (!due) break;
          jobs = jobs.filter((j) => j !== due);
          due.fn();
        }
      },
    };
  }

  function paced() {
    const t = timers();
    const applied: string[] = [];
    let clears = 0;
    const s = new GuideSession({ mode: 'guided', apply: (a) => applied.push(a.key), clear: () => (clears += 1), minDwellMs: 1000, schedule: t.schedule });
    s.setOpen(true);
    return { s, t, applied, clears: () => clears };
  }

  test('steps that arrive together (three menus read at once) are each shown in turn, for the dwell time', () => {
    const { s, t, applied } = paced();
    s.receive(act(1));
    s.receive(act(2));
    s.receive(act(3));
    assert.deepEqual(applied, ['a1']);
    t.run(1000);
    assert.deepEqual(applied, ['a1', 'a2']);
    t.run(1000);
    assert.deepEqual(applied, ['a1', 'a2', 'a3']);
  });

  test('switching to Chat drops every queued step at once', () => {
    const { s, t, applied } = paced();
    s.receive(act(1));
    s.receive(act(2));
    s.receive(act(3));
    s.setMode('chat');
    t.run(5000);
    assert.deepEqual(applied, ['a1']);
  });

  test('Stop and pause drop the queue; Resume shows only the latest step', () => {
    const stop = paced();
    stop.s.receive(act(1));
    stop.s.receive(act(2));
    stop.s.stop();
    stop.t.run(5000);
    assert.deepEqual(stop.applied, ['a1']);

    const pause = paced();
    pause.s.receive(act(1));
    pause.s.receive(act(2));
    pause.s.receive(act(3));
    pause.s.touch();
    pause.t.run(5000);
    assert.deepEqual(pause.applied, ['a1']);
    pause.s.resume();
    assert.deepEqual(pause.applied, ['a1', 'a3']);
  });

  test('a step arriving after the dwell time is shown at once', () => {
    const { s, t, applied } = paced();
    s.receive(act(1));
    t.run(1500);
    s.receive(act(2));
    assert.deepEqual(applied, ['a1', 'a2']);
  });
});

describe('bar or sheet', () => {
  test('a small bar while the assistant works; a sheet when it needs the customer', () => {
    let s = startTurn(initialState(), 't1', 'rice');
    assert.equal(guidedLayout({ ...s, busy: true, tracking: {} }, NOW), 'bar');
    s = turnAccepted(s, 't1', { runId: 'r', sessionId: null });
    const run = happyRun();
    s = applyRunEvents(s, 't1', run.slice(0, 4), false);
    assert.equal(guidedLayout({ ...s, busy: true, tracking: {} }, NOW), 'bar');
    s = applyRunEvents(s, 't1', run.slice(4, 7), false);
    assert.equal(guidedLayout({ ...s, busy: true, tracking: {} }, NOW), 'sheet', 'the approval card expands the panel at once, mid-run');
    s = applyRunEvents(s, 't1', run.slice(7), true);
    assert.equal(guidedLayout({ ...s, busy: false, tracking: {} }, NOW), 'sheet', 'approval card waiting');
  });

  test('a question or choice expands to the sheet; nothing asked yet also shows the sheet', () => {
    assert.equal(guidedLayout({ ...initialState(), busy: false, tracking: {} }, NOW), 'sheet');
    let s = turnAccepted(startTurn(initialState(), 't1', 'jollof'), 't1', { runId: 'r', sessionId: null });
    s = applyRunEvents(s, 't1', [ev({ type: 'reply', text: 'Which protein?' }), ev({ type: 'done', modelCalls: 1, costUsd: 0 })], true);
    assert.equal(guidedLayout({ ...s, busy: false, tracking: {} }, NOW), 'sheet');
  });

  test('after the order is placed, the bar shows while the tracking screen is visible', () => {
    let s = turnAccepted(startTurn(initialState(), 't1', 'order'), 't1', { runId: 'r', sessionId: null });
    s = applyRunEvents(s, 't1', happyRun(), true);
    s = { ...s, cards: { prop_1: approveResolved(approveStarted(s.cards.prop_1!), PLACED) } };
    assert.equal(guidedLayout({ ...s, busy: false, tracking: {} }, NOW), 'bar');
  });

  test('a delay with reminder buttons expands the sheet over the tracking screen', () => {
    let s = turnAccepted(startTurn(initialState(), 't1', 'order'), 't1', { runId: 'r', sessionId: null });
    s = applyRunEvents(s, 't1', happyRun(), true);
    s = { ...s, cards: { prop_1: approveResolved(approveStarted(s.cards.prop_1!), PLACED) } };
    let t = applySnapshot(newTracking('ord_9', 'ORD-ABC-123'), { orderId: 'ord_9', reference: 'ORD-ABC-123', status: 'ready', riderAssigned: false, updatedAt: '', stageSince: '', delay: null, modelCalls: 0 }, NOW);
    assert.equal(guidedLayout({ ...s, busy: false, tracking: { ord_9: t } }, NOW), 'bar');
    t = applySnapshot(t, { orderId: 'ord_9', reference: 'ORD-ABC-123', status: 'ready', riderAssigned: false, updatedAt: '', stageSince: '', delay: { kind: 'no_rider', parties: ['vendor'], elapsedMs: 1, message: 'm' }, modelCalls: 0 }, NOW);
    assert.equal(guidedLayout({ ...s, busy: false, tracking: { ord_9: t } }, NOW), 'sheet');
  });
});
