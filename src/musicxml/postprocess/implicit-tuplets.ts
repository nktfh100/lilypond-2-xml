import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Add } from '../types.js';
import { xmlElement } from '../primitives.js';

interface RhythmNote {
  node: XMLBuilder;
  start: number;
  duration: number;
  base: number;
  actual: number;
  normal: number;
  covered: boolean;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-8;
const text = (node: XMLBuilder, name: string, fallback = '') =>
  node.find((child) => child.node.nodeName === name)?.node.textContent ?? fallback;
const bases: Record<string, number> = {
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
  '512th': 0.0078125,
  '1024th': 0.00390625,
};

export function completeImplicitTuplets(part: XMLBuilder, add: Add): void {
  const usedNumbers = new Set(
    part
      .filter((child) => child.node.nodeName === 'tuplet', false, true)
      .map((mark) => Number(xmlElement(mark).getAttribute('number') || 1)),
  );
  const number = Array.from({ length: 16 }, (_, index) => index + 1).find(
    (number) => !usedNumbers.has(number),
  );

  if (number === undefined) {
    return;
  }

  const voices = new Map<string, RhythmNote[]>();
  const active = new Map<string, Set<string>>();
  let divisions = 1,
    measureStart = 0;

  for (const measure of part.filter((child) => child.node.nodeName === 'measure')) {
    let cursor = 0,
      end = 0;

    for (const node of measure.filter(() => true)) {
      if (node.node.nodeName === 'attributes') {
        divisions = Number(text(node, 'divisions', String(divisions)));
      } else if (['backup', 'forward'].includes(node.node.nodeName)) {
        cursor +=
          ((node.node.nodeName === 'backup' ? -1 : 1) * Number(text(node, 'duration'))) / divisions;
        end = Math.max(end, cursor);
      } else if (node.node.nodeName === 'note') {
        if (node.find((child) => ['grace', 'chord'].includes(child.node.nodeName))) {
          continue;
        }

        const start = measureStart + cursor;
        const duration = Number(text(node, 'duration')) / divisions;

        cursor += duration;
        end = Math.max(end, cursor);
        const voice = text(node, 'voice', '1');
        const spans = active.get(voice) ?? new Set<string>();
        const marks = node
          .filter((child) => child.node.nodeName === 'notations')
          .flatMap((notations) => notations.filter((child) => child.node.nodeName === 'tuplet'));
        const tremolo = node.find((child) => child.node.nodeName === 'tremolo', false, true);
        const covered =
          spans.size > 0 ||
          marks.length > 0 ||
          (tremolo !== undefined &&
            ['start', 'stop'].includes(xmlElement(tremolo).getAttribute('type') ?? ''));

        for (const mark of marks) {
          const number = xmlElement(mark).getAttribute('number') ?? '1';

          if (xmlElement(mark).getAttribute('type') === 'start') {
            spans.add(number);
          } else {
            spans.delete(number);
          }
        }

        active.set(voice, spans);
        const modification = node.find((child) => child.node.nodeName === 'time-modification');
        const notes = voices.get(voice) ?? [];

        notes.push({
          node,
          start,
          duration,
          covered,
          base:
            (bases[text(node, 'type')] ?? 0) /
            2 ** node.filter((child) => child.node.nodeName === 'dot').length,
          actual: modification ? Number(text(modification, 'actual-notes')) : 1,
          normal: modification ? Number(text(modification, 'normal-notes')) : 1,
        });
        voices.set(voice, notes);
      }
    }

    measureStart += end;
  }

  const wrap = (group: RhythmNote[], count: number, type: string) => {
    for (const [member, kind] of [
      [group[0]!, 'start'],
      [group.at(-1)!, 'stop'],
    ] as const) {
      let notations = member.node.find((child) => child.node.nodeName === 'notations');

      if (!notations) {
        notations = add(member.node, 'notations');
        const following = member.node.find((child) =>
          ['lyric', 'play', 'listen'].includes(child.node.nodeName),
        );

        if (following) {
          member.node.node.insertBefore(notations.node, following.node);
        }
      }

      const tuplet = add(notations, 'tuplet', undefined, {
        type: kind,
        number,
        bracket: 'no',
        'show-number': 'none',
      });

      if (kind === 'start') {
        for (const [name, value] of [
          ['tuplet-actual', group[0]!.actual],
          ['tuplet-normal', group[0]!.normal],
        ] as const) {
          const details = add(tuplet, name);

          add(details, 'tuplet-number', Math.round(count) * value);
          add(details, 'tuplet-type', type);
        }
      }
    }
  };

  for (const notes of voices.values()) {
    let group: RhythmNote[] = [];
    const flush = () => {
      for (const note of group) {
        wrap([note], 1, text(note.node, 'type'));
      }

      group = [];
    };

    for (const note of notes) {
      const previous = group.at(-1);

      if (
        previous &&
        (!near(previous.start + previous.duration, note.start) ||
          previous.actual !== note.actual ||
          previous.normal !== note.normal)
      ) {
        flush();
      }

      if (note.covered || note.actual <= 0 || note.actual === note.normal || !note.base) {
        flush();
        continue;
      }

      group.push(note);
      const base = Math.min(...group.map((member) => member.base));
      const written = group.reduce(
        (sum, member) => sum + (member.duration * member.actual) / member.normal,
        0,
      );
      const count = written / (base * note.actual);

      if (count < 1 || !near(count, Math.round(count))) {
        continue;
      }

      const type = Object.keys(bases).find((type) => bases[type] === base);

      if (!type) {
        flush();
        continue;
      }

      wrap(group, count, type);
      group = [];
    }

    flush();
  }
}
