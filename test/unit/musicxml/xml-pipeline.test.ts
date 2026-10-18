import assert from 'node:assert/strict';
import { test } from 'node:test';
import xmlbuilder from 'xmlbuilder2/lib/xmlbuilder2.min.js';
import type { NameState, NoteLike, PlannedNote } from '../../../src/musicxml/planning/events.js';
import type { Part } from '../../../src/musicxml/planning/parts.js';
import { normalizeScore } from '../../../src/musicxml/planning/normalize.js';
import { planScore } from '../../../src/musicxml/planning/score.js';
import type { ScoreDocument } from '../../../src/model/document.js';
import { createLayoutSession } from '../../../src/musicxml/writing/layout-session.js';
import { preparePart, selectPartNames } from '../../../src/musicxml/writing/part/session.js';
import { planPartNotes } from '../../../src/musicxml/planning/notes.js';
import { createTiePlaybackSession } from '../../../src/musicxml/writing/tie-session.js';
import { createNativeAnchors } from '../../../src/musicxml/writing/native-anchors.js';
import { elements } from '../../support/xml-support.js';
import { createHarmonyNotes } from '../../../src/musicxml/planning/harmony-notes.js';
import { writeNotePlayback } from '../../../src/musicxml/writing/note/playback.js';
import { toMusicXML } from '../../../src/musicxml/convert.js';

const part: Part = { id: 'P1', contextId: 1, staves: [1], percussion: [] };
const moment = (numerator: number, denominator = 1) => ({
  main: { numerator, denominator },
  grace: { numerator: 0, denominator: 1 },
});

test('normalization orders exact main times before grace offsets when decimal times coincide', () => {
  const n = Number.MAX_SAFE_INTEGER;
  const earlier: ScoreDocument['events'][number] = {
    kind: 'layout',
    class: 'line-break-event',
    permission: 'allow',
    moment: moment(n - 2, n - 1),
  };
  const later: typeof earlier = {
    ...earlier,
    moment: {
      main: { numerator: n - 1, denominator: n },
      grace: { numerator: -1, denominator: 16 },
    },
  };
  const document: ScoreDocument = {
    version: 1,
    source: 'exact-time.ly',
    lilypondVersion: '2.26.0',
    header: {},
    contexts: [],
    events: [later, earlier],
  };
  const { events } = normalizeScore(document, () => {});

  assert.deepEqual(events, [earlier, later]);
  assert.deepEqual(document.events, [later, earlier]);
});

test('normalization orders grace notes at equivalent fractional main times', () => {
  const main: ScoreDocument['events'][number] = {
    kind: 'layout',
    class: 'line-break-event',
    permission: 'allow',
    moment: moment(1, 2),
  };
  const grace: typeof main = {
    ...main,
    moment: {
      main: { numerator: 2, denominator: 4 },
      grace: { numerator: -1, denominator: 16 },
    },
  };
  const document: ScoreDocument = {
    version: 1,
    source: 'grace-time.ly',
    lilypondVersion: '2.26.0',
    header: {},
    contexts: [],
    events: [main, grace],
  };

  assert.deepEqual(normalizeScore(document, () => {}).events, [grace, main]);
});

test('cached invalid durations fail at the conversion boundary with an explicit error', () => {
  const skip: ScoreDocument['events'][number] = {
    kind: 'skip',
    staff: 1,
    voice: 2,
    moment: moment(0),
    duration: { log: 2, dots: 0, scale: { numerator: 1, denominator: 1 } },
  };
  const document: ScoreDocument = {
    version: 1,
    source: 'invalid-duration.ly',
    lilypondVersion: '2.26.0',
    header: {},
    contexts: [],
    events: [skip],
  };

  for (const duration of [
    undefined,
    { log: 2, dots: 0, scale: { numerator: 1, denominator: 0 } },
    { log: -1024, dots: 0, scale: { numerator: 1, denominator: 1 } },
  ]) {
    const malformed = structuredClone(document);

    Reflect.set(malformed.events[0]!, 'duration', duration);
    assert.throws(() => toMusicXML(malformed), {
      name: 'TypeError',
      message: 'Invalid skip duration: expected a positive finite musical duration',
    });
  }
});

test('part planning splits notes without mutating their source identity or attachments', () => {
  const note: NoteLike = {
    kind: 'note',
    noteId: 7,
    staff: 1,
    voice: 2,
    moment: moment(0),
    duration: { log: 0, dots: 0, scale: { numerator: 1, denominator: 1 } },
    attachments: [{ class: 'tie-event' }],
  };
  const before = structuredClone(note);
  const planned = planPartNotes([note], [], {
    part,
    boundaries: [0, 0.5, 1],
    ticks: 4,
    tick: (value) => Math.round(4 * value),
  });

  assert.deepEqual(note, before);
  assert.deepEqual(
    planned.map((segment) => ({
      id: segment.noteId,
      length: segment.segmentDuration,
      continuation: segment.continuation,
      continues: segment.continues,
      tieAtEnd: segment.tieAtEnd,
    })),
    [
      {
        id: 7,
        length: 0.5,
        continuation: false,
        continues: true,
        tieAtEnd: true,
      },
      {
        id: 7,
        length: 0.5,
        continuation: true,
        continues: false,
        tieAtEnd: true,
      },
    ],
  );
  assert.equal(planned[0]!.attachments, note.attachments);
});

test('native node replacement updates label, system, and page references atomically', () => {
  const root = xmlbuilder.create().ele('score-partwise');
  const measure = root.ele('part', { id: part.id }).ele('measure');
  const old = measure.ele('forward');
  const replacement = measure.ele('note');
  const anchors = createNativeAnchors(
    [
      {
        id: 'label-1',
        name: 'here',
        sourceId: 1,
        context: 1,
        moment: moment(0),
        label: 'here',
      },
    ],
    1,
  );

  anchors.registerLabelSibling(old, moment(0));
  anchors.registerSystem(1, part, old, undefined);
  anchors.registerPage(2, part, old, undefined);
  old.remove();
  anchors.replaceNode(old, replacement);
  assert.equal(anchors.cursorFor(1, part)?.node, replacement);
  assert.equal(anchors.cursorFor(2, part)?.node, replacement);
  const diagnostics: string[] = [];

  anchors.finishLabels((code) => diagnostics.push(code));
  assert.deepEqual(diagnostics.sort(), ['label-page']);
  assert.equal(elements(measure.node, 'bookmark')[0]?.getAttribute('id'), 'label-1');
  assert.equal(replacement.node.previousSibling?.nodeName, 'bookmark');
});

test('tie playback consumes links once and removes an incoming cue sound link', () => {
  const measure = xmlbuilder.create().ele('measure');
  const ties = createTiePlaybackSession([]);

  ties.start('pitch', 1, 1, measure.ele('tie', { type: 'start' }));
  assert.deepEqual(ties.stop({ key: 'pitch', at: 1, cue: false, expireAcrossGap: true }), {
    stopTie: true,
    stopSoundTie: true,
  });
  assert.deepEqual(ties.stop({ key: 'pitch', at: 1, cue: false, expireAcrossGap: true }), {
    stopTie: false,
    stopSoundTie: false,
  });
  ties.start('cue', 1, 2, measure.ele('tie', { type: 'start' }));
  assert.deepEqual(ties.stop({ key: 'cue', at: 2, cue: true, expireAcrossGap: true }), {
    stopTie: true,
    stopSoundTie: false,
  });
  assert.equal(elements(measure.node, 'tie').length, 1);
  assert.equal(ties.discardUnresolved(), false);
});

test('tie playback expires pitch gaps but retains captured endpoints and wait-for-note links', () => {
  const measure = xmlbuilder.create().ele('measure');
  const ties = createTiePlaybackSession([
    { kind: 'tieState', voice: 2, moment: moment(0), waitForNote: true },
  ]);

  for (const [key, voice] of [
    ['expired', 1],
    ['captured', 1],
    ['waiting', 2],
  ] as const) {
    ties.start(key, voice, 1, measure.ele('tie', { type: 'start' }));
  }

  assert.deepEqual(ties.stop({ key: 'expired', at: 2, cue: false, expireAcrossGap: true }), {
    stopTie: false,
    stopSoundTie: false,
  });
  assert.deepEqual(ties.stop({ key: 'captured', at: 2, cue: false, expireAcrossGap: false }), {
    stopTie: true,
    stopSoundTie: true,
  });
  assert.deepEqual(ties.stop({ key: 'waiting', at: 2, cue: false, expireAcrossGap: true }), {
    stopTie: true,
    stopSoundTie: true,
  });
  assert.equal(elements(measure.node, 'tie').length, 2);
});

test('part completion removes unresolved sound links and resets cue-only pending links', () => {
  const measure = xmlbuilder.create().ele('measure');
  const ties = createTiePlaybackSession([]);

  ties.start('unresolved', 1, 1, measure.ele('tie', { type: 'start' }));
  ties.start('cue', 2, 1);
  assert.equal(ties.discardUnresolved(), true);
  assert.equal(elements(measure.node, 'tie').length, 0);
  assert.equal(ties.discardUnresolved(), false);
  assert.deepEqual(ties.stop({ key: 'cue', at: 1, cue: false, expireAcrossGap: true }), {
    stopTie: false,
    stopSoundTie: false,
  });
});

test('part preparation can repeat without changing layout boundaries or registering name updates', () => {
  const document: ScoreDocument = {
    version: 1,
    source: 'pickup.ly',
    lilypondVersion: '2.26.0',
    header: {},
    contexts: [
      { id: 0, type: 'Score', name: '', parent: null },
      { id: 1, type: 'Staff', name: '', parent: 0 },
      { id: 2, type: 'Voice', name: '', parent: 1 },
    ],
    events: [
      {
        kind: 'skip',
        voice: 2,
        staff: 1,
        moment: moment(-1, 4),
        duration: { log: 1, dots: 0, scale: { numerator: 1, denominator: 1 } },
      },
    ],
  };
  const warn = () => {};
  const normalized = normalizeScore(document, warn);
  const plan = planScore(document, normalized, warn);
  const context = { document, normalized, plan, warn, options: {} };
  const layout = createLayoutSession(context, undefined);
  const owner = plan.parts[0]!;
  const timing = layout.partTimings.get(owner)!;
  const original = [...timing.boundaries];

  Object.freeze(timing.boundaries);
  const name: NameState = {
    context: 1,
    text: 'Change',
    shortText: 'Ch.',
    hidden: false,
    moment: moment(1, 8),
    pieceUpdate: true,
  };

  plan.partNames.set(owner.id, [name]);
  const first = preparePart(context, layout, owner);
  const second = preparePart(context, layout, owner);

  assert.deepEqual(timing.boundaries, original);
  assert.deepEqual(first.plan.boundaries, [-0.25, ...original]);
  assert.deepEqual(second.plan.boundaries, first.plan.boundaries);
  assert.deepEqual(first.deferredNameUpdates, [name]);
  assert.equal(layout.deferredNameUpdates.size, 0);
});

test('name selection defers piece updates inside measures and before boundary grace notes', () => {
  const name = (at: number, pieceUpdate = true): NameState => ({
    context: 1,
    text: String(at),
    shortText: String(at),
    hidden: false,
    moment: moment(at),
    pieceUpdate,
  });
  const initial = name(0, false),
    boundary = name(1),
    interior = name(0.5),
    graceBoundary = name(2);
  const graceNote: NoteLike = {
    kind: 'note',
    attachments: [],
    voice: 2,
    staff: 1,
    moment: { ...moment(2), grace: { numerator: -1, denominator: 8 } },
    duration: { log: 3, dots: 0, scale: { numerator: 1, denominator: 1 } },
  };
  const names = Object.freeze([initial, boundary, interior, graceBoundary]);
  const selected = selectPartNames(names, [0, 1, 2], [graceNote], part, (at) => at * 8);

  assert.deepEqual(selected.nameSeries, [initial, boundary]);
  assert.deepEqual(selected.deferredNameUpdates, [interior, graceBoundary]);
});

test('missing harmony ownership identifies the source voice and chosen part', () => {
  const input = {
    harmonies: [
      {
        kind: 'harmony' as const,
        context: 17,
        moment: moment(0),
        duration: { log: 2, dots: 0, scale: { numerator: 1, denominator: 1 } },
        pitches: [],
        playedPitches: [],
        bass: null,
        inversion: null,
        text: '',
        repeated: false,
        skip: false,
      },
    ],
    context: new Map(),
    ancestors: () => [],
    staffIds: [],
    parts: [] as Part[],
  };

  assert.throws(() => createHarmonyNotes(input), /part for harmony voice 17/);
  assert.throws(
    () => createHarmonyNotes({ ...input, parts: [{ ...part, staves: [] }] }),
    /staff for harmony voice 17 in part P1/,
  );
});

test('invalid playback pitch identifies the source note and voice', () => {
  const note: PlannedNote = {
    kind: 'note',
    noteId: 23,
    staff: 1,
    voice: 3,
    sourceVoice: 17,
    moment: moment(0),
    duration: { log: 2, dots: 0, scale: { numerator: 1, denominator: 1 } },
    pitch: { octave: 0, step: 9, alteration: { numerator: 0, denominator: 1 } },
    attachments: [],
    segmentDuration: 0.25,
    continuation: false,
    continues: false,
    tieAtEnd: false,
  };

  assert.throws(
    () =>
      writeNotePlayback(
        {
          ties: createTiePlaybackSession([]),
          tieGraphics: new Map(),
        },
        note,
        {
          voice: 2,
          notePosition: 0,
          attachments: [],
          node: xmlbuilder.create().ele('note'),
        },
      ),
    /pitch step 9 for source note 23 in voice 17 \(written voice 2\)/,
  );
});
