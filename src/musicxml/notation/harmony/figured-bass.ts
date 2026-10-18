import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import { sameAttributes } from '../../primitives.js';
import { isTransparentColor, musicXMLColor } from '../colors.js';
import type { FigurePositionAttributes } from './figured-bass-position.js';
import type { Add, Attributes } from '../../types.js';
import type { DurationValue, FigureGroup, NoteLike, Tick, Time } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { isMoment, momentKey, rationalValue } from '../../../model/time.js';
import { resolveFigureDisplay } from './figured-bass-display.js';

const alterationNames = new Map([
  [-2, 'flat-flat'],
  [-1, 'flat'],
  [0, 'natural'],
  [1, 'sharp'],
  [2, 'double-sharp'],
]);

export interface FigureExtension {
  type: string;
  attrs: Attributes;
  hidden: boolean;
}

export function figureExtensions(
  groups: FigureGroup[],
  time: Time,
  warn: Warn,
  semanticGroups: FigureGroup[] = groups,
) {
  const byId = new Map(
    groups.flatMap((group) => group.figures.map((figure) => [figure.id, { group, figure }])),
  );
  const semanticById = new Map(
    semanticGroups.flatMap((group) =>
      group.figures.map((figure) => [figure.id, { group, figure }]),
    ),
  );
  const extensions = new Map<number, FigureExtension>();

  for (const group of semanticGroups) {
    for (const figure of group.figures) {
      if (figure.extendTo === null) {
        continue;
      }

      const start = byId.get(figure.id);
      const endpoint = byId.get(figure.extendTo);
      const semanticEndpoint = semanticById.get(figure.extendTo);

      if (
        !start ||
        !endpoint ||
        !semanticEndpoint ||
        figure.row === null ||
        start.figure.row !== figure.row ||
        endpoint.figure.row !== figure.row ||
        start.group.context !== group.context ||
        endpoint.group.context !== group.context ||
        semanticEndpoint.figure.row !== figure.row ||
        semanticEndpoint.group.context !== group.context ||
        ![group, semanticEndpoint.group, start.group, endpoint.group].every((g) =>
          Number.isFinite(time(g)),
        ) ||
        time(semanticEndpoint.group) < time(group) - 1e-10 ||
        time(endpoint.group) < time(start.group) - 1e-10
      ) {
        warn(
          'figured-bass-extend',
          'A figured-bass continuation has unresolved or reversed endpoints or row ownership.',
        );
        continue;
      }

      const line = figure.continuation;
      const color = musicXMLColor(line?.color ?? null);
      const hidden = line?.hidden === true || isTransparentColor(color);
      const attrs: Attributes = {
        color: hidden ? '#00000000' : color,
        ...(line?.offset[0] ? { 'relative-x': line.offset[0] * 10 } : {}),
        ...(line?.offset[1] ? { 'relative-y': line.offset[1] * 10 } : {}),
      };

      if (!line) {
        warn(
          'figured-bass-line-history',
          'This cached continuation lacks captured line appearance. Native endpoints remain without verified color, visibility or offsets.',
        );
      }

      if (line?.custom) {
        warn(
          'figured-bass-line-stencil',
          'A custom figured-bass continuation drawing has no mapped native equivalent; available endpoints, color, visibility and offsets are retained.',
        );
      }

      if (line) {
        warn(
          'figured-bass-line-layout',
          `Native continuation color, visibility and extra-offset are retained. Exact fitted endpoints, padding and thickness (${line.thickness}) are not mapped. Source style ${line.style} uses a standard straight native extension.`,
        );
      }

      for (const member of semanticGroups.filter(
        (g) =>
          g.context === group.context &&
          time(g) >= time(group) &&
          time(g) <= time(semanticEndpoint.group),
      )) {
        const row = member.figures.find((f) => f.row === figure.row);

        if (row) {
          const realized = byId.get(row.id);

          if (
            !realized ||
            realized.figure.row !== figure.row ||
            realized.group.context !== group.context ||
            !Number.isFinite(time(realized.group)) ||
            time(realized.group) < time(start.group) - 1e-10 ||
            time(realized.group) > time(endpoint.group) + 1e-10
          ) {
            warn(
              'figured-bass-extend',
              'A semantic continuation member has no matching realized row between its actual endpoints. Available endpoint flags remain; the unresolved member is omitted without assigning the line to unrelated figures.',
            );
            continue;
          }

          const type =
            row.id === figure.id ? 'start' : row.id === endpoint.figure.id ? 'stop' : 'continue';
          const previous = extensions.get(row.id);

          if (
            previous &&
            ((previous.type === 'stop' && type === 'start') ||
              (previous.type === 'start' && type === 'stop'))
          ) {
            if (!sameAttributes(previous.attrs, attrs)) {
              warn(
                'figured-bass-line-junction',
                'Adjacent continuation lines change appearance at one figure. MusicXML has one extend field there; the outgoing appearance is retained at the shared continuation point.',
              );
            }

            extensions.set(row.id, {
              ...(type === 'start' ? { attrs, hidden } : previous),
              type: 'continue',
            });
          } else {
            extensions.set(row.id, { type, attrs, hidden });
          }
        }
      }
    }
  }

  return extensions;
}

/** Use resolved columns for notation, leaving semantic events and playback intact. */
export function positionFigures(
  groups: FigureGroup[],
  notes: NoteLike[],
  finish: number,
  time: Time,
  grace: Time,
  warn: Warn,
): FigureGroup[] {
  const begin = Math.min(0, ...notes.map(time), ...groups.map(time));

  return groups.flatMap((group) => {
    if (!group.figures.length) {
      return [group];
    }

    const columns = new Map<string, FigureGroup>();

    for (const figure of group.figures) {
      let moment = figure.columnUsed === false ? group.moment : (figure.column ?? group.moment);
      const at = time({ moment });
      const valid = isMoment(moment);

      if (!valid || !Number.isFinite(at) || at < begin - 1e-10 || at > finish + 1e-10) {
        warn(
          'figured-bass-column-range',
          'A figure column is invalid or lies outside the source score timeline. Its native figure remains at the semantic event time without extending playback.',
        );
        moment = group.moment;
      }

      if (grace({ moment })) {
        warn(
          'figured-bass-grace',
          'A figured-bass column belongs to a grace position. Native figured bass uses the regular-note main onset; its exact grace-note attachment has no MusicXML anchor.',
        );
      }

      if (Math.abs(time({ moment }) - time(group)) > 1e-10) {
        warn(
          'figured-bass-column-timing',
          'Native figured bass uses the resolved printed column. The original semantic onset and duration remain in metadata because the printed and semantic intervals differ.',
        );
      }

      const key = momentKey(moment);
      const column = columns.get(key);

      if (column) {
        columns.set(key, { ...column, figures: [...column.figures, figure] });
      } else {
        columns.set(key, { ...group, moment, figures: [figure] });
      }
    }

    return [...columns.values()];
  });
}

export function anchorFigures(
  groups: FigureGroup[],
  notes: NoteLike[],
  time: Time,
  grace: Time,
  duration: DurationValue,
  warn: Warn,
) {
  const anchors = new Map<NoteLike, FigureGroup[]>();

  for (const group of groups) {
    let anchor = notes
      .filter(
        (n) =>
          n.staff === group.staff &&
          n.kind !== 'skip' &&
          !grace(n) &&
          time(n) <= time(group) + 1e-10 &&
          time(n) + (n.segmentDuration ?? duration(n.duration)) > time(group) + 1e-10,
      )
      .sort((a, b) => time(b) - time(a))[0];

    if (!anchor) {
      anchor = notes
        .filter(
          (n) =>
            n.staff === group.staff &&
            n.kind !== 'skip' &&
            !grace(n) &&
            Math.abs(time(n) + (n.segmentDuration ?? duration(n.duration)) - time(group)) < 1e-10,
        )
        .sort((a, b) => time(b) - time(a))[0];
    }

    if (!anchor) {
      warn(
        'figured-bass-anchor',
        'A figured-bass group could not be associated with a regular note or rest.',
      );
      continue;
    }

    const cluster = anchors.get(anchor) || [];

    cluster.push(group);
    anchors.set(anchor, cluster);
  }

  for (const cluster of anchors.values()) {
    cluster.sort((a, b) => time(a) - time(b));
  }

  return anchors;
}

export interface FigureWritingOptions {
  at: number;
  finish: number;
  extensions: Map<number, FigureExtension>;
  timing: { time: Time; duration: DurationValue; tick: Tick };
  output: {
    add: Add;
    warn: Warn;
    onNative?: (node: XMLBuilder, moment: FigureGroup['moment']) => void;
  };
  positionForGroup?: (group: FigureGroup) => FigurePositionAttributes | null;
}

export function writeFigures(
  parent: XMLBuilder,
  cluster: readonly FigureGroup[] | undefined,
  options: FigureWritingOptions,
) {
  const { at, finish, extensions, positionForGroup } = options;
  const { time, duration, tick } = options.timing;
  const { add, warn, onNative } = options.output;

  if (!cluster?.some((g) => g.figures.length)) {
    return;
  }

  let cursor = at;
  const blank = (length: number) => {
    const group = add(parent, 'figured-bass');

    add(group, 'figure');
    add(group, 'duration', tick(length));
  };

  if (
    new Set(cluster.map((g) => g.context)).size > 1 ||
    cluster.some((g, i) =>
      cluster.slice(0, i).some((other) => Math.abs(time(other) - time(g)) < 1e-10),
    )
  ) {
    warn(
      'figured-bass-context',
      'Simultaneous figured-bass groups retain their figures and native onsets; independent column geometry requires further mapping.',
    );
  }

  for (const [index, group] of cluster.entries()) {
    const next = cluster[index + 1];
    const length = Math.max(
      0,
      Math.min(
        duration(group.duration),
        next ? time(next) - time(group) : Infinity,
        finish - time(group),
      ),
    );

    if (tick(length) < tick(duration(group.duration))) {
      warn(
        'figured-bass-column-timing',
        'A native figure duration is shortened or omitted to reach the next printed column or source score end. The original semantic duration remains in metadata.',
      );
    }

    if (time(group) > cursor + 1e-10) {
      blank(time(group) - cursor);
    }

    if (!group.figures.length) {
      if (tick(length) > 0) {
        blank(length);
      }

      cursor = time(group) + length;
      continue;
    }

    const presentation = new Map(
      group.figures.map((figure) => [figure.id, resolveFigureDisplay(figure, group.custom, warn)]),
    );
    const resolvedPosition = positionForGroup?.(group) ?? null;
    const suppressed = group.figures.every(
      (f) =>
        presentation.get(f.id)!.invisible &&
        (!extensions.has(f.id) || extensions.get(f.id)!.hidden),
    );
    const node = add(parent, 'figured-bass', undefined, {
      ...(resolvedPosition?.group ?? {}),
      ...(group.direction ? { placement: group.direction > 0 ? 'above' : 'below' } : {}),
      ...(suppressed ? { 'print-object': 'no' } : {}),
    });

    onNative?.(node, group.moment);

    for (const figure of [...group.figures].sort(
      (a, b) => (a.row ?? Infinity) - (b.row ?? Infinity),
    )) {
      const f = add(node, 'figure');
      const extension = extensions.get(figure.id);
      const display = presentation.get(figure.id)!;
      const { base } = display;
      const componentAttrs = resolvedPosition?.components?.get(figure.id);
      const visibleGraphic =
        figure.graphic !== false && figure.column !== null && figure.columnUsed !== false;
      const hiddenText = figure.hidden || !visibleGraphic;
      const hidden = hiddenText && !extension ? { color: '#00000000' } : {};
      const attrs = { ...base, ...hidden };
      const prefixes: string[] = [],
        suffixes: string[] = [];
      const symbol = (value: string, direction: number) =>
        (direction > 0 ? suffixes : prefixes).push(value);

      if (display.mode !== 'formatted-text' && figure.alteration !== null) {
        const alteration = rationalValue(figure.alteration) * 2;
        const name = alterationNames.get(alteration);

        if (name) {
          symbol(name, group.alterationDirection);
        } else {
          warn(
            'figured-bass-alteration',
            `Unmapped figured-bass alteration: ${alteration} semitones.`,
          );
        }
      }

      if (display.mode !== 'formatted-text' && figure.augmented) {
        symbol('plus', group.plusDirection);
      }

      if (display.mode !== 'formatted-text' && figure.diminished) {
        suffixes.push('slash');
      }

      if (display.mode !== 'formatted-text' && figure.augmentedSlash) {
        suffixes.push('back-slash');
      }

      if (visibleGraphic && (prefixes.length > 1 || suffixes.length > 1)) {
        warn(
          'figured-bass-symbol',
          'Combined figured-bass modifiers retain their names in one native prefix or suffix; their combined glyph requires further mapping.',
        );
      }

      if (!hiddenText || !extension) {
        if (prefixes.length) {
          add(f, 'prefix', prefixes.join(' '), {
            ...attrs,
            ...(componentAttrs?.prefix ?? {}),
          });
        }

        if (figure.number !== null || display.mode !== 'semantic-number') {
          add(
            f,
            'figure-number',
            display.mode !== 'semantic-number'
              ? display.runs.map((run) => run.text).join('')
              : figure.number,
            {
              ...(display.mode !== 'semantic-number' ? display.textAttrs : base),
              ...hidden,
              ...(componentAttrs?.number ?? resolvedPosition?.figures.get(figure.id) ?? {}),
            },
          );
        }

        if (suffixes.length) {
          add(f, 'suffix', suffixes.join(' '), {
            ...attrs,
            ...(componentAttrs?.suffix ?? {}),
          });
        }
      }

      if (extension) {
        add(f, 'extend', undefined, {
          type: extension.type,
          ...extension.attrs,
        });
      }

      if (
        visibleGraphic &&
        (figure.bracketStart ||
          figure.bracketStop ||
          (display.mode !== 'formatted-text' && figure.alterationBracket))
      ) {
        warn(
          'figured-bass-bracket',
          'Figured-bass brackets have no equivalent per-figure bracket field in MusicXML; figure numbers and modifiers are retained.',
        );
      }
    }

    if (tick(length) > 0) {
      add(node, 'duration', tick(length));
    }

    cursor = time(group) + length;
  }
}
