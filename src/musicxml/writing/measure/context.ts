import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Event } from '../../planning/events.js';
import type { LayoutSession } from '../layout-session.js';
import type { PartSession } from '../part/session.js';

/** Facts about one native measure, passed by value to its focused writers. */
export interface MeasureWritingFrame {
  measure: XMLBuilder;
  measureStart: number;
  measureEnd: number;
  measureIndex: number;
  inMeasure: Event[];
  step: ReturnType<PartSession['plan']['timing']['at']>;
  sourceSystem: ReturnType<LayoutSession['systemGeometry']>;
  sourcePage: ReturnType<LayoutSession['pageLayouts']['at']>;
  printNode: XMLBuilder | undefined;
  writeClef: (
    parent: XMLBuilder,
    clef: Extract<Event, { kind: 'clef' }>,
    at?: number,
    hidden?: boolean,
  ) => void;
}
