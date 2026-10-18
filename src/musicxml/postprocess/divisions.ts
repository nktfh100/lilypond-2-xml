import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Add } from '../types.js';
import { xmlElement } from '../primitives.js';
import { gcd } from '../../model/time.js';

const unitAttributes: Record<string, string[]> = {
  note: ['attack', 'release'],
  grace: ['make-time'],
  release: ['offset'],
  sound: ['divisions'],
  barline: ['divisions'],
};
const timingsAt = (node: XMLBuilder) =>
  (unitAttributes[node.node.nodeName] ?? [])
    .filter((name) => xmlElement(node).hasAttribute(name))
    .map((name) => ({ node, name }));
const hasUnits = (node: XMLBuilder) =>
  ['note', 'backup', 'forward'].includes(node.node.nodeName) ||
  timingsAt(node).length > 0 ||
  node.find(
    (child) => ['duration', 'offset'].includes(child.node.nodeName) || timingsAt(child).length > 0,
    false,
    true,
  ) !== undefined;

export function reduceMeasureDivisions(part: XMLBuilder, add: Add): void {
  const measures = part.filter((node) => node.node.nodeName === 'measure');

  if (
    measures.some((measure) => {
      const divisions = measure.filter((node) => node.node.nodeName === 'divisions', false, true);

      return (
        divisions.length > 1 ||
        divisions.some((node) => {
          const attributes = node.up().node;
          const children = measure.filter(() => true);

          return children
            .slice(
              0,
              children.findIndex((child) => child.node === attributes),
            )
            .some(hasUnits);
        })
      );
    })
  ) {
    return;
  }

  let originalDivisions = 1,
    previousDivisions = 0;

  for (const measure of measures) {
    let division = measure.find((node) => node.node.nodeName === 'divisions', false, true);
    let attributes = division?.up() ?? measure.find((node) => node.node.nodeName === 'attributes');
    const children = measure.filter(() => true);
    const firstUnit = children.findIndex(hasUnits);

    if (
      attributes &&
      firstUnit >= 0 &&
      children.findIndex((node) => node.node === attributes!.node) > firstUnit
    ) {
      attributes = undefined;
    }

    if (division) {
      originalDivisions = Number(division.node.textContent);
    }

    const values = measure.filter(
      (node) => ['duration', 'offset'].includes(node.node.nodeName),
      false,
      true,
    );
    const timings = measure.filter(() => true, false, true).flatMap(timingsAt);
    const numbers = [
      originalDivisions,
      ...values.map((node) => Number(node.node.textContent)),
      ...timings.map(({ node, name }) => Number(xmlElement(node).getAttribute(name))),
    ];
    const factor =
      originalDivisions > 0 && numbers.every(Number.isSafeInteger) ? numbers.reduce(gcd) : 1;
    const divisions = originalDivisions / factor;

    if (factor > 1) {
      for (const node of values) {
        node.node.textContent = String(Number(node.node.textContent) / factor);
      }

      for (const { node, name } of timings) {
        xmlElement(node).setAttribute(
          name,
          String(Number(xmlElement(node).getAttribute(name)) / factor),
        );
      }
    }

    if (divisions !== previousDivisions) {
      if (!attributes) {
        attributes = add(measure, 'attributes');
        const following = children.find(
          (node) => !['print', 'bookmark', 'link'].includes(node.node.nodeName),
        );

        if (following) {
          measure.node.insertBefore(attributes.node, following.node);
        }
      }

      if (!division) {
        division = add(attributes, 'divisions');
        attributes.node.insertBefore(division.node, attributes.node.firstChild);
      }

      division.node.textContent = String(divisions);
    } else if (division) {
      division.remove();
    }

    previousDivisions = divisions;
  }
}
