import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import { builder } from '../xml-builder.js';
import type { Add } from '../types.js';
import { xmlNumber } from '../primitives.js';
import type { PageLayoutFrame } from './page-layout.js';
import { writeSystemMargins } from './paper.js';

/** Merge physical page fields without duplicating an existing native print. */
export function applyPagePrint(
  print: XMLBuilder,
  frame: PageLayoutFrame,
  box: { left: number; right: number; layoutStaffSpace: number },
  staves: readonly number[],
  add: Add,
) {
  const children = (parent: XMLBuilder, name: string) =>
    Array.from(parent.node.childNodes).filter(
      (n): n is NonNullable<typeof n> => n != null && n.nodeType === 1 && n.nodeName === name,
    );
  const remove = (parent: XMLBuilder, name: string) => {
    for (const n of children(parent, name)) {
      parent.node.removeChild(n);
    }
  };

  for (const [name, value] of Object.entries(frame.attrs)) {
    if (value !== undefined) {
      print.att(name, String(value));
    }
  }

  remove(print, 'page-layout');

  if (frame.page && frame.firstOnPage) {
    const page = add(print, 'page-layout'),
      p = frame.page;

    add(page, 'page-height', xmlNumber(p.height));
    add(page, 'page-width', xmlNumber(p.width));
    const margins = add(page, 'page-margins', undefined, { type: 'both' });

    for (const [name, value] of [
      ['left-margin', p.left],
      ['right-margin', p.right],
      ['top-margin', p.top],
      ['bottom-margin', p.bottom],
    ] as const) {
      add(margins, name, xmlNumber(value));
    }
  }

  const margins = frame.systemMargins(box.left, box.right, box.layoutStaffSpace);
  let system = children(print, 'system-layout')[0];

  if (margins || frame.systemDistance !== null || frame.topSystemDistance !== null) {
    const target = system ? builder(system) : add(print, 'system-layout');

    system = target.node;

    if (margins) {
      remove(target, 'system-margins');
      writeSystemMargins(target, margins.left, margins.right);
    }

    remove(target, 'system-distance');
    remove(target, 'top-system-distance');

    if (frame.systemDistance !== null) {
      add(target, 'system-distance', xmlNumber(frame.systemDistance));
    }

    if (frame.topSystemDistance !== null) {
      add(target, 'top-system-distance', xmlNumber(frame.topSystemDistance));
    }

    const order = ['system-margins', 'system-distance', 'top-system-distance'];

    for (const name of order) {
      for (const n of children(target, name)) {
        target.node.appendChild(n);
      }
    }
  } else if (system) {
    const target = builder(system);

    remove(target, 'system-distance');
    remove(target, 'top-system-distance');
  }

  remove(print, 'staff-layout');

  for (const [staff, distance] of frame.staffDistances) {
    if (staves.includes(staff)) {
      add(
        add(print, 'staff-layout', undefined, {
          number: staves.indexOf(staff) + 1,
        }),
        'staff-distance',
        xmlNumber(distance),
      );
    }
  }

  const order = [
    'page-layout',
    'system-layout',
    'staff-layout',
    'measure-layout',
    'measure-numbering',
    'part-name-display',
    'part-abbreviation-display',
  ];

  for (const name of order) {
    for (const n of children(print, name)) {
      print.node.appendChild(n);
    }
  }
}
