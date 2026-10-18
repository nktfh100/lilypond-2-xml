export const durationTypeNames = [
  'whole',
  'half',
  'quarter',
  'eighth',
  '16th',
  '32nd',
  '64th',
  '128th',
  '256th',
  '512th',
  '1024th',
];

export const notationDuration = (n: number) => {
  for (let log = -3; log <= 10; log++) {
    for (let dots = 0; dots <= 3; dots++) {
      if (Math.abs(2 ** -log * (2 - 2 ** -dots) - n) < 1e-10) {
        return { log, dots };
      }
    }
  }
};
