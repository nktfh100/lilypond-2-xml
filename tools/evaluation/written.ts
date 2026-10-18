import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { create } from '../../src/musicxml/xml-builder.js';
import { isXmlElement, xmlElement } from '../../src/musicxml/primitives.js';

export interface WrittenNote {
  pitch: string;
  start: number;
  grace: number;
  duration: number;
  voice: string;
  tieStart?: boolean;
  tieStop?: boolean;
}

const epsilon = 1e-7;
const equal = (a: number, b: number) => Math.abs(a - b) < epsilon;
const fraction = (value: string) => {
  const [numerator, denominator = '1'] = value.split('/');
  const result = Number(numerator) / Number(denominator);

  if (!value.trim() || !Number.isFinite(result)) {
    throw new Error(`Invalid written reference number: ${value}`);
  }

  return result;
};

export function nativeWrittenNotes(tsv: string): WrittenNote[] {
  return tsv
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const fields = line.split('\t');

      if (fields[0] === 'unavailable') {
        throw new Error(`Native written reference unavailable: ${fields[1]}`);
      }

      if (fields.length !== 7) {
        throw new Error('Invalid written reference row');
      }

      const [step, octave, alter, start, grace, duration, voice] = fields as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      const letter = 'CDEFGAB'[Number(step)];

      if (!letter) {
        throw new Error('Invalid written reference pitch');
      }

      return {
        pitch: `${letter}:${fraction(alter)}:${fraction(octave)}`,
        start: fraction(start),
        grace: fraction(grace),
        duration: fraction(duration),
        voice,
      };
    });
}

const children = (element: Element) => Array.from(element.childNodes).filter(isXmlElement);
const child = (element: Element, name: string) =>
  children(element).find((node) => node.nodeName === name);
const text = (element: Element, name: string, fallback = '') =>
  child(element, name)?.textContent ?? fallback;
const number = (element: Element, name: string, fallback?: number) => {
  const value = text(element, name);

  if (!value && fallback !== undefined) {
    return fallback;
  }

  const result = Number(value);

  if (!value || !Number.isFinite(result)) {
    throw new Error(`Missing or invalid MusicXML ${name}`);
  }

  return result;
};

export function musicXmlWrittenNotes(xml: string): WrittenNote[] {
  const root = xmlElement(create(xml).root());

  if (root.nodeName !== 'score-partwise') {
    throw new Error('Written evaluation requires score-partwise MusicXML');
  }

  const notes: WrittenNote[] = [];

  for (const [partIndex, part] of children(root)
    .filter((node) => node.nodeName === 'part')
    .entries()) {
    let divisions = 1,
      measureStart = 0;

    for (const measure of children(part).filter((node) => node.nodeName === 'measure')) {
      let cursor = 0,
        end = 0,
        chordStart = 0;
      const pending = new Map<string, WrittenNote[]>();
      const flushGrace = (voice: string) => {
        const group = pending.get(voice) ?? [];
        const moments = [...new Set(group.map((note) => note.grace))];
        let remaining = moments.reduce(
          (sum, moment) => sum + group.find((note) => note.grace === moment)!.duration,
          0,
        );

        for (const moment of moments) {
          const duration = group.find((note) => note.grace === moment)!.duration;

          for (const note of group.filter((note) => note.grace === moment)) {
            note.grace = -remaining;
          }

          remaining -= duration;
        }

        pending.delete(voice);
      };

      for (const element of children(measure)) {
        if (element.nodeName === 'attributes') {
          divisions = number(element, 'divisions', divisions);

          if (divisions <= 0) {
            throw new Error('MusicXML divisions must be positive');
          }
        } else if (element.nodeName === 'backup' || element.nodeName === 'forward') {
          cursor +=
            ((element.nodeName === 'backup' ? -1 : 1) * number(element, 'duration')) / divisions;

          if (cursor < -epsilon) {
            throw new Error('MusicXML backup precedes the measure');
          }

          end = Math.max(end, cursor);
        } else if (element.nodeName === 'note') {
          const grace = !!child(element, 'grace'),
            chord = !!child(element, 'chord');
          const start = chord ? chordStart : cursor;

          if (!chord) {
            chordStart = start;
          }

          const voice = `${partIndex}:${text(element, 'staff', '1')}:${text(element, 'voice', '1')}`;
          let duration: number;

          if (grace) {
            const types: Record<string, number> = {
              maxima: 32,
              long: 16,
              breve: 8,
              whole: 4,
              half: 2,
              quarter: 1,
              eighth: 0.5,
              '16th': 0.25,
              '32nd': 0.125,
              '64th': 0.0625,
              '128th': 0.03125,
              '256th': 0.015625,
            };
            const base = types[text(element, 'type')];

            if (base === undefined) {
              throw new Error('Grace note has no supported written duration');
            }

            const modification = child(element, 'time-modification');

            duration =
              base *
              (2 - 2 ** -children(element).filter((node) => node.nodeName === 'dot').length) *
              (modification
                ? number(modification, 'normal-notes') / number(modification, 'actual-notes')
                : 1);
          } else {
            duration = number(element, 'duration') / divisions;
            flushGrace(voice);

            if (!chord) {
              cursor += duration;
            }

            end = Math.max(end, start + duration);
          }

          if (!Number.isFinite(duration) || duration <= 0) {
            throw new Error('Invalid MusicXML note duration');
          }

          const pitch = child(element, 'pitch');

          if (child(element, 'unpitched')) {
            throw new Error('Written percussion evaluation is not supported');
          }

          if (!pitch && !child(element, 'rest')) {
            throw new Error('MusicXML note has no pitch or rest');
          }

          const ties = children(element).filter((node) => node.nodeName === 'tie');
          const note: WrittenNote = {
            pitch: pitch
              ? `${text(pitch, 'step')}:${number(pitch, 'alter', 0)}:${number(pitch, 'octave')}`
              : '',
            start: measureStart + start,
            grace: 0,
            duration,
            voice,
            tieStart: ties.some((tie) => tie.getAttribute('type') === 'start'),
            tieStop: ties.some((tie) => tie.getAttribute('type') === 'stop'),
          };

          if (grace) {
            const group = pending.get(voice) ?? [];

            note.grace = chord && group.length ? group.at(-1)!.grace : group.length + 1;
            group.push(note);
            pending.set(voice, group);
          }

          if (pitch) {
            notes.push(note);
          }
        }
      }

      for (const voice of pending.keys()) {
        flushGrace(voice);
      }

      measureStart += end;
    }
  }

  return notes;
}

export function compareWrittenNotes(
  reference: readonly WrittenNote[],
  exported: readonly WrittenNote[],
) {
  const used = new Set<number>();
  const missing: WrittenNote[] = [];
  let matched = 0,
    normalizedFragments = 0;

  for (const expected of reference) {
    const candidates = exported
      .map((note, index) => ({ note, index }))
      .filter(
        ({ note, index }) =>
          !used.has(index) &&
          note.pitch === expected.pitch &&
          equal(note.start, expected.start) &&
          equal(note.grace, expected.grace),
      );
    let chain: number[] | undefined;

    for (const candidate of candidates.sort(
      (a, b) =>
        Number(equal(b.note.duration, expected.duration)) -
        Number(equal(a.note.duration, expected.duration)),
    )) {
      const fragments = [candidate.index];
      let duration = candidate.note.duration,
        tail = candidate.note;

      while (!expected.grace && duration < expected.duration - epsilon && tail.tieStart) {
        const next = exported.findIndex(
          (note, index) =>
            !used.has(index) &&
            !fragments.includes(index) &&
            note.voice === tail.voice &&
            note.pitch === tail.pitch &&
            !note.grace &&
            note.tieStop &&
            equal(note.start, tail.start + tail.duration),
        );

        if (next < 0) {
          break;
        }

        fragments.push(next);
        tail = exported[next]!;
        duration += tail.duration;
      }

      if (equal(duration, expected.duration)) {
        chain = fragments;
        break;
      }
    }

    if (chain) {
      matched++;
      normalizedFragments += chain.length - 1;

      for (const index of chain) {
        used.add(index);
      }
    } else {
      missing.push(expected);
    }
  }

  const extra = exported.filter((_, index) => !used.has(index));
  const exportedNotes = exported.length - normalizedFragments;

  return {
    referenceNotes: reference.length,
    exportedNotes,
    exportedFragments: exported.length,
    normalizedFragments,
    matched,
    missing: missing.length,
    extra: extra.length,
    percent: reference.length ? (200 * matched) / (reference.length + exportedNotes) : null,
    examples: { missing: missing.slice(0, 10), extra: extra.slice(0, 10) },
  };
}

export function summarizeWrittenComparisons(
  comparisons: readonly ReturnType<typeof compareWrittenNotes>[],
) {
  const referenceNotes = comparisons.reduce((sum, score) => sum + score.referenceNotes, 0);
  const exportedNotes = comparisons.reduce((sum, score) => sum + score.exportedNotes, 0);
  const matched = comparisons.reduce((sum, score) => sum + score.matched, 0);

  return {
    scores: comparisons.length,
    referenceNotes,
    exportedNotes,
    matched,
    percent: referenceNotes ? (200 * matched) / (referenceNotes + exportedNotes) : null,
  };
}
