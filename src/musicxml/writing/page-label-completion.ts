import { required } from '../planning/events.js';
import { sameMoments, rationalValue } from '../../model/time.js';
import { writeSystemNames } from '../text/names.js';
import { writeResolvedPageCredits } from '../layout/page-credits.js';
import { pageLayoutPlan } from '../layout/page-layout.js';
import { applyPagePrint } from '../layout/page-print.js';
import type { ScoreWritingContext } from '../context.js';
import { add } from '../primitives.js';
import type { WrittenScore } from './score.js';

export function completeScorePagesAndLabels(context: ScoreWritingContext, written: WrittenScore) {
  const { document, warn } = context;
  const { root, partList, layout } = written;
  const { anchors } = layout;
  const {
    sourceSystemBoundaries,
    pageStart,
    graceCursorSystems,
    sourceBoundaryBySystem,
    pageGrid,
    systemGeometry,
    layoutMoment,
    deferredNameUpdates,
    initialPageWarnings,
  } = layout;
  const { parts, partNames, staffLabels } = context.plan;
  const cursorSystems = new Set(
    sourceSystemBoundaries
      .filter((b) => parts.every((part) => anchors.hasSystemCursor(b.system, part)))
      .map((b) => b.system),
  );
  const capturedPages = Array.isArray(document.pageLayouts) ? document.pageLayouts : [];
  const existingSystems = new Set(
    capturedPages
      .filter((page) => page && pageStart(page.system) !== null)
      .map((page) => page.system),
  );
  const activeSystems = new Set([...existingSystems, ...cursorSystems]);

  if ([...graceCursorSystems].some((system) => !activeSystems.has(system))) {
    warn(
      'system-boundary-grace-cursor',
      'A source System start shares its main time with written grace material. No intra-measure print is anchored before a regular note or forward without proof of the actual grace-side cursor ownership.',
    );
  }

  if (
    sourceSystemBoundaries.some(
      (b) => cursorSystems.has(b.system) && !existingSystems.has(b.system),
    )
  ) {
    const supplemental = pageLayoutPlan(
      document,
      parts.flatMap((part) => part.staves),
      warn,
      {
        activeSystems,
        gridForSystem(staff, system) {
          const boundary = cursorSystems.has(system)
            ? sourceBoundaryBySystem.get(system)
            : undefined;
          const start =
            pageStart(system) ?? (boundary ? rationalValue(boundary.moment.main) : null);

          return start === null ? null : pageGrid(staff, start);
        },
      },
    );

    for (const system of activeSystems) {
      const boundary = cursorSystems.has(system) ? sourceBoundaryBySystem.get(system) : undefined;
      const start = pageStart(system),
        box = boundary?.box ?? (start !== null ? systemGeometry(start)?.box : null);
      const frame = supplemental.at(system);

      if (!box || (system === 1 && !frame)) {
        continue;
      }

      for (const part of parts) {
        const cursor = required(
          anchors.cursorFor(system, part),
          `serialization cursor for part ${part.id} in system ${system}`,
        );
        let print = cursor.print;

        if (!print) {
          const parent = cursor.node.up();

          print = add(parent, 'print');
          parent.node.insertBefore(print.node, cursor.node.node);
        }

        if (system > 1) {
          print.att('new-system', 'yes');
        }

        if (frame) {
          applyPagePrint(print, frame, box, part.staves, add);
        }

        const moment = boundary?.moment ?? (start !== null ? layoutMoment(start) : null);

        if (moment) {
          for (const state of writeSystemNames(
            document,
            partNames.get(part.id) ?? [],
            part.contextId,
            system,
            moment,
            print,
            add,
            warn,
          )) {
            deferredNameUpdates.delete(state);
          }

          const sourceBoundary = sourceBoundaryBySystem.get(system);
          const exactSystemStart =
            sourceBoundary !== undefined && sameMoments(sourceBoundary.moment, moment);

          for (const direction of staffLabels.writeAt(
            part,
            cursor.node.up(),
            system,
            moment,
            add,
            exactSystemStart,
          )) {
            cursor.node.node.parentNode!.insertBefore(direction.node, cursor.node.node);
          }
        }
      }
    }
  } else {
    for (const [code, message] of initialPageWarnings) {
      warn(code, message);
    }
  }

  staffLabels.finish();

  if (deferredNameUpdates.size) {
    warn(
      'instrument-name-system',
      'A final instrument-name style or text change starts inside a native measure. Its exact source state remains in metadata without moving that display change to another system boundary.',
    );
  }

  for (const page of Array.isArray(document.pageLayouts) ? document.pageLayouts : []) {
    if (page && !activeSystems.has(page.system)) {
      warn(
        'page-layout-boundary',
        'An actual source System has no proven shared native measure boundary or serialization cursor in every part. Its page geometry remains metadata without guessed note splitting or cursor excursions.',
      );
    }
  }

  const creditPageLayouts = pageLayoutPlan(
    document,
    parts.flatMap((part) => part.staves),
    warn,
    {
      activeSystems,
      gridForSystem(staff, system) {
        const start = pageStart(system);

        return start === null ? null : pageGrid(staff, start);
      },
    },
  );

  writeResolvedPageCredits(
    root,
    partList,
    document,
    [...activeSystems].flatMap((system) => {
      const frame = creditPageLayouts.at(system);

      return frame ? [frame] : [];
    }),
    add,
    warn,
  );
  anchors.finishLabels(warn);
}
