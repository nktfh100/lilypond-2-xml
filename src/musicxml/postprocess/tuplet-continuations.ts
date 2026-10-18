import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Add } from '../types.js';
import { xmlElement } from '../primitives.js';

interface TupletSpan {
  notes: { node: XMLBuilder; measure: XMLBuilder }[];
  nested: boolean;
  complete: boolean;
}

const text = (node: XMLBuilder, name: string) =>
  node.find((child) => child.node.nodeName === name)?.node.textContent ?? '';

export function completeTupletContinuations(part: XMLBuilder, add: Add): void {
  const active = new Map<string, Map<string, TupletSpan>>();
  const spans: TupletSpan[] = [];
  const used = new Set<string>();

  for (const measure of part.filter((child) => child.node.nodeName === 'measure')) {
    for (const node of measure.filter((child) => child.node.nodeName === 'note')) {
      if (node.find((child) => ['grace', 'chord'].includes(child.node.nodeName))) {
        continue;
      }

      const voice = text(node, 'voice') || '1';
      const current = active.get(voice) ?? new Map<string, TupletSpan>();

      active.set(voice, current);
      const marks = node
        .filter((child) => child.node.nodeName === 'notations')
        .flatMap((notations) => notations.filter((child) => child.node.nodeName === 'tuplet'));

      for (const mark of marks) {
        const element = xmlElement(mark);
        const number = element.getAttribute('number') ?? '1';

        used.add(number);

        if (element.getAttribute('type') !== 'start') {
          continue;
        }

        const span = { notes: [], nested: false, complete: false };

        spans.push(span);
        current.set(number, span);
      }

      for (const span of current.values()) {
        span.nested ||= current.size > 1;
        span.notes.push({ node, measure });
      }

      for (const mark of marks) {
        const element = xmlElement(mark);

        if (element.getAttribute('type') !== 'stop') {
          continue;
        }

        const number = element.getAttribute('number') ?? '1';
        const span = current.get(number);

        if (span) {
          span.complete = true;
        }

        current.delete(number);
      }
    }
  }

  const number = Array.from({ length: 16 }, (_, index) => String(index + 1)).find(
    (value) => !used.has(value),
  );

  if (!number) {
    return;
  }

  for (const span of spans) {
    if (span.nested || !span.complete || !span.notes.length) {
      continue;
    }

    const ratio = (node: XMLBuilder) => {
      const modification = node.find((child) => child.node.nodeName === 'time-modification');

      return modification
        ? `${text(modification, 'actual-notes')}:${text(modification, 'normal-notes')}`
        : '';
    };
    const measures = new Map<XMLBuilder, XMLBuilder[]>();

    for (const { node, measure } of span.notes) {
      const notes = measures.get(measure) ?? [];

      notes.push(node);
      measures.set(measure, notes);
    }

    const groups = [...measures.values()].slice(1).flatMap((notes) => {
      const groups: XMLBuilder[][] = [];
      let previous = '';

      for (const node of notes) {
        const current = ratio(node);
        const [actual, normal] = current.split(':');

        if (!current || actual === normal) {
          previous = '';
          continue;
        }

        if (current !== previous) {
          groups.push([]);
        }

        groups.at(-1)!.push(node);
        previous = current;
      }

      return groups;
    });

    for (const notes of groups) {
      for (const [node, type] of [
        [notes[0]!, 'start'],
        [notes.at(-1)!, 'stop'],
      ] as const) {
        let notations = node.find((child) => child.node.nodeName === 'notations');

        if (!notations) {
          notations = add(node, 'notations');
          const following = node.find((child) =>
            ['lyric', 'play', 'listen'].includes(child.node.nodeName),
          );

          if (following) {
            node.node.insertBefore(notations.node, following.node);
          }
        }

        const mark = add(notations, 'tuplet', undefined, {
          type,
          number,
          bracket: 'no',
          'show-number': 'none',
        });

        if (type === 'start') {
          const modification = node.find((child) => child.node.nodeName === 'time-modification')!;

          for (const kind of ['actual', 'normal']) {
            const portion = add(mark, `tuplet-${kind}`);

            add(portion, 'tuplet-number', text(modification, `${kind}-notes`));
            add(portion, 'tuplet-type', text(node, 'type'));
          }
        }
      }
    }
  }
}
