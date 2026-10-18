const tiers = ['all', 'node', 'fast', 'compiler', 'native'] as const;

export function selectTests(
  files: readonly string[],
  tier: string,
  filters: readonly string[] = [],
) {
  if (!tiers.includes(tier as (typeof tiers)[number])) {
    throw new Error(`Unknown test tier: ${tier}`);
  }

  return files
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => file.endsWith('.test.ts'))
    .filter((file) => {
      const unit = file.startsWith('unit/');
      const native = file.startsWith('integration/native/');

      return (
        tier === 'all' ||
        (tier === 'node' && !native) ||
        (tier === 'fast' && unit) ||
        (tier === 'compiler' && !unit && !native) ||
        (tier === 'native' && native)
      );
    })
    .filter((file) => !filters.length || filters.some((filter) => `test/${file}`.includes(filter)))
    .sort();
}
