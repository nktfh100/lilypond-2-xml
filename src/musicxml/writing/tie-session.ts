import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Event } from '../planning/events.js';
import { tieWaits } from '../notation/spans/ties.js';

export interface TiePlaybackStop {
  readonly key: string;
  readonly at: number;
  readonly cue: boolean;
  readonly acceptsStop?: boolean;
  readonly expireAcrossGap: boolean;
}

/** Owns pending links, their performed endpoints, and removable native sound nodes. */
export interface TiePlaybackSession {
  stop(input: TiePlaybackStop): { stopTie: boolean; stopSoundTie: boolean };
  start(key: string, voice: number, end: number, sound?: XMLBuilder): void;
  discardUnresolved(): boolean;
}

export function createTiePlaybackSession(events: readonly Event[]): TiePlaybackSession {
  const ties = new Set<string>();
  const ends = new Map<string, { voice: number; end: number }>();
  const sounds = new Map<string, XMLBuilder>();
  const forget = (key: string) => {
    ties.delete(key);
    ends.delete(key);
    sounds.delete(key);
  };

  return {
    stop({ key, at, cue, expireAcrossGap, acceptsStop = true }) {
      const pending = ends.get(key);

      if (
        expireAcrossGap &&
        pending &&
        at > pending.end &&
        !tieWaits(events, pending.voice, pending.end, at)
      ) {
        sounds.get(key)?.remove();
        forget(key);
      }

      const stopTie = acceptsStop && ties.has(key);
      const previousSound = stopTie ? sounds.get(key) : undefined;

      if (previousSound && cue) {
        previousSound.remove();
      }

      if (stopTie) {
        forget(key);
      }

      return { stopTie, stopSoundTie: !!previousSound && !cue };
    },
    start(key, voice, end, sound) {
      ties.add(key);
      ends.set(key, { voice, end });

      if (sound) {
        sounds.set(key, sound);
      }
    },
    discardUnresolved() {
      const unresolved = sounds.size > 0;

      for (const sound of sounds.values()) {
        sound.remove();
      }

      sounds.clear();
      ties.clear();
      ends.clear();

      return unresolved;
    },
  };
}
