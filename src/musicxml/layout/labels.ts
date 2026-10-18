import type { Moment } from '@sightread/lilypond-eventdocument';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Warn } from '../../model/diagnostics.js';
import { sameMoments as sameMoment, isMoment as validMoment } from '../../model/time.js';
import type { ScoreDocument } from '../../model/document.js';

export interface LabelBookmarkPlan {
  readonly id: string;
  readonly name?: string;
  readonly sourceId: number;
  readonly context: number;
  readonly moment: Moment;
  readonly label: string;
}
export interface LabelNativeSibling {
  readonly node: XMLBuilder;
  readonly moment: Moment;
  /** True for any candidate at a terminal boundary; only a barline can qualify. */
  readonly terminal?: boolean;
}
const tokenUnchanged = (text: string) =>
  text.replace(/[\t\n\r ]+/g, ' ').replace(/^ | $/g, '') === text &&
  !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(text) &&
  !/[\uD800-\uDFFF]/u.test(text);

/** Labels are global column anchors, not note owners, rendered words or pages. */
export function labelPlans(document: ScoreDocument, warn: Warn): readonly LabelBookmarkPlan[] {
  const rows = document.events.filter((e) => e.kind === 'label');

  if (!document.labelsCaptured) {
    if (rows.length) {
      warn(
        'label-history',
        'This document lacks actual command-column label capture. No bookmark is inferred from text, notes or page references.',
      );
    }

    return [];
  }

  const plans: LabelBookmarkPlan[] = [];
  const names = new Map<string, number>();

  for (const row of rows) {
    if (Array.isArray(row.names)) {
      for (const name of row.names) {
        if (typeof name === 'string') {
          names.set(name, (names.get(name) ?? 0) + 1);
        }
      }
    }
  }

  if ([...names.values()].some((count) => count > 1)) {
    warn(
      'label-duplicate',
      'Repeated source label names retain separate unique bookmark IDs. No incoming link or page reference is resolved to an arbitrary occurrence.',
    );
  }

  for (const row of rows) {
    if (
      !Number.isSafeInteger(row.id) ||
      row.id <= 0 ||
      !Array.isArray(row.names) ||
      !row.names.length ||
      row.names.some((name) => typeof name !== 'string') ||
      rows.filter((e) => e.context === row.context && e.id === row.id).length !== 1
    ) {
      warn(
        'label-data',
        'A label anchor has invalid identity, names or duplicate captured column rows. No bookmark is manufactured from incomplete source data.',
      );
      continue;
    }

    const contexts = document.contexts.filter((c) => c.id === row.context);

    if (contexts.length !== 1 || contexts[0]!.type !== 'Score') {
      warn(
        'label-context',
        'A source label lacks its unique actual Score context. No global bookmark ownership is guessed from an available part or staff.',
      );
      continue;
    }

    if (
      !validMoment(row.moment) ||
      !validMoment(row.columnMoment) ||
      !sameMoment(row.moment, row.columnMoment)
    ) {
      warn(
        'label-column',
        "A label's actual command-column Moment is missing or differs from the observed Score timestep. No native point is selected from a nearby note.",
      );
      continue;
    }

    if (!validMoment(row.observedMoment)) {
      warn(
        'label-column',
        'A label lacks its actual last observed Score timestep. The original column metadata is retained without guessing missing provenance.',
      );
      continue;
    }

    if (!sameMoment(row.observedMoment, row.columnMoment)) {
      warn(
        'label-timing',
        "A label's finalized command-column Moment differs from its last observed Score timestep. The actual final column anchor is retained, without treating the source command or a nearby note as its owner.",
      );
    }

    row.names.forEach((label, index) => {
      const name = tokenUnchanged(label) ? label : undefined;

      if (name === undefined) {
        warn(
          'label-name',
          'A source label cannot be written unchanged as a MusicXML token name. Its original symbol remains in metadata and a generated bookmark ID carries the native anchor.',
        );
      }

      plans.push({
        id: `lp-label-${row.context}-${row.id}-${index + 1}`,
        ...(name !== undefined ? { name } : {}),
        sourceId: row.id,
        context: row.context,
        moment: row.moment,
        label,
      });
    });
  }

  return plans;
}

/** Insert before an exact registered sibling: bookmark has no independent offset. */
export function insertLabelBookmarks(
  plans: readonly LabelBookmarkPlan[],
  siblings: readonly LabelNativeSibling[],
  warn: Warn,
): void {
  const allowed = new Set([
    'note',
    'direction',
    'attributes',
    'forward',
    'barline',
    'harmony',
    'sound',
    'figured-bass',
  ]);
  const candidates = siblings.filter((s) => {
    const node = s.node.node;

    return (
      validMoment(s.moment) &&
      node.nodeType === 1 &&
      allowed.has(node.nodeName) &&
      node.parentNode?.nodeName === 'measure' &&
      (!s.terminal || node.nodeName === 'barline')
    );
  });
  const used = new Set<string>();
  const documents = new Set(candidates.map((s) => s.node.node.ownerDocument));

  for (const doc of documents) {
    if (!doc) {
      continue;
    }

    for (const node of Array.from(doc.getElementsByTagName('*'))) {
      const id = node?.getAttribute('id');

      if (id) {
        used.add(id);
      }
    }
  }

  for (const plan of plans) {
    const target = candidates.find((s) => sameMoment(s.moment, plan.moment));

    if (!target) {
      warn(
        'label-anchor',
        'A source label has no registered native sibling at its exact full Moment. Its name remains in metadata; no nearest note, invented terminal element or offset bookmark is used.',
      );
      continue;
    }

    const node = target.node.node,
      doc = node.ownerDocument;

    if (!doc || !node.parentNode) {
      continue;
    }

    let id = plan.id,
      suffix = 2;

    while (used.has(id)) {
      id = `${plan.id}-${suffix++}`;
    }

    used.add(id);
    const bookmark = doc.createElement('bookmark');

    bookmark.setAttribute('id', id);

    if (plan.name !== undefined) {
      bookmark.setAttribute('name', plan.name);
    }

    node.parentNode.insertBefore(bookmark, node);
    warn(
      'label-page',
      'Source label names and native document anchors are retained; resolved source pages, page-reference text and cross-score or external links are not inferred.',
    );
  }
}
