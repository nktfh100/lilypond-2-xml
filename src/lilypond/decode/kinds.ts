import type { WireEvent } from '../wire.js';

/** Every collector kind either produces an event or supplies another event's graphics. */
const extensionKinds = {
  layout: 'event',
  'accidental-graphic': 'event',
  transpose: 'event',
  percussion: 'event',
  stafflines: 'event',
  drumscript: 'event',
  tabnote: 'event',
  tabstaff: 'event',
  harmony: 'event',
  navigation: 'event',
  barline: 'event',
  'barline-layout': 'event',
  percent: 'event',
  percentgraphic: 'auxiliary',
  notehead: 'event',
  notesize: 'event',
  script: 'event',
  arpeggio: 'event',
  bracket: 'event',
  durationline: 'event',
  ligature: 'event',
  fingerglide: 'event',
  episema: 'event',
  'optional-material': 'event',
  bendgraphic: 'event',
  'measure-counter': 'event',
  footnote: 'event',
  'lyric-extender': 'event',
  'note-position': 'event',
  'measure-layout': 'event',
  textcolumnposition: 'event',
  'label-anchor': 'event',
  'combine-text': 'event',
  'vowel-transition': 'event',
  'vowel-transition-request': 'event',
  clustergraphic: 'event',
  slur: 'event',
  glissando: 'event',
  tiegraphic: 'event',
  tiestate: 'event',
  staffstep: 'event',
  figuredbass: 'event',
  figuregraphic: 'auxiliary',
  figureline: 'auxiliary',
  instrumentname: 'event',
  namepiece: 'event',
  finallayout: 'event',
} as const satisfies Record<WireEvent['k'], 'event' | 'auxiliary'>;

type ExtensionEventKind = {
  [K in WireEvent['k']]: (typeof extensionKinds)[K] extends 'event' ? K : never;
}[WireEvent['k']];

export type ExtensionEvent = Extract<WireEvent, { k: ExtensionEventKind }>;

/** The compiler checks kind coverage; field validation belongs to the decoders. */
export function isWireEvent(event: { k: string }): event is WireEvent {
  return Object.hasOwn(extensionKinds, event.k);
}

export function isExtensionEvent<T extends WireEvent>(event: T): event is T & ExtensionEvent {
  return extensionKinds[event.k] === 'event';
}
