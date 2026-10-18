import type { Pitch } from '@sightread/lilypond-eventdocument';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Add } from '../../types.js';
import { required } from '../../planning/events.js';
import type { HarmonyEvent } from '../../../model/document.js';

const semitones = [0, 2, 4, 5, 7, 9, 11];
const pitchValue = (p: Pitch) =>
  p.octave * 12 +
  required(semitones[p.step], 'harmony.ts: semitones[p.step]') +
  (p.alteration.numerator / p.alteration.denominator) * 2;
const bases: [string, [number, number][]][] = [
  [
    'major',
    [
      [1, 0],
      [3, 4],
      [5, 7],
    ],
  ],
  [
    'minor',
    [
      [1, 0],
      [3, 3],
      [5, 7],
    ],
  ],
  [
    'dominant',
    [
      [1, 0],
      [3, 4],
      [5, 7],
      [7, 10],
    ],
  ],
  [
    'major-seventh',
    [
      [1, 0],
      [3, 4],
      [5, 7],
      [7, 11],
    ],
  ],
  [
    'minor-seventh',
    [
      [1, 0],
      [3, 3],
      [5, 7],
      [7, 10],
    ],
  ],
  [
    'diminished-seventh',
    [
      [1, 0],
      [3, 3],
      [5, 6],
      [7, 9],
    ],
  ],
  [
    'half-diminished',
    [
      [1, 0],
      [3, 3],
      [5, 6],
      [7, 10],
    ],
  ],
  [
    'major-minor',
    [
      [1, 0],
      [3, 3],
      [5, 7],
      [7, 11],
    ],
  ],
  [
    'major-sixth',
    [
      [1, 0],
      [3, 4],
      [5, 7],
      [6, 9],
    ],
  ],
  [
    'minor-sixth',
    [
      [1, 0],
      [3, 3],
      [5, 7],
      [6, 9],
    ],
  ],
  [
    'augmented-seventh',
    [
      [1, 0],
      [3, 4],
      [5, 8],
      [7, 10],
    ],
  ],
  [
    'augmented',
    [
      [1, 0],
      [3, 4],
      [5, 8],
    ],
  ],
  [
    'diminished',
    [
      [1, 0],
      [3, 3],
      [5, 6],
    ],
  ],
  [
    'suspended-second',
    [
      [1, 0],
      [2, 2],
      [5, 7],
    ],
  ],
  [
    'suspended-fourth',
    [
      [1, 0],
      [4, 5],
      [5, 7],
    ],
  ],
  [
    'power',
    [
      [1, 0],
      [5, 7],
    ],
  ],
  ['pedal', [[1, 0]]],
];
const add: Add = (node, name, text, attrs = {}) => {
  const child = node.ele(name, attrs);

  if (text !== undefined) {
    child.txt(String(text));
  }

  return child;
};

export function writeHarmony(
  measure: XMLBuilder,
  chord: HarmonyEvent,
  options: { hidden?: boolean; offset?: number; staff?: number | undefined },
): XMLBuilder {
  const rootPitch = chord.pitches[0];
  const text = typeof chord.text === 'string' ? chord.text : '';
  const node = add(measure, 'harmony', undefined, {
    type: 'explicit',
    ...(options.hidden || !text ? { 'print-object': 'no' } : {}),
  });
  const root = add(node, 'root');

  add(root, 'root-step', rootPitch ? 'CDEFGAB'[rootPitch.step] : 'C', {
    text: '',
  });

  if (rootPitch?.alteration.numerator) {
    add(
      root,
      'root-alter',
      (rootPitch.alteration.numerator / rootPitch.alteration.denominator) * 2,
      { 'print-object': 'no' },
    );
  }

  let kind = 'none';
  let degrees: { degree: number; type: string; alter: number }[] = [];

  if (rootPitch) {
    const entries = chord.pitches.map((p): [number, number] => [
      p.octave * 7 + p.step - rootPitch.octave * 7 - rootPitch.step + 1,
      pitchValue(p) - pitchValue(rootPitch),
    ]);
    const actual = new Map([...entries].reverse());
    const extras = entries.filter(([degree], i) =>
      entries.slice(0, i).some(([previous]) => previous === degree),
    );
    const ranked = bases
      .map(([name, entries]) => {
        const base = new Map(entries);
        const changes = [...new Set([...actual.keys(), ...base.keys()])].filter(
          (d) => actual.get(d) !== base.get(d),
        );

        return { name, base, changes };
      })
      .sort((a, b) => a.changes.length - b.changes.length);
    const chosen = required(ranked[0], 'harmony.ts: ranked[0]');

    kind = chosen.name;
    degrees = chosen.changes.map((degree) => {
      const exists = actual.has(degree);
      const base = chosen.base.get(degree);
      const reference =
        required(semitones[(degree - 1) % 7], 'harmony.ts: semitones[(degree - 1) % 7]') +
        Math.floor((degree - 1) / 7) * 12 -
        ((degree - 1) % 7 === 6 ? 1 : 0);

      return {
        degree,
        type: !exists ? 'subtract' : base === undefined ? 'add' : 'alter',
        alter: !exists
          ? 0
          : required(actual.get(degree), 'harmony.ts: actual.get(degree)') - (base ?? reference),
      };
    });
    degrees.push(
      ...extras.map(([degree, interval]) => ({
        degree,
        type: 'add',
        alter:
          interval -
          (required(semitones[(degree - 1) % 7], 'harmony.ts: semitones[(degree - 1) % 7]') +
            Math.floor((degree - 1) / 7) * 12 -
            ((degree - 1) % 7 === 6 ? 1 : 0)),
      })),
    );
  }

  add(node, 'kind', kind, { text, 'use-symbols': 'no' });
  const inversionPitch = chord.inversion;

  if (inversionPitch) {
    const inversion = chord.pitches.findIndex(
      (p) =>
        p.step === inversionPitch.step &&
        p.alteration.numerator / p.alteration.denominator ===
          inversionPitch.alteration.numerator / inversionPitch.alteration.denominator,
    );

    if (inversion >= 0) {
      add(node, 'inversion', inversion);
    }
  }

  const bassPitch = chord.bass || chord.inversion;

  if (bassPitch) {
    const bass = add(node, 'bass');

    add(bass, 'bass-separator', '');
    add(bass, 'bass-step', 'CDEFGAB'[bassPitch.step], { text: '' });

    if (bassPitch.alteration.numerator) {
      add(
        bass,
        'bass-alter',
        (bassPitch.alteration.numerator / bassPitch.alteration.denominator) * 2,
        { 'print-object': 'no' },
      );
    }
  }

  for (const d of degrees) {
    const degree = add(node, 'degree', undefined, { 'print-object': 'no' });

    add(degree, 'degree-value', d.degree);
    add(degree, 'degree-alter', d.alter);
    add(degree, 'degree-type', d.type);
  }

  if (options.offset) {
    add(node, 'offset', options.offset);
  }

  if (options.staff) {
    add(node, 'staff', options.staff);
  }

  return node;
}
