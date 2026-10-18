import assert from 'node:assert/strict';
import { test } from 'node:test';
import { positionFigures } from '../../../src/musicxml/notation/harmony/figured-bass.js';
import { eventTime, eventGraceTime } from '../../../src/model/time.js';
import { planFiguredBassPosition } from '../../../src/musicxml/notation/harmony/figured-bass-position.js';
import type { FigureGroup } from '../../../src/musicxml/planning/events.js';
import type { FigureGraphicPosition, MeasureLayoutEvent } from '../../../src/model/document.js';

type Moment = FigureGroup['moment'];
const moment = (n: number): Moment => ({
  main: { numerator: n, denominator: 1 },
  grace: { numerator: 0, denominator: 1 },
});
const position = (x: number, y: number, main: number): FigureGraphicPosition => ({
  units: 'layout-staff-space-tenths',
  system: 1,
  staffContext: 7,
  columnMoment: moment(main),
  columnUsed: true,
  systemXTenths: x,
  columnXTenths: x,
  itemColumnXTenths: 0,
  systemYTenths: y,
  staffTopSystemYTenths: 0,
  yTenths: y,
  stencilXExtentTenths: [-2, 2],
  stencilYExtentTenths: [-3, 1],
  layoutStaffSpace: 1,
  localStaffSpace: 1,
  outputScale: 1.7572990175729903,
  stencilLive: true,
});
const group = (positions: readonly (FigureGraphicPosition | null)[]): FigureGroup => ({
  kind: 'figuredBass',
  context: 8,
  staff: 7,
  direction: -1,
  duration: { log: 1, dots: 0, scale: { numerator: 1, denominator: 1 } },
  skip: false,
  alterationDirection: -1,
  plusDirection: 1,
  custom: false,
  moment: moment(0),
  figures: positions.map((graphicPosition, i) => ({
    id: i + 1,
    number: i === 0 ? 6 : 4,
    alteration: null,
    augmented: false,
    diminished: false,
    augmentedSlash: false,
    bracketStart: false,
    bracketStop: false,
    alterationBracket: false,
    noContinuation: false,
    text: null,
    markup: null,
    row: i,
    hidden: false,
    implicit: false,
    extendTo: null,
    graphic: true,
    column: moment(0),
    columnUsed: true,
    custom: false,
    display: {
      command: 'fontsize-markup',
      args: [
        -5,
        {
          command: 'number-markup',
          args: [String(i === 0 ? 6 : 4)],
          plain: String(i === 0 ? 6 : 4),
        },
      ],
      plain: String(i === 0 ? 6 : 4),
    },
    graphicPosition,
  })),
});
const layout: MeasureLayoutEvent = {
  kind: 'measureLayout',
  id: 1,
  piece: 1,
  staff: 7,
  system: 1,
  moment: moment(0),
  endMoment: moment(1),
  columnMoment: moment(0),
  endColumnMoment: moment(1),
  startXTenths: 85,
  endXTenths: 235,
  widthTenths: 150,
  lineWidthTenths: 1024,
  systemLeftXTenths: 85,
  systemRightXTenths: 235,
  layoutStaffSpace: 1,
  firstOnSystem: true,
  lastOnSystem: true,
  startKind: 'measure',
  endKind: 'measure',
};
const plan = (
  input: FigureGroup,
  layouts: readonly MeasureLayoutEvent[] = [layout],
  space = 1.7572990175729903,
) => {
  const warnings: string[] = [];
  const result = planFiguredBassPosition(
    input,
    moment(0),
    moment(1),
    layouts,
    space,
    true,
    (code) => {
      warnings.push(code);
    },
  );

  return { result, warnings };
};

test('figured-bass source positions project each simple numeric row in global measure/staff coordinates', () => {
  const { result, warnings } = plan(
    group([position(172.392, -56.725, 0), position(172.392, -71.725, 0)]),
  );

  assert.deepEqual(result?.group, { 'default-x': 0 });
  assert.deepEqual(result?.figures.get(1), {
    'default-x': 87.392,
    'default-y': -56.725,
  });
  assert.deepEqual(result?.figures.get(2), {
    'default-x': 87.392,
    'default-y': -71.725,
  });
  assert.deepEqual(warnings, []);
});

test('figured-bass projection fails closed for missing, duplicate, malformed, or mismatched ownership', () => {
  for (const [candidate, layouts, space] of [
    [group([position(172.392, -56.725, 0), null]), [layout], 1.7572990175729903],
    [
      group([position(172.392, -56.725, 0), position(172.392, -71.725, 0)]),
      [layout, layout],
      1.7572990175729903,
    ],
    [group([position(172.392, -56.725, 0), position(172.392, -71.725, 0)]), [layout], 1.5],
  ] as const) {
    const { result, warnings } = plan(candidate, layouts, space);

    assert.equal(result, null);
    assert.deepEqual(warnings, ['figured-bass-position']);
  }
});

test('malformed cached stencil extents fail closed without throwing', () => {
  const input = group([position(172.392, -56.725, 0), position(172.392, -71.725, 0)]);
  const malformed = structuredClone(input);

  Reflect.set(malformed.figures[0]!.graphicPosition!, 'stencilXExtentTenths', undefined);
  const { result, warnings } = plan(malformed);

  assert.equal(result, null);
  assert.deepEqual(warnings, ['figured-bass-position']);
});

test('malformed nested cache data and overflowing coordinates fail closed', () => {
  const valid = group([position(172.392, -56.725, 0), position(172.392, -71.725, 0)]);
  const nullFigure = structuredClone(valid);

  Reflect.set(nullFigure.figures, 0, null);
  const malformedDisplay = structuredClone(valid);

  Reflect.set(malformedDisplay.figures[0]!, 'display', {
    command: 'number-markup',
    args: null,
  });
  const malformedMoment = structuredClone(valid);

  Reflect.set(malformedMoment.figures[0]!.graphicPosition!, 'columnMoment', {
    main: null,
    grace: null,
  });

  for (const candidate of [nullFigure, malformedDisplay, malformedMoment]) {
    const { result, warnings } = plan(candidate);

    assert.equal(result, null);
    assert.deepEqual(warnings, ['figured-bass-position']);
  }

  const hugeLayout: MeasureLayoutEvent = {
    ...layout,
    startXTenths: -Number.MAX_VALUE,
    endXTenths: Number.MAX_VALUE,
    systemLeftXTenths: -Number.MAX_VALUE,
    systemRightXTenths: Number.MAX_VALUE,
  };
  const huge = {
    ...valid,
    figures: valid.figures.map((figure, index) =>
      index === 0
        ? {
            ...figure,
            graphicPosition: {
              ...figure.graphicPosition!,
              systemXTenths: Number.MAX_VALUE,
            },
          }
        : figure,
    ),
  };
  const { result, warnings } = plan(huge, [hugeLayout]);

  assert.equal(result, null);
  assert.deepEqual(warnings, ['figured-bass-position']);
});

test('unsupported row content prevents partial group positioning', () => {
  const input = group([position(172.392, -56.725, 0), position(172.392, -71.725, 0)]);
  const changed = {
    ...input,
    figures: input.figures.map((figure, index) =>
      index ? { ...figure, augmented: true } : figure,
    ),
  };
  const { result, warnings } = plan(changed);

  assert.equal(result, null);
  assert.deepEqual(warnings, ['figured-bass-position']);
});

test('formatter token offsets map independently to native prefix and number children', () => {
  const input = group([position(172.392, -56.725, 0), position(172.392, -71.725, 0)]);
  const figures = input.figures.map((figure, index) =>
    index === 0
      ? {
          ...figure,
          alteration: { numerator: 1, denominator: 2 },
          display: {
            command: 'put-adjacent-markup',
            args: ['left', 'right'],
            plain: '6♯',
          },
          graphicPosition: {
            ...figure.graphicPosition!,
            tokens: { prefix: [-0.7146, 0.25], number: [-0.4268, 0] } as const,
          },
        }
      : {
          ...figure,
          graphicPosition: {
            ...figure.graphicPosition!,
            tokens: { number: [-0.4268, 0] } as const,
          },
        },
  );
  const { result, warnings } = plan({ ...input, figures });
  const first = result?.components?.get(1);

  assert.ok(first?.prefix);
  assert.ok(first?.number);
  assert.ok(Math.abs(Number(first.prefix['default-x']) - 86.6774) < 1e-9);
  assert.ok(Math.abs(Number(first.prefix['default-y']) - -56.475) < 1e-9);
  assert.ok(Math.abs(Number(first.number['default-x']) - 86.9652) < 1e-9);
  assert.ok(Math.abs(Number(first.number['default-y']) - -56.725) < 1e-9);
  const second = result?.components?.get(2)?.number;

  assert.ok(second);
  assert.ok(Math.abs(Number(second['default-x']) - 86.9652) < 1e-9);
  assert.ok(Math.abs(Number(second['default-y']) - -71.725) < 1e-9);
  assert.deepEqual(warnings, []);
});

test('formatter token geometry fails closed on missing, extra, or malformed roles for the whole group', () => {
  const input = group([position(172.392, -56.725, 0), position(172.392, -71.725, 0)]);
  const altered = {
    ...input,
    figures: input.figures.map((figure, index) =>
      index === 0
        ? {
            ...figure,
            alteration: { numerator: 1, denominator: 2 },
            display: {
              command: 'put-adjacent-markup',
              args: ['left', 'right'],
              plain: '6♯',
            },
          }
        : figure,
    ),
  };

  for (const candidate of [
    {
      ...altered,
      figures: altered.figures.map((figure, index) =>
        index === 0
          ? {
              ...figure,
              graphicPosition: {
                ...figure.graphicPosition!,
                tokens: { number: [-0.4268, 0] },
              },
            }
          : figure,
      ),
    },
    {
      ...altered,
      figures: altered.figures.map((figure, index) =>
        index === 0
          ? {
              ...figure,
              graphicPosition: {
                ...figure.graphicPosition!,
                tokens: {
                  prefix: [-0.7146, 0],
                  number: [-0.4268, 0],
                  suffix: [0, 0],
                },
              },
            }
          : figure,
      ),
    },
    {
      ...altered,
      figures: altered.figures.map((figure, index) =>
        index === 0
          ? {
              ...figure,
              graphicPosition: {
                ...figure.graphicPosition!,
                tokens: { prefix: [NaN, 0], number: [-0.4268, 0] },
              },
            }
          : figure,
      ),
    },
  ]) {
    const { result, warnings } = plan(candidate as FigureGroup);

    assert.equal(result, null);
    assert.deepEqual(warnings, ['figured-bass-position']);
  }
});

test('augmented accessory position follows semantic suffix direction', () => {
  const input = group([position(172.392, -56.725, 0)]);
  const figure = {
    ...input.figures[0]!,
    augmented: true,
    display: {
      command: 'put-adjacent-markup',
      args: ['left', 'right'],
      plain: '6+',
    },
    graphicPosition: {
      ...input.figures[0]!.graphicPosition!,
      tokens: { number: [-0.4268, 0], suffix: [0.5463, 0.1] } as const,
    },
  };
  const { result, warnings } = plan({ ...input, figures: [figure] });
  const components = result?.components?.get(1);

  assert.ok(components?.number && components.suffix);
  assert.ok(Math.abs(Number(components.number['default-x']) - 86.9652) < 1e-9);
  assert.ok(Math.abs(Number(components.suffix['default-x']) - 87.9383) < 1e-9);
  assert.ok(Math.abs(Number(components.suffix['default-y']) - -56.625) < 1e-9);
  assert.deepEqual(warnings, []);
});

test('printed figure columns group equivalent fractions and separate distinct rounded onsets', () => {
  const source = group([null, null, null]);
  const n = Number.MAX_SAFE_INTEGER;
  const columns = [
    { numerator: n - 1, denominator: n },
    { numerator: n - 2, denominator: n - 1 },
    { numerator: 2, denominator: 4 },
    { numerator: 1, denominator: 2 },
  ];

  source.figures = columns.map((main, index) => ({
    ...source.figures[0]!,
    id: index + 1,
    column: { main, grace: { numerator: 0, denominator: index + 1 } },
  }));
  assert.equal(
    eventTime({ moment: source.figures[0]!.column! }),
    eventTime({ moment: source.figures[1]!.column! }),
  );
  const positioned = positionFigures([source], [], 1, eventTime, eventGraceTime, () => {});

  assert.deepEqual(
    positioned.map((column) => column.figures.map((figure) => figure.id)),
    [[1], [2], [3, 4]],
  );
});
