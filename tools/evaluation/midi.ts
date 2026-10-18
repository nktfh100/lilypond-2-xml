export interface MidiTrackName {
  readonly tick: number;
  readonly text: string;
}
export interface MidiProgramChange {
  readonly tick: number;
  readonly channel: number;
  readonly program: number;
}
export interface MidiControlChange {
  readonly tick: number;
  readonly channel: number;
  readonly controller: number;
  readonly value: number;
}
export interface MidiPitchBend {
  readonly tick: number;
  readonly channel: number;
  /** Unsigned 14-bit wheel value; 8192 is neutral. */
  readonly value: number;
}
export interface MidiAttack {
  readonly tick: number;
  readonly channel: number;
  readonly pitch: number;
  readonly velocity: number;
  /** Actual Note Off tick; null when missing or overlapping ownership is ambiguous. */
  readonly endTick: number | null;
}
export interface MidiTrackPerformance {
  readonly index: number;
  readonly names: readonly MidiTrackName[];
  readonly programs: readonly MidiProgramChange[];
  readonly attacks: readonly MidiAttack[];
  readonly controls: readonly MidiControlChange[];
  readonly pitchBends: readonly MidiPitchBend[];
}
export interface MidiPerformance {
  readonly format: 0 | 1;
  readonly division: number;
  readonly tracks: readonly MidiTrackPerformance[];
}

// Event order is parser-private: preserve the existing public SMF shape and keep
// same-tick state changes ordered without inventing order between separate tracks.
const eventOrder = new WeakMap<object, number>();

export interface MidiAttackRoute {
  readonly channel: number;
  readonly program: number | null;
  readonly pan: readonly [number, number] | null;
}

interface RoutePoint {
  readonly tick: number;
  readonly channel: number;
}

const routeAt = (
  midi: MidiPerformance,
  track: MidiTrackPerformance,
  point: RoutePoint,
  order = eventOrder.get(point),
): MidiAttackRoute => {
  const state = (
    rows: readonly {
      track: MidiTrackPerformance;
      event: MidiProgramChange | MidiControlChange;
      value: number | null;
    }[],
  ) => {
    const candidates = rows.filter(
      (row) => row.event.channel === point.channel && row.event.tick <= point.tick,
    );

    if (candidates.some((row) => row.event.tick === point.tick && row.track !== track)) {
      return null;
    }

    const before = candidates.filter(
      (row) =>
        row.event.tick < point.tick || (order !== undefined && eventOrder.get(row.event)! < order),
    );

    if (!before.length) {
      return null;
    }

    const tick = Math.max(...before.map((row) => row.event.tick));
    const latest = before.filter((row) => row.event.tick === tick);
    const lastByTrack = new Map<MidiTrackPerformance, (typeof latest)[number]>();

    for (const row of latest) {
      const old = lastByTrack.get(row.track);

      if (old && (!eventOrder.has(row.event) || !eventOrder.has(old.event))) {
        return null;
      }

      if (!old || eventOrder.get(row.event)! > eventOrder.get(old.event)!) {
        lastByTrack.set(row.track, row);
      }
    }

    const values = [...lastByTrack.values()].map((row) => row.value);

    return values.every((value) => value === values[0]) ? values[0]! : null;
  };
  const programs = midi.tracks.flatMap((t) =>
    t.programs.map((event) => ({ track: t, event, value: event.program })),
  );
  const controls = midi.tracks.flatMap((t) =>
    t.controls.map((event) => ({ track: t, event, value: event.value })),
  );
  const component = (controller: number) =>
    state(
      controls
        .filter((row) => row.event.controller === controller || row.event.controller === 121)
        .map((row) => ({
          ...row,
          value: row.event.controller === 121 ? null : row.value,
        })),
    );
  const msb = component(10),
    lsb = component(42);

  return {
    channel: point.channel,
    program: state(programs),
    pan: msb === null || lsb === null ? null : [msb, lsb],
  };
};

/** Actual ordered channel state at each parsed attack. Null is unknown, never an
 * inferred GM initialization. Separate-track simultaneous changes are unordered. */
export function midiAttackRoutes(midi: MidiPerformance): ReadonlyMap<MidiAttack, MidiAttackRoute> {
  return new Map(
    midi.tracks.flatMap((track) =>
      track.attacks.map((attack) => [attack, routeAt(midi, track, attack)] as const),
    ),
  );
}

export interface MidiRoutingEvent {
  readonly tick: number;
  readonly track: number;
  readonly order: number;
  readonly channel: number;
  readonly program?: number;
  readonly pan?: readonly [number, number];
}

/** Raw program messages and established full pan states, retaining per-track
 * order. A partial 14-bit state is counted, not completed with invented zeros. */
export function midiRoutingEvents(midi: MidiPerformance): {
  events: readonly MidiRoutingEvent[];
  unresolved: number;
} {
  const events: MidiRoutingEvent[] = [];
  let unresolved = 0;

  for (const track of midi.tracks) {
    for (const event of track.programs) {
      const order = eventOrder.get(event);

      if (order === undefined) {
        ++unresolved;
        continue;
      }

      events.push({
        tick: event.tick,
        track: track.index,
        order,
        channel: event.channel,
        program: event.program,
      });
    }

    for (const event of track.controls.filter((event) =>
      [10, 42, 121].includes(event.controller),
    )) {
      const order = eventOrder.get(event);

      if (order === undefined) {
        ++unresolved;
        continue;
      }

      const pan = routeAt(midi, track, event, order + 0.5).pan;

      if (pan) {
        events.push({
          tick: event.tick,
          track: track.index,
          order,
          channel: event.channel,
          pan,
        });
      } else {
        ++unresolved;
      }
    }
  }

  events.sort((a, b) => a.tick - b.tick || a.track - b.track || a.order - b.order);

  return { events, unresolved };
}

/** Read format 0/1 PPQ attacks and actual Note Off ticks, without sustain synthesis.
 * Unsupported timing, escaped MIDI streams and non-UTF8 names throw. */
export function readMidiAttacks(bytes: Uint8Array): MidiPerformance {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let position = 0;
  const fail = (message: string): never => {
    throw new Error(`Invalid MIDI at byte ${position}: ${message}`);
  };
  const requireBytes = (length: number, end = bytes.length) => {
    if (length > end - position) {
      fail('truncated chunk or event');
    }
  };
  const byte = (end: number) => {
    requireBytes(1, end);

    return bytes[position++]!;
  };
  const variable = (end: number) => {
    let value = 0;

    for (let i = 0; i < 4; i++) {
      const part = byte(end);

      value = value * 128 + (part & 127);

      if (!(part & 128)) {
        return value;
      }
    }

    return fail('variable-length value exceeds four bytes');
  };
  const chunk = () => {
    requireBytes(8);
    const id = String.fromCharCode(...bytes.subarray(position, position + 4));
    const length = view.getUint32(position + 4);

    position += 8;
    requireBytes(length);

    return { id, end: position + length };
  };
  const header = chunk();

  if (header.id !== 'MThd' || header.end - position < 6) {
    fail('missing or invalid header');
  }

  const format = view.getUint16(position),
    count = view.getUint16(position + 2),
    division = view.getUint16(position + 4);

  if (format !== 0 && format !== 1) {
    return fail('only SMF formats 0 and 1 are supported');
  }

  if (!count || (format === 0 && count !== 1)) {
    fail('invalid declared track count');
  }

  if (!division || division & 0x8000) {
    fail('only nonzero PPQ timing is supported');
  }

  position = header.end;
  const tracks: MidiTrackPerformance[] = [];

  while (position < bytes.length) {
    const { id, end } = chunk();

    if (id === 'MThd') {
      fail('duplicate header');
    }

    if (id !== 'MTrk') {
      position = end;
      continue;
    }

    if (tracks.length >= count) {
      fail('more tracks than declared');
    }

    type Attack = Omit<MidiAttack, 'endTick'> & { endTick: number | null };
    const names: MidiTrackName[] = [],
      programs: MidiProgramChange[] = [],
      attacks: Attack[] = [];
    const controls: MidiControlChange[] = [],
      pitchBends: MidiPitchBend[] = [];
    const active = new Map<
      number,
      {
        attacks: { attack: Attack; firstOffIndex: number }[];
        offs: number[];
        count: number;
      }
    >();
    let tick = 0,
      running = 0,
      ended = false,
      sysex = false,
      order = 0;

    while (position < end) {
      ++order;
      tick += variable(end);

      if (!Number.isSafeInteger(tick)) {
        fail('track tick exceeds safe integer precision');
      }

      requireBytes(1, end);
      let status = bytes[position]!;

      if (status & 128) {
        position++;
      } else {
        if (!running) {
          fail('data byte without channel running status');
        }

        status = running;
      }

      if (status >= 0x80 && status <= 0xef) {
        if (sysex) {
          fail('channel event inside unfinished SysEx');
        }

        running = status;

        const data = () => {
          const value = byte(end);

          if (value & 128) {
            fail('status byte in channel data');
          }

          return value;
        };
        const type = status & 0xf0,
          channel = status & 15,
          first = data();
        const second = type === 0xc0 || type === 0xd0 ? 0 : data();

        if (type === 0x90 && second) {
          const attack: Attack = {
            tick,
            channel,
            pitch: first,
            velocity: second,
            endTick: null,
          };

          eventOrder.set(attack, order);
          attacks.push(attack);
          const key = channel * 128 + first,
            previous = active.get(key);

          if (previous) {
            previous.attacks.push({
              attack,
              firstOffIndex: previous.offs.length,
            });
            previous.count++;
          } else {
            active.set(key, {
              attacks: [{ attack, firstOffIndex: 0 }],
              offs: [],
              count: 1,
            });
          }
        } else if (type === 0x80 || (type === 0x90 && !second)) {
          const key = channel * 128 + first,
            previous = active.get(key);

          if (previous) {
            previous.offs.push(tick);

            if (--previous.count === 0) {
              // Every subsequent Off is eligible until this busy period ends.
              for (const { attack, firstOffIndex } of previous.attacks) {
                if (previous.offs[firstOffIndex] === tick) {
                  attack.endTick = tick;
                }
              }

              active.delete(key);
            }
          }
        }

        if (type === 0xc0) {
          const event = { tick, channel, program: first };

          eventOrder.set(event, order);
          programs.push(event);
        }

        if (type === 0xb0) {
          const event = { tick, channel, controller: first, value: second };

          eventOrder.set(event, order);
          controls.push(event);
        }

        if (type === 0xe0) {
          pitchBends.push({ tick, channel, value: first + 128 * second });
        }
      } else if (status === 0xff) {
        running = 0;
        const type = byte(end);

        if (type & 128) {
          fail('invalid meta event type');
        }

        const length = variable(end);

        requireBytes(length, end);

        if (type === 0x2f) {
          if (length || position !== end || sysex) {
            fail('invalid or nonterminal end-of-track event');
          }

          ended = true;
          break;
        }

        if (type === 3) {
          let name: string;

          try {
            name = text.decode(bytes.subarray(position, position + length));
          } catch {
            return fail('track name is not UTF8');
          }

          names.push({ tick, text: name });
        }

        position += length;
      } else if (status === 0xf0 || status === 0xf7) {
        running = 0;

        if (status === 0xf7 && !sysex) {
          fail('standalone escaped MIDI streams are unsupported');
        }

        if (status === 0xf0 && sysex) {
          fail('nested SysEx start');
        }

        const length = variable(end);

        requireBytes(length, end);
        sysex = true;

        for (let i = 0; i < length; i++) {
          const value = byte(end);

          if (value === 0xf7 && i === length - 1) {
            sysex = false;
          } else if (value & 128) {
            fail('invalid SysEx data');
          }
        }
      } else {
        fail('unsupported system status in SMF track');
      }
    }

    if (!ended) {
      fail('missing end-of-track event');
    }

    tracks.push({
      index: tracks.length,
      names,
      programs,
      attacks,
      controls,
      pitchBends,
    });
  }

  if (tracks.length !== count) {
    fail('track count differs from header');
  }

  return { format, division, tracks };
}
