import { createConverter, toMusicXML } from 'lilypond-2-xml';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { figureExtensions } from '../../../dist/musicxml/notation/harmony/figured-bass.js';
import type { FigureGroup, Time } from '../../../src/musicxml/planning/events.js';
import { validate } from '../../support/schema.js';
import { elements, parse } from '../../support/xml-support.js';

const moment = (at: number) => ({
  main: { numerator: at, denominator: 1 },
  grace: { numerator: 0, denominator: 1 },
});
const time: Time = (event) => event.moment.main.numerator / event.moment.main.denominator;
const figure = (
  id: number,
  extendTo: number | null = null,
  row: number | null = 0,
): FigureGroup['figures'][number] => ({
  id,
  extendTo,
  row,
  number: 6,
  alteration: null,
  augmented: false,
  diminished: false,
  augmentedSlash: false,
  bracketStart: false,
  bracketStop: false,
  alterationBracket: false,
  noContinuation: false,
  text: null,
  markup: null,
  hidden: false,
  implicit: false,
  continuation: {
    color: [1, 0, 0],
    offset: [2, -1],
    hidden: false,
    custom: false,
    style: 'line',
    thickness: 1,
  },
});
const group = (id: number, at: number, extendTo: number | null = null): FigureGroup => ({
  kind: 'figuredBass',
  context: 1,
  staff: 1,
  direction: 0,
  duration: { log: 0, dots: 0, scale: { numerator: 1, denominator: 1 } },
  skip: false,
  alterationDirection: -1,
  plusDirection: 1,
  custom: false,
  moment: moment(at),
  figures: [figure(id, extendTo)],
});
const move = (g: FigureGroup, at: number) => ({ ...g, moment: moment(at) });

test('continuation membership follows semantic rows when unrelated figures move between endpoints', () => {
  const semantic = [group(1, 0, 3), group(2, 1), group(3, 2), group(4, 3)];
  const realized = [semantic[0]!, move(semantic[1]!, 1.75), semantic[2]!, move(semantic[3]!, 1.5)];
  const warnings: string[] = [];
  const extensions = figureExtensions(realized, time, (code) => warnings.push(code), semantic);

  assert.deepEqual(
    [...extensions].map(([id, line]) => [id, line.type]),
    [
      [1, 'start'],
      [2, 'continue'],
      [3, 'stop'],
    ],
  );
  assert.deepEqual(extensions.get(2)!.attrs, {
    color: '#FF0000',
    'relative-x': 20,
    'relative-y': -10,
  });
  assert.ok(!warnings.includes('figured-bass-extend'));
});

test('missing, reversed and mismatched realized continuation endpoints are diagnosed', () => {
  const semantic = [group(1, 0, 2), group(2, 1)];

  for (const realized of [
    [semantic[0]!],
    [move(semantic[0]!, 2), semantic[1]!],
    [semantic[0]!, move(semantic[1]!, NaN)],
    [semantic[0]!, { ...semantic[1]!, figures: [figure(2, null, 1)] }],
  ]) {
    const warnings: string[] = [];
    const extensions = figureExtensions(realized, time, (code) => warnings.push(code), semantic);

    assert.equal(extensions.size, 0);
    assert.ok(warnings.includes('figured-bass-extend'));
  }
});

test('displaced semantic members are omitted with a diagnostic while endpoint flags remain', () => {
  const semantic = [group(1, 0, 3), group(2, 1), group(3, 2), group(4, 3)];
  const realized = [semantic[0]!, move(semantic[1]!, 3), semantic[2]!, move(semantic[3]!, 1)];
  const warnings: string[] = [];
  const extensions = figureExtensions(realized, time, (code) => warnings.push(code), semantic);

  assert.deepEqual(
    [...extensions].map(([id, line]) => [id, line.type]),
    [
      [1, 'start'],
      [3, 'stop'],
    ],
  );
  assert.ok(warnings.includes('figured-bass-extend'));
});

test('coincident realized continuation endpoints retain their separate start and stop flags', () => {
  const semantic = [group(1, 0, 2), group(2, 1)];
  const extensions = figureExtensions(
    semantic.map((g) => move(g, 1)),
    time,
    () => {},
    semantic,
  );

  assert.deepEqual(
    [...extensions].map(([id, line]) => [id, line.type]),
    [
      [1, 'start'],
      [2, 'stop'],
    ],
  );
});

test('adjacent continuation spans retain outgoing appearance at their shared endpoint', () => {
  const groups = [group(1, 0, 2), group(2, 1, 3), group(3, 2)];

  groups[1] = {
    ...groups[1]!,
    figures: [
      {
        ...groups[1]!.figures[0]!,
        continuation: {
          ...groups[1]!.figures[0]!.continuation!,
          color: [0, 0, 1],
        },
      },
    ],
  };
  const warnings: string[] = [];
  const extensions = figureExtensions(groups, time, (code) => warnings.push(code));

  assert.equal(extensions.get(2)!.type, 'continue');
  assert.equal(extensions.get(2)!.attrs.color, '#0000FF');
  assert.ok(warnings.includes('figured-bass-line-junction'));
});

test('compiler continuation ownership survives a cached unrelated figure moved into its columns', async () => {
  const converter = createConverter();

  try {
    const { scores } = await converter.convert(String.raw`<< \new Staff { c1 d e f }
      \figures { \bassFigureExtendersOn <6>1 <6> <6> <7> } >>`);
    const score = scores[0]!;
    const figures = score.document.events.filter((e) => e.kind === 'figuredBass');

    assert.ok(figures[0]!.figures[0]!.extendTo !== null);
    const unrelated = figures.find((g) => g.figures.some((f) => f.number === 7))!;
    const document = {
      ...score.document,
      events: score.document.events.map((e) =>
        e !== unrelated
          ? e
          : {
              ...unrelated,
              figures: unrelated.figures.map((f) => ({
                ...f,
                column: moment(1),
              })),
            },
      ),
    };
    const result = toMusicXML(document);

    validate(result.musicxml);
    const xml = parse(result.musicxml);
    const seven = elements(xml, 'figure').find(
      (f) => f.getElementsByTagName('figure-number')[0]?.textContent === '7',
    );

    assert.ok(seven);
    assert.equal(seven.getElementsByTagName('extend').length, 0);
    assert.deepEqual(
      elements(xml, 'extend').map((e) => e.getAttribute('type')),
      ['start', 'continue', 'stop'],
    );
    assert.ok(!result.diagnostics.some((d) => d.code === 'figured-bass-extend'));
  } finally {
    converter.dispose();
  }
});
