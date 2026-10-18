import type { Element, Node } from '@oozcitak/dom/lib/dom/interfaces.js';
import { parse } from './xml-support.js';

const children = (node: Node): Element[] =>
  Array.from(node.childNodes).filter((n): n is Element => n?.nodeType === 1);
const child = (node: Node, name: string) => children(node).find((n) => n.nodeName === name);
const number = (node: Node, name: string) => Number(child(node, name)?.textContent || 0);

export function navigationPlayback(musicxml: string): [string | null, number, number, number][] {
  const document = parse(musicxml);
  const part = document.getElementsByTagName('part')[0];
  const timeline: {
    at: number;
    sound?: Element;
    measureIndex?: number;
    note?: [string | null, number, number, number];
  }[] = [];
  let measureStart = 0;
  let divisions = 1;

  for (const [measureIndex, measure] of children(part!).entries()) {
    let cursor = measureStart;
    let end = measureStart;

    for (const node of children(measure)) {
      if (node.nodeName === 'attributes' && child(node, 'divisions')) {
        divisions = number(node, 'divisions');
      }

      if (node.nodeName === 'backup') {
        cursor -= number(node, 'duration') / divisions;
      }

      if (node.nodeName === 'forward') {
        cursor += number(node, 'duration') / divisions;
      }

      if (node.nodeName === 'direction' || node.nodeName === 'sound') {
        const sound = node.nodeName === 'sound' ? node : child(node, 'sound');

        if (sound) {
          const offset = child(sound, 'offset') || child(node, 'offset');

          timeline.push({
            at:
              cursor +
              (offset && (offset.parentNode === sound || offset.getAttribute('sound') === 'yes')
                ? Number(offset.textContent) / divisions
                : 0),
            sound,
            measureIndex,
          });
        }
      }

      if (node.nodeName === 'note' && !child(node, 'chord') && !child(node, 'grace')) {
        const pitch = child(node, 'pitch');
        const duration = number(node, 'duration') / divisions;

        if (pitch && !child(node, 'cue') && node.getAttribute('dynamics') !== '0') {
          timeline.push({
            at: cursor,
            note: [
              child(pitch, 'step')!.textContent,
              number(pitch, 'alter'),
              number(pitch, 'octave'),
              duration,
            ],
          });
        }

        cursor += duration;
      }

      end = Math.max(end, cursor);
    }

    measureStart = end;
  }

  timeline.sort((a, b) => a.at - b.at);
  const targets = new Map<string, number>(
    timeline.flatMap((e, i) =>
      e.sound
        ? ['segno', 'coda']
            .filter((name) => e.sound!.hasAttribute(name))
            .map((name): [string, number] => [`${name}:${e.sound!.getAttribute(name)}`, i])
        : [],
    ),
  );
  const visits = new Map<string, number>();
  const played = [];
  let returned = false;
  let index = 0;
  let count = 0;
  let position: string | undefined;

  while (index < timeline.length) {
    if (++count > 10000) {
      throw new Error('Navigation playback did not terminate');
    }

    const event = timeline[index++];

    if (event!.note) {
      played.push(event!.note);
    }

    if (!event!.sound) {
      continue;
    }

    const sound = event!.sound;
    const currentPosition = `${event!.measureIndex}:${event!.at}`;

    if (position !== currentPosition) {
      visits.set(currentPosition, (visits.get(currentPosition) || 0) + 1);
      position = currentPosition;
    }

    const visit = visits.get(currentPosition);
    const only = sound.getAttribute('time-only');
    const applies = (fallback: boolean) =>
      only ? only.split(',').map(Number).includes(visit!) : fallback;

    if (sound.hasAttribute('fine') && returned && applies(true)) {
      break;
    }

    if (sound.hasAttribute('dacapo') && applies(visit === 1)) {
      returned = true;
      index = 0;
      position = undefined;
    }

    for (const [attribute, target, active] of [
      ['dalsegno', 'segno', visit === 1],
      ['tocoda', 'coda', visit === 2],
    ] as const) {
      if (sound.hasAttribute(attribute) && applies(active)) {
        const destination = targets.get(`${target}:${sound.getAttribute(attribute)}`);

        if (destination === undefined) {
          throw new Error(`Missing ${target} target`);
        }

        index = destination;
        position = undefined;

        if (attribute === 'dalsegno') {
          returned = true;
        }
      }
    }
  }

  return played;
}
