import { bendHoldAttributes } from '../../notation/notes/bends.js';
import { bracketAttributes } from '../../notation/spans/brackets.js';
import { musicXMLColor } from '../../notation/colors.js';
import { durationLineAttributes } from '../../notation/spans/duration-lines.js';
import { episemaAttributes } from '../../notation/spans/episemas.js';
import { fingerGlideAttributes } from '../../notation/spans/finger-glides.js';
import { ligatureAttributes } from '../../notation/spans/ligatures.js';
import { optionalMaterialAttributes } from '../../notation/spans/optional-material.js';
import { vowelTransitionAttributes } from '../../text/vowel-transitions.js';
import type { Attributes } from '../../types.js';
import type { Event } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import type { WriteDirection } from '../measure/directions.js';

type BracketDirectionPoint = Extract<
  Event,
  {
    kind:
      | 'vowelTransitionPoint'
      | 'bendHoldPoint'
      | 'optionalMaterialPoint'
      | 'episemaPoint'
      | 'fingerGlidePoint'
      | 'ligaturePoint'
      | 'durationLinePoint'
      | 'bracketPoint';
  }
>;

interface BracketDirectionInput {
  readonly bracketIds: ReadonlyMap<string, number>;
  readonly measureStart: number;
  readonly warn: Warn;
  readonly writeDirection: WriteDirection;
}

export function writeBracketPointDirection(
  e: BracketDirectionPoint,
  { bracketIds, measureStart, warn, writeDirection }: BracketDirectionInput,
) {
  const number = bracketIds.get(e.spanKey);

  if (number === undefined) {
    return;
  }

  let attrs: Attributes;

  switch (e.kind) {
    case 'vowelTransitionPoint':
      attrs = vowelTransitionAttributes(e, number, measureStart, warn);
      break;
    case 'bendHoldPoint':
      attrs = bendHoldAttributes(e, number);
      break;
    case 'optionalMaterialPoint':
      attrs = optionalMaterialAttributes(e, number, measureStart, warn);
      break;
    case 'episemaPoint':
      attrs = episemaAttributes(e, number, measureStart, warn);
      break;
    case 'fingerGlidePoint':
      attrs = fingerGlideAttributes(e, number, measureStart, warn);
      break;
    case 'ligaturePoint':
      attrs = ligatureAttributes(e, number);
      break;
    case 'durationLinePoint':
      attrs = durationLineAttributes(e, number);
      break;
    case 'bracketPoint':
      if (e.point === 'label') {
        writeDirection(e, 'words', e.text ?? undefined, {
          halign: 'center',
          color: e.hidden ? '#00000000' : musicXMLColor(e.textColor),
        });

        return;
      }

      attrs = bracketAttributes(e, number);
  }

  writeDirection(e, 'bracket', undefined, attrs);
}
