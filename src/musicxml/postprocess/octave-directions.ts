import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import { xmlElement } from '../primitives.js';

interface OctaveDirection {
  node: XMLBuilder;
  offset: XMLBuilder | undefined;
  anchor: XMLBuilder | undefined;
  staff: string;
  key: string;
  type: string;
  unsafe: boolean;
}

const text = (node: XMLBuilder, name: string, fallback = '0') =>
  node.find((child) => child.node.nodeName === name)?.node.textContent ?? fallback;

export function anchorOctaveDirections(part: XMLBuilder): void {
  const directions: OctaveDirection[] = [];

  for (const measure of part.filter((node) => node.node.nodeName === 'measure')) {
    let cursor = 0,
      precedingGrace = false;
    const anchors: { node: XMLBuilder; at: number; staff: string }[] = [];
    const firstVoices = new Map<string, string>();
    const graceOnsets = new Set<string>();
    const pending: { direction: OctaveDirection; at: number }[] = [];

    for (const node of measure.filter(() => true)) {
      if (node.node.nodeName === 'direction') {
        const shift = node.find((child) => child.node.nodeName === 'octave-shift', false, true);

        if (!shift) {
          continue;
        }

        const offset = node.find((child) => child.node.nodeName === 'offset');
        const staff = text(node, 'staff', '1');
        const direction = {
          node,
          offset,
          anchor: undefined,
          staff,
          unsafe: false,
          key: `${staff}:${xmlElement(shift).getAttribute('number') ?? '1'}`,
          type: xmlElement(shift).getAttribute('type') ?? '',
        };

        directions.push(direction);
        pending.push({
          direction,
          at: cursor + Number(offset?.node.textContent ?? 0),
        });
      } else if (node.node.nodeName === 'note') {
        const grace = node.find((child) => child.node.nodeName === 'grace') !== undefined;
        const followsGrace = precedingGrace;

        precedingGrace = grace;

        if (grace) {
          graceOnsets.add(`${text(node, 'staff', '1')}:${cursor}`);
        }

        if (grace || node.find((child) => child.node.nodeName === 'chord')) {
          continue;
        }

        const staff = text(node, 'staff', '1');
        const voice = text(node, 'voice', '1');

        if (!firstVoices.has(staff)) {
          firstVoices.set(staff, voice);
        }

        if (followsGrace) {
          graceOnsets.add(`${staff}:${cursor}`);
        } else if (voice === firstVoices.get(staff)) {
          anchors.push({ node, at: cursor, staff });
        }

        cursor += Number(text(node, 'duration'));
      } else if (['backup', 'forward'].includes(node.node.nodeName)) {
        cursor += (node.node.nodeName === 'backup' ? -1 : 1) * Number(text(node, 'duration'));
      }
    }

    for (const { direction, at } of pending) {
      direction.unsafe = graceOnsets.has(`${direction.staff}:${at}`);

      if (!direction.unsafe) {
        direction.anchor = anchors.find(
          (node) => node.at === at && node.staff === direction.staff,
        )?.node;
      }
    }
  }

  const active = new Map<string, OctaveDirection[]>();
  const eligible = new Set<OctaveDirection>();
  const ambiguous = new Set<string>();

  for (const direction of directions) {
    if (['up', 'down'].includes(direction.type)) {
      if (active.has(direction.key)) {
        ambiguous.add(direction.key);
      } else {
        active.set(direction.key, [direction]);
      }

      continue;
    }

    if (direction.type !== 'stop') {
      ambiguous.add(direction.key);
      continue;
    }

    const span = active.get(direction.key);

    if (!span) {
      ambiguous.add(direction.key);
      continue;
    }

    span.push(direction);

    if (span.every((member) => !member.unsafe && member.anchor)) {
      for (const member of span) {
        eligible.add(member);
      }
    }

    active.delete(direction.key);
  }

  for (const key of active.keys()) {
    ambiguous.add(key);
  }

  for (const direction of directions) {
    if (
      ambiguous.has(direction.key) ||
      !eligible.has(direction) ||
      !direction.offset ||
      !Number(direction.offset.node.textContent) ||
      !direction.anchor
    ) {
      continue;
    }

    direction.node.node.parentNode!.insertBefore(direction.node.node, direction.anchor.node);
    direction.offset.node.textContent = '0';
  }
}
