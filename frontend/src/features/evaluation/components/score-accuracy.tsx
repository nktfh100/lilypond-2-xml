import type { ScoreAccuracy as Accuracy } from '../types';

const percentage = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });

export function ScoreAccuracy({
  accuracy,
  pending,
}: {
  accuracy: Accuracy | undefined;
  pending: boolean;
}) {
  const metrics = [
    ['Notes', accuracy?.notes ?? null],
    ['Playback', accuracy?.playback ?? null],
  ] as const;

  return (
    <div className='accuracy-summary'>
      <h2>Conversion accuracy</h2>
      <dl className='score-accuracy' aria-label='Note and playback agreement'>
        {metrics.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd aria-label={pending ? 'Pending' : value === null ? 'Unavailable' : undefined}>
              {pending ? '…' : value === null ? '—' : `${percentage.format(value)}%`}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
