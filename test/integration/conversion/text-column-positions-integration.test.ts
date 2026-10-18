import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { create } from 'xmlbuilder2';
import { createConverter, toMusicXML } from '../../../src/index.js';
import type { Attachment } from '../../../src/musicxml/planning/events.js';
import type {
  FormattedEvent,
  ScoreDocument,
  TextColumnPositionEvent,
} from '../../../src/model/document.js';
import { validate } from '../../support/schema.js';
import { elements, parse } from '../../support/xml-support.js';

const reader = new VerovioToolkit(await createModule());

after(() => reader.destroy());

test('line-level TextScript positions serialize as schema-valid words and survive cache replay', async () => {
  const converter = createConverter();

  try {
    const base = (
      await converter.convert(String.raw`\score { \new Staff = "solo" { c'4 d'4 } \layout {} }`)
    ).scores[0]!.document;
    const noteIndex = base.events.findIndex((event) => event.kind === 'note');

    assert.ok(noteIndex >= 0);
    const note = base.events[noteIndex] as Extract<FormattedEvent, { kind: 'note' }>;
    const measure = base.events.find(
      (event) =>
        event.kind === 'measureLayout' &&
        event.staff === note.staff &&
        event.system === 1 &&
        event.moment.main.numerator === 0,
    )!;

    assert.ok(
      measure.kind === 'measureLayout' &&
        measure.startXTenths !== null &&
        measure.systemLeftXTenths !== null,
    );
    const id = 7401;
    const attachment = {
      class: 'text-script-event',
      text: 'North South',
      textColumnId: id,
    } as const;
    const sidecar: TextColumnPositionEvent = {
      kind: 'textColumnPosition',
      id,
      context: note.voice,
      staffContext: note.staff,
      system: measure.system,
      moment: note.moment,
      units: 'system-left/staff-top-global-tenths',
      systemLeftOriginXTenths: measure.systemLeftXTenths,
      outputScale: 1,
      globalLayoutStaffSpace: Number(base.paper!['staff-space']),
      globalStaffSpaceMm: Number(base.paper!['staff-space']),
      lines: [
        {
          index: 0,
          text: 'North',
          systemLeftRelativeXTenths: 2.25,
          staffTopYTenths: 9,
        },
        {
          index: 1,
          text: 'South',
          systemLeftRelativeXTenths: 4.5,
          staffTopYTenths: -3,
        },
      ],
    };
    const events = [...base.events];

    events[noteIndex] = {
      ...note,
      attachments: [...(note.attachments ?? []), attachment as Attachment],
    } as FormattedEvent;
    const cached = {
      ...base,
      measureLayoutsCaptured: true,
      events: [...events, sidecar],
    } as ScoreDocument;
    const result = toMusicXML(cached);

    validate(result.musicxml);
    const xml = parse(result.musicxml);
    const words = elements(xml, 'words').filter((word) =>
      ['North', 'South'].includes(word.textContent ?? ''),
    );

    assert.deepEqual(
      words.map((word) => [
        word.textContent,
        word.getAttribute('default-x'),
        word.getAttribute('default-y'),
      ]),
      [
        ['North', String(measure.systemLeftXTenths! + 2.25 - measure.startXTenths!), '9'],
        ['South', String(measure.systemLeftXTenths! + 4.5 - measure.startXTenths!), '-3'],
      ],
    );
    assert.ok(result.diagnostics.every((diagnostic) => diagnostic.code !== 'text-column-position'));

    const replay = toMusicXML(JSON.parse(JSON.stringify(cached)) as ScoreDocument);

    validate(replay.musicxml);
    const replayWords = elements(parse(replay.musicxml), 'words').filter((word) =>
      ['North', 'South'].includes(word.textContent ?? ''),
    );

    assert.deepEqual(
      replayWords.map((word) => [
        word.textContent,
        word.getAttribute('default-x'),
        word.getAttribute('default-y'),
      ]),
      words.map((word) => [
        word.textContent,
        word.getAttribute('default-x'),
        word.getAttribute('default-y'),
      ]),
    );

    const fallback = toMusicXML({
      ...cached,
      events: cached.events.filter((event) => event.kind !== 'textColumnPosition'),
    });

    validate(fallback.musicxml);
    const fallbackWords = elements(parse(fallback.musicxml), 'words').filter(
      (word) => word.textContent === 'North South',
    );

    assert.equal(fallbackWords.length, 1);
    assert.ok(
      !fallbackWords[0]!.hasAttribute('default-x') && !fallbackWords[0]!.hasAttribute('default-y'),
    );
    assert.ok(
      fallback.diagnostics.some((diagnostic) => diagnostic.code === 'text-column-position'),
    );
  } finally {
    converter.dispose();
  }
});

test('real TextScript source sidecars project to independently owned native line anchors', async () => {
  const converter = createConverter();

  try {
    const converted = await converter.convert(String.raw`\version "2.26.0"
\score { \new Staff { c'4-\markup \center-column { "line-one" "line-two" } c'4 d'4 e'4-\markup \left-column { "north" "south" } } \layout {} }
`);
    const score = converted.scores[0]!;

    validate(score.musicxml);
    const sidecars = score.document.events.filter((event) => event.kind === 'textColumnPosition');

    assert.equal(
      sidecars.length,
      2,
      'the two actual source TextScript columns have sidecar positions',
    );
    assert.ok(
      !score.diagnostics.some((diagnostic) => diagnostic.code === 'text-column-position-reader'),
    );
    const xml = parse(score.musicxml);
    const positioned = elements(xml, 'words').filter((word) =>
      ['line-one', 'line-two', 'north', 'south'].includes(word.textContent ?? ''),
    );

    assert.equal(positioned.length, 4);
    assert.ok(
      positioned.every((word) => word.hasAttribute('default-x') && word.hasAttribute('default-y')),
    );
    assert.equal(elements(xml, 'image').length, 0);

    const replay = toMusicXML(JSON.parse(JSON.stringify(score.document)) as ScoreDocument);

    validate(replay.musicxml);
    const replayWords = elements(parse(replay.musicxml), 'words').filter((word) =>
      ['line-one', 'line-two', 'north', 'south'].includes(word.textContent ?? ''),
    );

    assert.deepEqual(
      replayWords.map((word) => [
        word.textContent,
        word.getAttribute('default-x'),
        word.getAttribute('default-y'),
      ]),
      positioned.map((word) => [
        word.textContent,
        word.getAttribute('default-x'),
        word.getAttribute('default-y'),
      ]),
    );
    const withPositions = score.musicxml;
    const control = create(withPositions);

    for (const word of elements(control.node, 'words')) {
      if (['line-one', 'line-two', 'north', 'south'].includes(word.textContent ?? '')) {
        word.removeAttribute('default-x');
        word.removeAttribute('default-y');
      }
    }

    const withoutPositions = control.end({ prettyPrint: false });

    validate(withPositions);
    validate(withoutPositions);
    assert.equal(reader.loadData(withPositions), 1);
    const positionedSvg = reader.renderToSVG(1);
    const positionedMei = reader.getMEI();

    assert.equal(reader.loadData(withoutPositions), 1);
    const controlSvg = reader.renderToSVG(1);
    const controlMei = reader.getMEI();
    const labelAnchors = (svg: string) =>
      elements(parse(svg), 'g')
        .filter((node) => node.getAttribute('class') === 'dir')
        .map((node) => [node.textContent?.trim(), node.getAttribute('transform')]);
    const positionedLabels = labelAnchors(positionedSvg),
      controlLabels = labelAnchors(controlSvg);

    assert.equal(
      positionedLabels.length,
      2,
      `Verovio renders both source directions: ${positionedMei.match(/<(?:dir|rend)[^>]*>[\s\S]*?<\/(?:dir|rend)>/g)}`,
    );
    assert.equal(controlLabels.length, 2);
    assert.deepEqual(positionedLabels, controlLabels);
    const directionRows = (mei: string) =>
      [...mei.matchAll(/<dir\b([^>]*)>([\s\S]*?)<\/dir>/g)].map(([, attrs, body]) => ({
        text: (body ?? '').replace(/<[^>]*>/g, '').trim(),
        staff: attrs?.match(/\bstaff="([^"]+)"/)?.[1] ?? null,
        tstamp: attrs?.match(/\btstamp="([^"]+)"/)?.[1] ?? null,
      }));

    assert.deepEqual(
      directionRows(positionedMei),
      directionRows(controlMei),
      'Verovio 6.3.0 imports the same direction text/timing when only words positions are removed',
    );
  } finally {
    converter.dispose();
  }
});
