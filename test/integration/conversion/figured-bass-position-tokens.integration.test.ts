import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createConverter, toMusicXML } from '../../../src/index.js';
import type { ScoreDocument } from '../../../src/model/document.js';
import { validate } from '../../support/schema.js';
import { elements as all, parse } from '../../support/xml-support.js';

const source = String.raw`\score { <<
  \new Staff = "bass" { \clef bass c'1 c'1 c'1 c'1 c'1 }
  \new FiguredBass = "figures" \figuremode { <6+>1
    \set figuredBassAlterationDirection = #RIGHT
    \set figuredBassPlusDirection = #RIGHT
    <6\+>1 <12>1 <6->1 <7!>1 }
>> \layout {} }`;
const converter = createConverter();

after(() => converter.dispose());

type Moment = {
  main: { numerator: number; denominator: number };
  grace: { numerator: number; denominator: number };
};
const momentValue = (value: Moment) =>
  value.main.numerator / value.main.denominator + value.grace.numerator / value.grace.denominator;
const offset = (value: unknown): value is readonly [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));

test('component-level figured-bass token positions serialize to schema-valid native children and survive cache replay', async () => {
  const { scores } = await converter.convert(source);
  const score = scores[0]!;
  const document = score.document;
  const groups = document.events.filter(
    (event): event is Extract<typeof event, { kind: 'figuredBass' }> =>
      event.kind === 'figuredBass' && event.figures.length > 0,
  );
  const figures = groups.flatMap((group) => group.figures);
  const positioned = figures.filter((figure) => figure.graphicPosition?.tokens !== undefined);

  assert.equal(groups.length, 5);
  assert.equal(figures.length, 5);
  assert.ok(
    positioned.length >= 4,
    'formatter mappings retain actual token positions for the common modifier and multi-digit forms',
  );
  assert.ok(positioned.some((figure) => figure.graphicPosition?.tokens?.prefix));
  assert.ok(positioned.some((figure) => figure.graphicPosition?.tokens?.suffix));

  const xml = parse(score.musicxml);

  validate(score.musicxml);
  const emitted = all(xml, 'figured-bass');

  assert.equal(emitted.length, groups.length);
  const tokenRoles = new Set<string>();

  for (const [groupIndex, group] of groups.entries()) {
    const row = group.figures[0]!;
    const position = row.graphicPosition;

    assert.ok(position?.stencilLive);
    const measure = document.events
      .filter((event) => event.kind === 'measureLayout')
      .filter(
        (layout) =>
          layout.staff === position.staffContext &&
          layout.system === position.system &&
          momentValue(layout.moment) <= momentValue(group.moment) &&
          momentValue(group.moment) < momentValue(layout.endMoment),
      );

    assert.equal(measure.length, 1, 'token offsets use the unique actual source measure frame');
    const start = measure[0]!.startXTenths;

    assert.ok(start !== null && start !== undefined);
    const nativeGroup = emitted[groupIndex]!;

    assert.equal(nativeGroup.getAttribute('default-x'), '0');
    const nativeFigure = all(nativeGroup, 'figure')[0]!;
    const tokens = position.tokens;

    if (!tokens) {
      continue;
    }

    for (const role of ['prefix', 'number', 'suffix'] as const) {
      const delta = tokens[role];

      if (delta === undefined) {
        continue;
      }

      assert.ok(offset(delta), `${role} offset is a finite pair`);
      tokenRoles.add(role);
      const childName = role === 'number' ? 'figure-number' : role;
      const child = all(nativeFigure, childName)[0];

      assert.ok(child, `native ${role} child exists for the captured source role`);
      const expectedX = position.systemXTenths + delta[0] - start;
      const expectedY = position.yTenths + delta[1];

      assert.ok(Number.isFinite(expectedX) && Number.isFinite(expectedY));
      assert.ok(
        Math.abs(Number(child.getAttribute('default-x')) - expectedX) < 1e-9,
        `${role} default-x is independently derived from source item origin, leaf delta, and measure start`,
      );
      assert.ok(
        Math.abs(Number(child.getAttribute('default-y')) - expectedY) < 1e-9,
        `${role} default-y is independently derived from source staff-top origin and leaf delta`,
      );
    }

    assert.equal(
      all(nativeFigure, 'figure-number')[0]?.textContent?.replace(/\s/g, ''),
      row.number === null ? '' : String(row.number),
    );
  }

  assert.ok(tokenRoles.has('number'));
  assert.ok(tokenRoles.has('prefix'));
  assert.ok(tokenRoles.has('suffix'));
  assert.ok(
    !score.diagnostics.some((diagnostic) => diagnostic.code === 'figured-bass-position-reader'),
  );

  const cached = JSON.parse(JSON.stringify(document)) as ScoreDocument;
  const replay = toMusicXML(cached);

  validate(replay.musicxml);
  const replayXml = parse(replay.musicxml);
  const replayGroups = all(replayXml, 'figured-bass');

  assert.equal(replayGroups.length, emitted.length);

  for (let i = 0; i < emitted.length; i++) {
    assert.deepEqual(
      ['prefix', 'figure-number', 'suffix'].map((tag) =>
        all(emitted[i]!, tag).map((node) => [
          node.textContent,
          node.getAttribute('default-x'),
          node.getAttribute('default-y'),
        ]),
      ),
      ['prefix', 'figure-number', 'suffix'].map((tag) =>
        all(replayGroups[i]!, tag).map((node) => [
          node.textContent,
          node.getAttribute('default-x'),
          node.getAttribute('default-y'),
        ]),
      ),
    );
  }

  // A malformed token pair invalidates every coordinate in that figure group.
  const malformed: ScoreDocument = {
    ...cached,
    events: cached.events.map((event) =>
      event.kind !== 'figuredBass' || !event.figures[0]?.graphicPosition?.tokens
        ? event
        : {
            ...event,
            figures: event.figures.map((figure, index) =>
              index === 0
                ? {
                    ...figure,
                    graphicPosition: {
                      ...figure.graphicPosition!,
                      tokens: {
                        ...figure.graphicPosition!.tokens,
                        number: [Number.NaN, 0],
                      },
                    },
                  }
                : figure,
            ),
          },
    ),
  };
  const fallback = toMusicXML(malformed);

  validate(fallback.musicxml);
  const fallbackXml = parse(fallback.musicxml);
  const invalidGroup = all(fallbackXml, 'figured-bass').find((group) =>
    all(group, 'figure-number').some(
      (number) => number.textContent === String(positioned[0]!.number),
    ),
  );

  assert.ok(invalidGroup);
  assert.ok(
    all(invalidGroup, 'figure-number').every(
      (number) => !number.hasAttribute('default-x') && !number.hasAttribute('default-y'),
    ),
    'malformed component metadata fails closed rather than retaining the number-only fallback',
  );
});
