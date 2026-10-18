const noteGroups = [
  {
    codes: [
      'repeat-playback-scope',
      'repeat-playback-ownership',
      'repeat-count-data',
      'barline-repeat-ownership',
      'navigation',
      'navigation-coda',
      'cadenza-repeat',
      'percent-length',
      'percent-isolated',
      'percent-source',
    ],
    message:
      'Check repeats and endings. Some passages may play back in the wrong order or the wrong number of times.',
  },
  {
    codes: ['tie-anchor', 'tie-endpoints', 'tie-percent', 'tie-playback-unresolved'],
    message:
      'Some ties between notes could not be copied reliably. Check that tied notes stay connected and play for their full length.',
  },
  {
    codes: ['crossing-measure', 'tremolo-span', 'staff-timing-staves'],
    message:
      'Some rhythms or bar divisions could not be copied reliably. Compare the affected passages with the original.',
  },
  {
    codes: ['unpitched-mapping'],
    message:
      'Some percussion notes could not be placed correctly. Check them against the original.',
  },
  {
    codes: ['accidental-owner', 'accidental-ownership', 'accidental-capture'],
    message: 'Some sharp, flat or natural signs may be missing. Check them against the original.',
  },
  {
    codes: [
      'unmapped-event',
      'unmapped-attachment',
      'attachment',
      'articulation',
      'percussion-script',
      'breath-anchor',
      'breath-attachment',
      'bracket-endpoints',
      'cluster-history',
      'slur-anchor',
      'slur-endpoints',
      'slur-percent',
      'glissando-anchor',
      'glissando-endpoints',
      'glissando-percent',
      'bend-capture',
      'bend-history',
      'bend-stencil',
      'bend-endpoints',
      'bend-ownership',
      'bend-data',
      'duration-line-capture',
      'duration-line-history',
      'duration-line-stencil',
      'duration-line-endpoints',
      'duration-line-percent',
      'episema-capture',
      'episema-history',
      'episema-stencil',
      'episema-endpoints',
      'episema-percent',
      'finger-glide-capture',
      'finger-glide-history',
      'finger-glide-stencil',
      'finger-glide-endpoints',
      'finger-glide-ownership',
      'finger-glide-percent',
      'ligature-capture',
      'ligature-history',
      'ligature-historical',
      'ligature-slur',
      'ligature-stencil',
      'ligature-endpoints',
      'ligature-percent',
    ],
    message:
      'Some musical markings could not be copied reliably. Compare them with the original before using the converted score.',
  },
  {
    codes: [
      'lyric-extender-capture',
      'lyric-extender-owner',
      'lyric-extender-stencil',
      'lyric-extender-endpoints',
      'vowel-transition-capture',
      'vowel-transition-history',
      'vowel-transition-stencil',
      'vowel-transition-endpoints',
      'vowel-transition-owner',
    ],
    message:
      'Some lines connecting lyrics to notes may be missing or incomplete. Check where syllables continue across notes.',
  },
  {
    codes: ['tab-selection', 'tab-fret'],
    message:
      'Some tablature string or fret numbers could not be copied. Check the tablature against the original.',
  },
  {
    codes: [
      'figured-bass-anchor',
      'figured-bass-alteration',
      'figured-bass-extend',
      'figured-bass-symbol',
    ],
    message:
      'Some figured-bass symbols or continuation lines could not be copied reliably. Check the figures below the staff.',
  },
  {
    codes: ['footnote-owner', 'footnote-body', 'footnote-history'],
    message: 'Some footnotes could not be copied. Keep the original score for those annotations.',
  },
  {
    codes: ['combine-text-capture', 'measure-counter-capture', 'measure-counter-endpoints'],
    message:
      'Some playing instructions or bar-count labels may be missing. Check the text above the staff against the original.',
  },
  {
    codes: ['unsupported-text-stripped'],
    message:
      'Some text characters could not be copied. Check titles, lyrics and other text against the original.',
  },
];

export function conversionNotes(diagnostics: readonly { code: string }[]): string[] {
  const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));

  return noteGroups
    .filter((group) => group.codes.some((code) => codes.has(code)))
    .map((group) => group.message);
}
