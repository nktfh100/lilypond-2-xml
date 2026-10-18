import type { Warn } from '../../model/diagnostics.js';
import { compareRational, isMoment, momentKey } from '../../model/time.js';
import type {
  FormattedAttachment,
  MeasureLayoutEvent,
  ScoreDocument,
  TextColumnPositionEvent,
} from '../../model/document.js';

export interface TextColumnLineAttributes {
  readonly 'default-x': number;
  readonly 'default-y': number;
  readonly text: string;
}
export interface TextColumnPlan {
  readonly lines: readonly TextColumnLineAttributes[];
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

type SourceText = {
  id: number;
  text: string;
  context: number | undefined;
  staff: number | undefined;
  moment: unknown;
};
const contextId = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;

function attachments(events: ScoreDocument['events']): SourceText[] {
  const found: SourceText[] = [];
  const visit = (
    event: ScoreDocument['events'][number] | FormattedAttachment,
    inherited?: {
      context: number | undefined;
      staff: number | undefined;
      moment: unknown;
    },
  ) => {
    const context =
      contextId('context' in event ? event.context : undefined) ??
      contextId('voice' in event ? event.voice : undefined) ??
      inherited?.context;
    const staff = contextId('staff' in event ? event.staff : undefined) ?? inherited?.staff;
    const sourceMoment = ('moment' in event ? event.moment : undefined) ?? inherited?.moment;
    const id = 'textColumnId' in event ? event.textColumnId : undefined;

    if (
      typeof id === 'number' &&
      Number.isSafeInteger(id) &&
      id > 0 &&
      'class' in event &&
      event.class === 'text-script-event'
    ) {
      found.push({
        id,
        text: event.text,
        context,
        staff,
        moment: sourceMoment,
      });
    }

    if ('attachments' in event) {
      for (const attachment of event.attachments ?? []) {
        if (attachment.class !== 'ignored') {
          visit(attachment, { context, staff, moment: sourceMoment });
        }
      }
    }
  };

  for (const event of events) {
    visit(event);
  }

  return found;
}

/** Plans line-level Words only when the exact attachment and final measure owner are unique. */
export function textColumnPositionPlans(
  document: ScoreDocument,
  warn: Warn,
): ReadonlyMap<number, TextColumnPlan> {
  const sidecars = document.events.filter(
    (e): e is TextColumnPositionEvent => e.kind === 'textColumnPosition',
  );
  const source = attachments(document.events);

  if (!sidecars.length) {
    if (source.length) {
      warn(
        'text-column-position',
        'A TextScript attachment has no final line-position record. Its original flattened text is retained without guessed per-line coordinates.',
      );
    }

    return new Map();
  }

  const sourceById = new Map<number, SourceText[]>();

  for (const row of source) {
    const rows = sourceById.get(row.id) ?? [];

    rows.push(row);
    sourceById.set(row.id, rows);
  }

  const sidecarCounts = new Map<number, number>();

  for (const row of sidecars) {
    sidecarCounts.set(row.id, (sidecarCounts.get(row.id) ?? 0) + 1);
  }

  const layouts = document.events.filter(
    (e): e is MeasureLayoutEvent => e.kind === 'measureLayout',
  );
  const result = new Map<number, TextColumnPlan>();
  const fail = () =>
    warn(
      'text-column-position',
      'A TextScript line-position record lacks unique attachment, scale, staff, System, full-Moment, or measure ownership. Its original flattened text is retained without guessed per-line coordinates.',
    );

  for (const sidecar of sidecars) {
    const matches = sourceById.get(sidecar.id);

    if (sidecarCounts.get(sidecar.id) !== 1 || matches?.length !== 1) {
      fail();
      continue;
    }

    const sourceEvent = matches[0]!;
    const moment = sourceEvent.moment;
    const sideMoment = momentKey(sidecar.moment),
      eventMoment = momentKey(moment);

    if (
      !isMoment(moment) ||
      sidecar.units !== 'system-left/staff-top-global-tenths' ||
      sidecar.id < 1 ||
      !Number.isSafeInteger(sidecar.context) ||
      sidecar.context !== sourceEvent.context ||
      !Number.isSafeInteger(sidecar.staffContext) ||
      sidecar.staffContext < 1 ||
      sourceEvent.staff !== sidecar.staffContext ||
      !Number.isSafeInteger(sidecar.system) ||
      sidecar.system < 1 ||
      sidecar.momentValid === false ||
      sideMoment === null ||
      sideMoment !== eventMoment ||
      !finite(sidecar.systemLeftOriginXTenths) ||
      !finite(sidecar.outputScale) ||
      sidecar.outputScale <= 0 ||
      !finite(sidecar.globalLayoutStaffSpace) ||
      sidecar.globalLayoutStaffSpace <= 0 ||
      !finite(sidecar.globalStaffSpaceMm) ||
      sidecar.globalStaffSpaceMm <= 0 ||
      !finite(document.paper?.['staff-space']) ||
      Math.abs(document.paper['staff-space'] - sidecar.globalStaffSpaceMm) > 1e-6 ||
      Math.abs(sidecar.outputScale * sidecar.globalLayoutStaffSpace - sidecar.globalStaffSpaceMm) >
        1e-6 ||
      !Array.isArray(sidecar.lines) ||
      sidecar.lines.length === 0 ||
      !document.measureLayoutsCaptured ||
      document.events.some((e) => e.kind === 'finalLayout' && e.status === 'failed')
    ) {
      fail();
      continue;
    }

    const owners = layouts.filter(
      (row) =>
        row.staff === sidecar.staffContext &&
        row.system === sidecar.system &&
        momentKey(row.moment) !== null &&
        momentKey(row.endMoment) !== null &&
        compareRational(row.moment.main, moment.main) <= 0 &&
        compareRational(moment.main, row.endMoment.main) < 0 &&
        moment.grace.numerator === 0 &&
        row.moment.grace.numerator === 0 &&
        row.endMoment.grace.numerator === 0 &&
        finite(row.startXTenths) &&
        finite(row.endXTenths) &&
        finite(row.systemLeftXTenths) &&
        Math.abs(row.systemLeftXTenths - sidecar.systemLeftOriginXTenths) <= 1e-5,
    );

    if (owners.length !== 1 || moment.grace.numerator !== 0) {
      fail();
      continue;
    }

    const measure = owners[0]!;
    const lines: TextColumnLineAttributes[] = [];
    let valid = true;

    for (let i = 0; i < sidecar.lines.length; i++) {
      const line = sidecar.lines[i]!;
      const x =
        sidecar.systemLeftOriginXTenths + line.systemLeftRelativeXTenths - measure.startXTenths!;

      if (
        line.index !== i ||
        typeof line.text !== 'string' ||
        !line.text.length ||
        !finite(line.systemLeftRelativeXTenths) ||
        !finite(line.staffTopYTenths) ||
        !finite(x) ||
        !finite(line.staffTopYTenths)
      ) {
        valid = false;
        break;
      }

      lines.push({
        text: line.text,
        'default-x': x,
        'default-y': line.staffTopYTenths,
      });
    }

    if (
      !valid ||
      (typeof sourceEvent.text === 'string' &&
        lines.map((line) => line.text).join(' ') !== sourceEvent.text)
    ) {
      fail();
      continue;
    }

    result.set(sidecar.id, { lines });
  }

  return result;
}
