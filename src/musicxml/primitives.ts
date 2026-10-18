import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Element, Node } from '@oozcitak/dom/lib/dom/interfaces.js';
import type { Add, Attributes } from './types.js';

export const sameAttributes = (a: Attributes, b: Attributes): boolean =>
  Object.entries(a).every(([key, value]) => b[key] === value) &&
  Object.entries(b).every(([key, value]) => a[key] === value);

export const isXmlElement = (node: Node | null | undefined): node is Element =>
  node?.nodeType === 1;

export function xmlElement(builder: XMLBuilder): Element {
  const node = builder.node;

  if (!isXmlElement(node)) {
    throw new Error('Expected an XML element');
  }

  return node;
}

export function xmlNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error('Non-finite MusicXML numeric value');
  }

  const raw = String(value);

  if (!/[eE]/.test(raw)) {
    return raw;
  }

  const [mantissa = '', exponent = '0'] = raw.split(/[eE]/);
  const sign = mantissa.startsWith('-') ? '-' : '';
  const unsigned = mantissa.replace(/^-/, '');
  const [integer = '', fraction = ''] = unsigned.split('.');
  const digits = integer + fraction;
  const position = integer.length + Number(exponent);

  if (position <= 0) {
    return sign + '0.' + '0'.repeat(-position) + digits;
  }

  if (position >= digits.length) {
    return sign + digits + '0'.repeat(position - digits.length);
  }

  return sign + digits.slice(0, position) + '.' + digits.slice(position);
}

export const add: Add = (parent, name, text, attrs = {}) => {
  const node = parent.ele(
    name,
    Object.fromEntries(
      Object.entries(attrs).map(([key, value]) => [
        key,
        typeof value === 'number' ? xmlNumber(value) : value,
      ]),
    ),
  );

  if (text !== undefined) {
    node.txt(typeof text === 'number' ? xmlNumber(text) : String(text));
  }

  return node;
};

export const availableSpanNumber = (numbers: number[]) => {
  const result = Array.from({ length: 16 }, (_, i) => i + 1).find((n) => !numbers.includes(n));

  if (!result) {
    throw new Error(
      'More than 16 overlapping spans of the same type cannot be represented by MusicXML',
    );
  }

  return result;
};

export const placement = (e: { direction?: number | null }) =>
  e.direction ? { placement: e.direction === 1 ? 'above' : 'below' } : {};

export const steps = 'CDEFGAB';
