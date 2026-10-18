import assert from 'node:assert/strict';
import { test } from 'node:test';
import xmlbuilder from 'xmlbuilder2/lib/xmlbuilder2.min.js';
import type { PlannedNote } from '../../../src/musicxml/planning/events.js';
import { writeNoteAppearance } from '../../../src/musicxml/writing/note/appearance.js';
import { elements } from '../../support/xml-support.js';

test('note appearance uses prepared facts without a score or part session', () => {
  const node = xmlbuilder.create().ele('note');
  const note: PlannedNote = {
    kind: 'note',
    noteId: 7,
    staff: 3,
    voice: 12,
    moment: {
      main: { numerator: 0, denominator: 1 },
      grace: { numerator: 0, denominator: 1 },
    },
    duration: { log: 3, dots: 1, scale: { numerator: 1, denominator: 1 } },
    attachments: [],
    segmentDuration: 0.1875,
    continuation: false,
    continues: false,
    tieAtEnd: false,
  };
  const warnings: string[] = [];

  writeNoteAppearance(
    {
      percussionInstruments: [],
      multipleStaves: true,
      footnotes: new Map(),
      accidentalGraphics: new Map([[7, { value: 'natural', attrs: { cautionary: 'yes' } }]]),
      beamsByNote: new Map(),
      voiceNumber: (voice) => voice - 10,
      staffNumber: (staff) => staff - 1,
      tick: (duration) => Math.round(duration * 16),
      warn: (code) => warnings.push(code),
    },
    note,
    {
      node,
      voice: 12,
      chord: false,
      inMeasure: [
        {
          kind: 'accidental',
          staff: 3,
          noteId: 7,
          alteration: 0.5,
          cautionary: false,
          moment: note.moment,
        },
      ],
      percussion: undefined,
      bendHead: undefined,
      settings: undefined,
      tab: undefined,
      head: undefined,
      cluster: undefined,
    },
  );
  assert.equal(elements(node.node, 'voice')[0]?.textContent, '2');
  assert.equal(elements(node.node, 'staff')[0]?.textContent, '2');
  assert.equal(elements(node.node, 'type')[0]?.textContent, 'eighth');
  assert.equal(elements(node.node, 'dot').length, 1);
  assert.equal(elements(node.node, 'accidental')[0]?.textContent, 'natural');
  assert.equal(elements(node.node, 'accidental')[0]?.getAttribute('cautionary'), 'yes');
  assert.deepEqual(warnings, []);
});
