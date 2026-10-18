export interface MidiNote {
  pitch: number;
  channel: number;
  velocity: number;
  onset: number;
  duration: number | null;
}

function readMidi(input: string | Uint8Array) {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'base64') : input;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const division = view.getUint16(12);

  if (division & 0x8000) {
    throw new Error('SMPTE MIDI timing is not supported by this test reader');
  }

  let position = 8 + view.getUint32(4);
  const notes: MidiNote[] = [];
  const tempos: { tick: number; micros: number }[] = [];
  const variable = () => {
    let result = 0,
      byte;

    do {
      byte = bytes[position++];
      result = result * 128 + (byte! & 127);
    } while (byte! & 128);

    return result;
  };

  while (position < bytes.length) {
    const length = view.getUint32(position + 4);
    const end = position + 8 + length;
    const track = new TextDecoder().decode(bytes.subarray(position, position + 4));

    position += 8;
    let tick = 0,
      status = 0;
    const active = new Map<string, MidiNote[]>();

    while (track === 'MTrk' && position < end) {
      tick += variable();

      if (bytes[position]! & 128) {
        status = bytes[position++]!;
      }

      if (status === 255) {
        const type = bytes[position++];
        const length = variable();

        if (type === 81 && length === 3) {
          tempos.push({
            tick,
            micros: bytes[position]! * 65536 + bytes[position + 1]! * 256 + bytes[position + 2]!,
          });
        }

        position += length;
        continue;
      }

      if (status === 240 || status === 247) {
        const length = variable();

        position += length;
        continue;
      }

      const type = status & 240;
      const channel = status & 15;
      const pitch = bytes[position++]!;
      const velocity = [192, 208].includes(type) ? 0 : bytes[position++]!;
      const key = `${channel}:${pitch}`;

      if (type === 144 && velocity) {
        const note: MidiNote = {
          pitch,
          channel,
          velocity,
          onset: tick / division,
          duration: null,
        };

        notes.push(note);
        active.set(key, [...(active.get(key) || []), note]);
      } else if (type === 128 || (type === 144 && velocity === 0)) {
        const note = active.get(key)?.shift();

        if (note) {
          note.duration = tick / division - note.onset;
        }
      }
    }

    position = end;
  }

  notes.sort((a, b) => a.onset - b.onset || a.pitch - b.pitch || a.channel - b.channel);

  return {
    notes,
    tempos: tempos.sort((a, b) => a.tick - b.tick),
    division,
    format: view.getUint16(8),
  };
}

/** Onset and duration in quarter-note beats. */
export function midiNotes(input: string | Uint8Array): MidiNote[] {
  return readMidi(input).notes;
}

/** Tempo-adjusted onset and duration in seconds. */
export function midiTimedNotes(input: string | Uint8Array): MidiNote[] {
  const { notes, tempos, division, format } = readMidi(input);

  if (format > 1) {
    throw new Error('Independent MIDI sequences do not share one tempo map');
  }

  const seconds = (beats: number) => {
    const end = beats * division;
    let tick = 0,
      total = 0,
      micros = 500000;

    for (const tempo of tempos) {
      if (tempo.tick > end) {
        break;
      }

      total += ((tempo.tick - tick) * micros) / division / 1e6;
      tick = tempo.tick;
      micros = tempo.micros;
    }

    return total + ((end - tick) * micros) / division / 1e6;
  };

  return notes.map((note) => ({
    ...note,
    onset: seconds(note.onset),
    duration:
      note.duration === null ? null : seconds(note.onset + note.duration) - seconds(note.onset),
  }));
}
