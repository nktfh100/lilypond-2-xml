import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConverter, toMusicXML } from '../../../src/index.js';
import type { ScoreDocument } from '../../../src/model/document.js';
import { validate } from '../../support/schema.js';
import { elements, parse } from '../../support/xml-support.js';

const source = String.raw`\score { <<
  \new Staff = "bass" { c'2 d'2 }
  \new FiguredBass = "figures" \figuremode { <6 4>2 <5>2 }
>> \layout {} }`;

const momentKey = (moment: {
  main: { numerator: number; denominator: number };
  grace: { numerator: number; denominator: number };
}) =>
  `${moment.main.numerator}/${moment.main.denominator}:${moment.grace.numerator}/${moment.grace.denominator}`;
const momentValue = (moment: {
  main: { numerator: number; denominator: number };
  grace: { numerator: number; denominator: number };
}) =>
  moment.main.numerator / moment.main.denominator +
  moment.grace.numerator / moment.grace.denominator;

test('actual figured-bass positions project to schema-valid measure-relative MusicXML and survive cache round-trip', async () => {
  const converter = createConverter();

  try {
    const { scores } = await converter.convert(source);
    const score = scores[0]!;
    const figures = score.document.events.filter((event) => event.kind === 'figuredBass');
    const rows = figures.flatMap((group) => group.figures);

    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => row.graphicPosition?.stencilLive === true));
    assert.equal(
      rows[0]!.graphicPosition!.systemXTenths,
      rows[1]!.graphicPosition!.systemXTenths,
      'the 6/4 stack shares one source column',
    );
    assert.notEqual(
      rows[0]!.graphicPosition!.yTenths,
      rows[1]!.graphicPosition!.yTenths,
      'stacked rows have independent vertical positions',
    );
    assert.notEqual(
      rows[0]!.graphicPosition!.systemXTenths,
      rows[2]!.graphicPosition!.systemXTenths,
      'the later figure occupies a distinct source column',
    );
    const layouts = score.document.events.filter((event) => event.kind === 'measureLayout');

    assert.ok(score.document.measureLayoutsCaptured);
    const expected = rows.map((row) => {
      const position = row.graphicPosition!;
      const group = figures.find((candidate) =>
        candidate.figures.some((figure) => figure.id === row.id),
      )!;

      assert.equal(
        momentKey(position.columnMoment),
        momentKey(group.moment),
        'capture preserves the full actual source column moment',
      );
      const at = momentValue(group.moment);
      const matching = layouts.filter(
        (layout) =>
          layout.system === position.system &&
          layout.staff === position.staffContext &&
          momentValue(layout.moment) <= at &&
          at < momentValue(layout.endMoment),
      );

      assert.equal(
        matching.length,
        1,
        'source position joins one exact system/staff/full-moment measure',
      );
      const measure = matching[0]!;

      assert.ok(measure.startXTenths !== null && measure.endXTenths !== null);
      assert.ok(
        position.systemXTenths >= measure.startXTenths &&
          position.systemXTenths <= measure.endXTenths,
      );

      // Independent projection from source coordinates and the owning native measure.
      return {
        id: row.id,
        x: position.systemXTenths - measure.startXTenths,
        y: position.yTenths,
      };
    });

    validate(score.musicxml);
    const xml = parse(score.musicxml);
    const groups = elements(xml, 'figured-bass');
    const numbers = elements(xml, 'figure-number');

    assert.equal(groups.length, 2);
    assert.deepEqual(
      groups.map((group) => elements(group, 'figure-number').length),
      [2, 1],
    );
    assert.equal(numbers.length, 3);
    assert.ok(groups.every((group) => group.getAttribute('default-x') === '0'));

    for (let index = 0; index < numbers.length; index++) {
      assert.equal(numbers[index]!.getAttribute('default-x'), String(expected[index]!.x));
      assert.equal(numbers[index]!.getAttribute('default-y'), String(expected[index]!.y));
    }

    assert.ok(
      !score.diagnostics.some((diagnostic) => diagnostic.code === 'figured-bass-position-reader'),
    );

    // The public document is the cache representation; current position rows survive JSON encoding.
    const cached = JSON.parse(JSON.stringify(score.document)) as ScoreDocument;
    const replay = toMusicXML(cached);

    validate(replay.musicxml);
    const replayXml = parse(replay.musicxml);

    assert.deepEqual(
      elements(replayXml, 'figure-number').map((number) => [
        number.getAttribute('default-x'),
        number.getAttribute('default-y'),
        number.textContent,
      ]),
      elements(xml, 'figure-number').map((number) => [
        number.getAttribute('default-x'),
        number.getAttribute('default-y'),
        number.textContent,
      ]),
    );

    // One missing row invalidates the entire group rather than mixing positioned and fallback rows.
    const malformed = {
      ...cached,
      events: cached.events.map((event) =>
        event.kind !== 'figuredBass'
          ? event
          : {
              ...event,
              figures: event.figures.map((figure, index) =>
                index === 1 ? { ...figure, graphicPosition: null } : figure,
              ),
            },
      ),
    } as ScoreDocument;
    const fallback = toMusicXML(malformed);

    validate(fallback.musicxml);
    const fallbackXml = parse(fallback.musicxml);
    const fallbackGroups = elements(fallbackXml, 'figured-bass');

    assert.ok(
      elements(fallbackGroups[0]!, 'figure-number').every(
        (number) => !number.hasAttribute('default-x') && !number.hasAttribute('default-y'),
      ),
      'one malformed row disables positioning for the complete stacked group',
    );
    assert.ok(
      elements(fallbackGroups[1]!, 'figure-number').every(
        (number) => number.hasAttribute('default-x') && number.hasAttribute('default-y'),
      ),
      'the independent valid column keeps its measured position',
    );
    assert.ok(
      fallback.diagnostics.some((diagnostic) => diagnostic.code === 'figured-bass-position'),
    );
  } finally {
    converter.dispose();
  }
});
