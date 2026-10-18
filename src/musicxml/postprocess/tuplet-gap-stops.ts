import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Add } from '../types.js';
import { xmlElement } from '../primitives.js';

interface TupletGapSpan {
  voice: number;
  number: number;
  start: number;
  end: number;
}

const text = (node: XMLBuilder, name: string) =>
  node.find((child) => child.node.nodeName === name)?.node.textContent ?? '';
const near = (a: number, b: number) => Math.abs(a - b) < 1e-8;
const types = [
  'maxima',
  'long',
  'breve',
  'whole',
  'half',
  'quarter',
  'eighth',
  '16th',
  '32nd',
  '64th',
  '128th',
  '256th',
  '512th',
  '1024th',
];
const timingChildren = new Set([
  'rest',
  'duration',
  'voice',
  'type',
  'dot',
  'time-modification',
  'staff',
]);

export function completeTupletGapStops(
  part: XMLBuilder,
  spans: readonly TupletGapSpan[],
  add: Add,
  replace: (from: XMLBuilder, to: XMLBuilder) => void,
): void {
  const notes: {
    node: XMLBuilder;
    voice: string;
    start: number;
    end: number;
    divisions: number;
  }[] = [];
  const gaps: {
    node: XMLBuilder;
    measure: XMLBuilder;
    voice: string;
    start: number;
    end: number;
    divisions: number;
  }[] = [];
  let divisions = 1,
    measureStart = 0;

  for (const measure of part.filter((child) => child.node.nodeName === 'measure')) {
    let cursor = 0,
      end = 0;

    for (const node of measure.filter(() => true)) {
      if (node.node.nodeName === 'attributes') {
        divisions = Number(text(node, 'divisions') || divisions);
      } else if (['backup', 'forward'].includes(node.node.nodeName)) {
        const duration = Number(text(node, 'duration')) / divisions;

        if (node.node.nodeName === 'forward') {
          gaps.push({
            node,
            measure,
            voice: text(node, 'voice'),
            start: measureStart + cursor,
            end: measureStart + cursor + duration,
            divisions,
          });
        }

        cursor += (node.node.nodeName === 'backup' ? -1 : 1) * duration;
        end = Math.max(end, cursor);
      } else if (
        node.node.nodeName === 'note' &&
        !node.find((child) => ['grace', 'chord'].includes(child.node.nodeName))
      ) {
        const duration = Number(text(node, 'duration')) / divisions;

        notes.push({
          node,
          voice: text(node, 'voice'),
          start: measureStart + cursor,
          end: measureStart + cursor + duration,
          divisions,
        });

        if (
          xmlElement(node).getAttribute('print-object') === 'no' &&
          node.find((child) => child.node.nodeName === 'rest') &&
          node.filter(() => true).every((child) => timingChildren.has(child.node.nodeName)) &&
          Array.from(xmlElement(node).attributes).every(
            (attribute) => attribute.name === 'print-object',
          )
        ) {
          gaps.push({
            node,
            measure,
            voice: text(node, 'voice'),
            start: measureStart + cursor,
            end: measureStart + cursor + duration,
            divisions,
          });
        }

        cursor += duration;
        end = Math.max(end, cursor);
      }
    }

    measureStart += end;
  }

  const mark = (node: XMLBuilder, type: string, number: number) =>
    node.find(
      (child) =>
        child.node.nodeName === 'tuplet' &&
        xmlElement(child).getAttribute('type') === type &&
        Number(xmlElement(child).getAttribute('number') || 1) === number,
      false,
      true,
    );
  const completedEnds = new Map<string, XMLBuilder>();
  const stop = (node: XMLBuilder, number: number) => {
    const notations =
      node.find((child) => child.node.nodeName === 'notations') ?? add(node, 'notations');

    add(notations, 'tuplet', undefined, { type: 'stop', number });
  };

  for (const span of [...spans].sort((a, b) => a.end - b.end)) {
    const voice = String(span.voice);
    const first = notes.find(
      (note) =>
        note.voice === voice &&
        near(note.start, span.start) &&
        mark(note.node, 'start', span.number),
    );

    if (
      !first ||
      notes.some(
        (note) =>
          note.voice === voice && near(note.end, span.end) && mark(note.node, 'stop', span.number),
      )
    ) {
      continue;
    }

    const completed = completedEnds.get(`${voice}:${span.end}`);

    if (completed) {
      stop(completed, span.number);
      continue;
    }

    const gap = gaps.find(
      (gap) =>
        gap.voice === voice &&
        gap.end >= span.end - 1e-8 &&
        gap.start < span.end - 1e-8 &&
        gap.start >= span.start - 1e-8,
    );

    if (!gap) {
      continue;
    }

    let unit = first.end - first.start;
    let type = types.indexOf(text(first.node, 'type'));

    if (type < 0) {
      continue;
    }

    const duration = span.end - gap.start;

    while (!near(duration / unit, Math.round(duration / unit)) && type < types.length - 1) {
      unit /= 2;
      type++;
    }

    if (
      !near(duration / unit, Math.round(duration / unit)) ||
      !near(unit * gap.divisions, Math.round(unit * gap.divisions))
    ) {
      continue;
    }

    let remaining = Math.round(duration / unit);
    let last: XMLBuilder | undefined;
    let firstRest: XMLBuilder | undefined;

    while (remaining > 0) {
      const power = Math.min(Math.floor(Math.log2(remaining)), type);
      const count = 2 ** power;
      const rest = add(gap.measure, 'note', undefined, {
        'print-object': 'no',
      });

      add(rest, 'rest');
      add(rest, 'duration', Math.round(unit * count * gap.divisions));
      add(rest, 'voice', voice);
      add(rest, 'type', types[type - power]);

      for (const _ of first.node.filter((child) => child.node.nodeName === 'dot')) {
        add(rest, 'dot');
      }

      const modification = first.node.find((child) => child.node.nodeName === 'time-modification');

      if (modification) {
        rest.import(modification);
      }

      const staff = text(gap.node, 'staff');

      if (staff) {
        add(rest, 'staff', staff);
      }

      gap.measure.node.insertBefore(rest.node, gap.node.node);
      firstRest ??= rest;
      last = rest;
      remaining -= count;
    }

    stop(last!, span.number);
    completedEnds.set(`${voice}:${span.end}`, last!);
    replace(gap.node, firstRest!);
    gap.start = span.end;
    const tail = gap.end - span.end;

    if (near(tail, 0)) {
      gap.node.remove();
    } else if (gap.node.node.nodeName === 'forward') {
      gap.node.find((child) => child.node.nodeName === 'duration')!.node.textContent = String(
        Math.round(tail * gap.divisions),
      );
    } else {
      const forward = add(gap.measure, 'forward');

      add(forward, 'duration', Math.round(tail * gap.divisions));
      add(forward, 'voice', voice);
      const staff = text(gap.node, 'staff');

      if (staff) {
        add(forward, 'staff', staff);
      }

      gap.measure.node.insertBefore(forward.node, gap.node.node);
      gap.node.remove();
      gap.node = forward;
    }
  }
}
