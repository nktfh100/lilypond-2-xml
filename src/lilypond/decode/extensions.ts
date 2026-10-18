import {
  decodeClustergraphic,
  decodeGlissando,
  decodeSlur,
  decodeTiegraphic,
  decodeTiestate,
} from './curves.js';
import {
  decodeCombineText,
  decodeFiguredbass,
  decodeFootnote,
  decodeHarmony,
  decodeInstrumentname,
  decodeLabelAnchor,
  decodeLyricExtender,
  decodeMeasureCounter,
  decodeNavigation,
  decodePercent,
  decodeVowelTransition,
  decodeVowelTransitionRequest,
} from './directions.js';
import {
  decodeAccidentalGraphic,
  decodeBarline,
  decodeBarlineLayout,
  decodeFinalLayout,
  decodeLayout,
  decodeMeasureLayout,
  decodeNamepiece,
  decodeNotePosition,
  decodeStafflines,
  decodeStaffstep,
  decodeTabstaff,
  decodeTextcolumnposition,
} from './layout.js';
import {
  decodeArpeggio,
  decodeBendgraphic,
  decodeBracket,
  decodeDrumscript,
  decodeDurationline,
  decodeFingerGlide,
  decodeLigature,
  decodeNotehead,
  decodeNotesize,
  decodeOptionalMaterial,
  decodePercussion,
  decodeScript,
  decodeTabnote,
  decodeTranspose,
} from './notation.js';
import type { ExtensionEvent } from './kinds.js';
import type { DecodedExtension } from './values.js';
import type { WireEvent } from '../wire.js';

export type { ExtensionEvent } from './kinds.js';

function decodeExtensionValue(
  e: ExtensionEvent,
  extensions: readonly WireEvent[],
): DecodedExtension {
  switch (e.k) {
    case 'accidental-graphic':
      return decodeAccidentalGraphic(e);
    case 'finallayout':
      return decodeFinalLayout(e);
    case 'namepiece':
      return decodeNamepiece(e);
    case 'staffstep':
      return decodeStaffstep(e);
    case 'tiestate':
      return decodeTiestate(e);
    case 'tiegraphic':
      return decodeTiegraphic(e);
    case 'glissando':
      return decodeGlissando(e);
    case 'slur':
      return decodeSlur(e);
    case 'clustergraphic':
      return decodeClustergraphic(e);
    case 'fingerglide':
    case 'episema':
      return decodeFingerGlide(e);
    case 'vowel-transition-request':
      return decodeVowelTransitionRequest(e);
    case 'vowel-transition':
      return decodeVowelTransition(e);
    case 'measure-layout':
      return decodeMeasureLayout(e);
    case 'textcolumnposition':
      return decodeTextcolumnposition(e);
    case 'note-position':
      return decodeNotePosition(e);
    case 'label-anchor':
      return decodeLabelAnchor(e);
    case 'combine-text':
      return decodeCombineText(e);
    case 'footnote':
      return decodeFootnote(e);
    case 'lyric-extender':
      return decodeLyricExtender(e);
    case 'measure-counter':
      return decodeMeasureCounter(e);
    case 'bendgraphic':
      return decodeBendgraphic(e);
    case 'optional-material':
      return decodeOptionalMaterial(e);
    case 'ligature':
      return decodeLigature(e);
    case 'durationline':
      return decodeDurationline(e);
    case 'bracket':
      return decodeBracket(e);
    case 'arpeggio':
      return decodeArpeggio(e);
    case 'percent':
      return decodePercent(e, extensions);
    case 'instrumentname':
      return decodeInstrumentname(e);
    case 'figuredbass':
      return decodeFiguredbass(e, extensions);
    case 'script':
      return decodeScript(e);
    case 'notesize':
      return decodeNotesize(e);
    case 'notehead':
      return decodeNotehead(e);
    case 'barline-layout':
      return decodeBarlineLayout(e);
    case 'barline':
      return decodeBarline(e);
    case 'navigation':
      return decodeNavigation(e);
    case 'harmony':
      return decodeHarmony(e);
    case 'layout':
      return decodeLayout(e);
    case 'tabnote':
      return decodeTabnote(e);
    case 'tabstaff':
      return decodeTabstaff(e);
    case 'stafflines':
      return decodeStafflines(e);
    case 'drumscript':
      return decodeDrumscript(e);
    case 'percussion':
      return decodePercussion(e);
    case 'transpose':
      return decodeTranspose(e);
  }

  const unreachable: never = e;

  throw new TypeError(`Unknown extracted event kind: ${String(unreachable)}`);
}

/** Preserve the actual event identity and original decoding error at the wire boundary. */
export function decodeExtension(
  event: ExtensionEvent,
  extensions: readonly WireEvent[],
): DecodedExtension {
  try {
    return decodeExtensionValue(event, extensions);
  } catch (cause) {
    const identity = [
      'id' in event ? ` id=${event.id}` : '',
      'nid' in event ? ` note=${event.nid}` : '',
      'v' in event ? ` voice=${event.v}` : 'voice' in event ? ` voice=${event.voice}` : '',
      's' in event ? ` staff=${event.s}` : '',
      'system' in event
        ? ` system=${event.system}`
        : 'geometry' in event && event.geometry
          ? ` system=${event.geometry.system}`
          : '',
    ].join('');

    throw new TypeError(`Unable to decode ${event.k}${identity} at ${event.m}/${event.g}`, {
      cause,
    });
  }
}
