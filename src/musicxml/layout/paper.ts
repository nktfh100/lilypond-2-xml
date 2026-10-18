import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Add } from '../types.js';
import type { Warn } from '../../model/diagnostics.js';
import { required } from '../planning/events.js';
import type { PaperSettings } from '../../model/document.js';

const add: Add = (node, name, text, attrs = {}) => {
  const child = node.ele(name, attrs);

  if (text !== undefined) {
    child.txt(String(text));
  }

  return child;
};

export function writePaper(root: XMLBuilder, input: PaperSettings | undefined, warn: Warn) {
  if (!input) {
    return;
  }

  const paper = Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  );
  const staffSpace = paper['staff-space'];

  if (staffSpace === undefined || !(staffSpace > 0)) {
    return;
  }

  const factor = 10 / staffSpace;
  const convert = (n: number) => Math.round(n * factor * 1e9) / 1e9;
  const width = paper['paper-width'] ?? NaN;
  const height = paper['paper-height'] ?? NaN;

  if (!(width > 0) || !(height > 0)) {
    return;
  }

  const twoSided = input['two-sided'];
  const leftDefault =
    paper[twoSided ? 'outer-margin-default-scaled' : 'left-margin-default-scaled']!;
  const rightDefault =
    paper[twoSided ? 'inner-margin-default-scaled' : 'right-margin-default-scaled']!;
  const left = paper[twoSided ? 'outer-margin' : 'left-margin'];
  const right = paper[twoSided ? 'inner-margin' : 'right-margin'];
  const binding = twoSided ? paper['binding-offset'] || 0 : 0;
  let leftMargin, rightMargin, lineWidth;

  if (paper['line-width'] === undefined) {
    leftMargin = left ?? leftDefault;
    rightMargin = (right ?? rightDefault) + binding;
    lineWidth = width - leftMargin - rightMargin;
  } else {
    lineWidth = paper['line-width'];

    if (left === undefined && right === undefined) {
      leftMargin = rightMargin = (width - lineWidth) / 2;
    } else if (left === undefined) {
      rightMargin = required(right, 'paper.ts: right') + binding;
      leftMargin = width - lineWidth - rightMargin;
    } else {
      leftMargin = left;
      rightMargin = (right ?? width - lineWidth - leftMargin) + binding;
    }
  }

  if (
    input['check-consistency'] &&
    (Math.abs(width - lineWidth - leftMargin - rightMargin) > 1e-6 ||
      leftMargin < 0 ||
      rightMargin < 0)
  ) {
    leftMargin = leftDefault;
    rightMargin = rightDefault;
    warn(
      'paper-margins',
      'Inconsistent paper margins were replaced with LilyPond default margins.',
    );
  }

  const systemRight =
    paper['system-width'] === undefined
      ? 0
      : convert(
          width -
            leftMargin -
            rightMargin -
            required(paper['system-width'], 'paper.ts: paper["system-width"]'),
        );
  const defaults = add(root, 'defaults');
  const scaling = add(defaults, 'scaling');

  add(scaling, 'millimeters', staffSpace * 4);
  add(scaling, 'tenths', 40);
  const page = add(defaults, 'page-layout');

  add(page, 'page-height', convert(height));
  add(page, 'page-width', convert(width));
  const marginsByType: [string, number, number][] = twoSided
    ? [
        ['odd', rightMargin, leftMargin],
        ['even', leftMargin, rightMargin],
      ]
    : [['both', leftMargin, rightMargin]];

  for (const [type, l, r] of marginsByType) {
    const margins = add(page, 'page-margins', undefined, { type });

    add(margins, 'left-margin', convert(l));
    add(margins, 'right-margin', convert(r));
    add(
      margins,
      'top-margin',
      convert(required(paper['top-margin'], 'paper.ts: paper["top-margin"]')),
    );
    add(
      margins,
      'bottom-margin',
      convert(required(paper['bottom-margin'], 'paper.ts: paper["bottom-margin"]')),
    );
  }

  if (typeof paper['short-indent'] === 'number') {
    writeSystemMargins(add(defaults, 'system-layout'), convert(paper['short-indent']), systemRight);
  }

  return {
    indent: convert(paper.indent || 0),
    shortIndent: convert(paper['short-indent'] || 0),
    systemRight,
    page: {
      width: convert(width),
      height: convert(height),
      left: convert(twoSided ? rightMargin : leftMargin),
      right: convert(twoSided ? leftMargin : rightMargin),
      top: convert(required(paper['top-margin'], 'paper.ts: paper["top-margin"]')),
      bottom: convert(required(paper['bottom-margin'], 'paper.ts: paper["bottom-margin"]')),
    },
    point: convert(25.4 / 72),
  };
}

export function writeSystemMargins(system: XMLBuilder, left: number, right = 0) {
  const margins = add(system, 'system-margins');

  add(margins, 'left-margin', left.toFixed(9));
  add(margins, 'right-margin', right.toFixed(9));
}
