import type { Moment } from '@sightread/lilypond-eventdocument';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Warn } from '../../model/diagnostics.js';
import {
  insertLabelBookmarks,
  type LabelNativeSibling,
  type labelPlans,
} from '../layout/labels.js';
import { rationalValue } from '../../model/time.js';
import type { Part } from '../planning/parts.js';

export interface SystemCursor {
  node: XMLBuilder;
  print: XMLBuilder | undefined;
}

/** Owns all references that must survive replacement of generated native nodes. */
export function createNativeAnchors(labels: ReturnType<typeof labelPlans>, finish: number) {
  const labelSiblings: LabelNativeSibling[] = [];
  const unanchoredBarlines = new Set<XMLBuilder['node']>();
  const systemCursors = new Map<number, Map<Part, SystemCursor>>();
  const pageCursors = new Map<number, Map<Part, SystemCursor>>();
  const registerLabelSibling = (node: XMLBuilder, moment: Moment) => {
    if (!labels.length || (moment.grace.numerator !== 0 && node.node.nodeName !== 'note')) {
      return;
    }

    labelSiblings.push({
      node,
      moment,
      ...(rationalValue(moment.main) === finish && moment.grace.numerator === 0
        ? { terminal: true }
        : {}),
    });
  };
  const registerSystem = (
    system: number,
    part: Part,
    node: XMLBuilder,
    print: XMLBuilder | undefined,
  ) => {
    const cursors = systemCursors.get(system) ?? new Map<Part, SystemCursor>();

    if (!cursors.has(part)) {
      cursors.set(part, { node, print });
    }

    systemCursors.set(system, cursors);
  };
  const registerPage = (
    system: number,
    part: Part,
    node: XMLBuilder,
    print: XMLBuilder | undefined,
  ) => {
    const cursors = pageCursors.get(system) ?? new Map<Part, SystemCursor>();

    cursors.set(part, { node, print });
    pageCursors.set(system, cursors);
  };
  const replaceNode = (from: XMLBuilder, to: XMLBuilder) => {
    for (const [index, sibling] of labelSiblings.entries()) {
      if (sibling.node.node === from.node) {
        labelSiblings[index] = { ...sibling, node: to };
      }
    }

    for (const collection of [systemCursors, pageCursors]) {
      for (const cursors of collection.values()) {
        for (const cursor of cursors.values()) {
          if (cursor.node.node === from.node) {
            cursor.node = to;
          }

          if (cursor.print?.node === from.node) {
            cursor.print = to;
          }
        }
      }
    }
  };

  return {
    registerLabelSibling,
    registerSystem,
    registerPage,
    replaceNode,
    excludeBarline(node: XMLBuilder['node']) {
      unanchoredBarlines.add(node);
    },
    needsBarlineLabel(node: XMLBuilder['node']) {
      return (
        !unanchoredBarlines.has(node) &&
        !labelSiblings.some((sibling) => sibling.node.node === node)
      );
    },
    hasSystemCursor(system: number, part: Part) {
      return systemCursors.get(system)?.has(part) === true;
    },
    cursorFor(system: number, part: Part) {
      return systemCursors.get(system)?.get(part) ?? pageCursors.get(system)?.get(part);
    },
    finishLabels(warn: Warn) {
      insertLabelBookmarks(labels, labelSiblings, warn);
    },
  };
}

export type NativeAnchors = ReturnType<typeof createNativeAnchors>;
