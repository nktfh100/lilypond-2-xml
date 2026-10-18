import type { TextMarkup } from '../../model/document.js';

// CSS names as interpreted by LilyPond 2.26.0 scm/color.scm.
const namedColors: Readonly<Record<string, string>> = {
  aliceblue: '#F0F8FF',
  antiquewhite: '#FAEBD7',
  aquamarine: '#7FFFD4',
  azure: '#F0FFFF',
  beige: '#F5F5DC',
  bisque: '#FFE4C4',
  black: '#000000',
  blanchedalmond: '#FFEBCD',
  blue: '#0000FF',
  blueviolet: '#8A2BE2',
  brown: '#A52A2A',
  burlywood: '#DEB887',
  cadetblue: '#5F9EA0',
  chartreuse: '#7FFF00',
  chocolate: '#D2691E',
  coral: '#FF7F50',
  cornflowerblue: '#6495ED',
  cornsilk: '#FFF8DC',
  cyan: '#00FFFF',
  darkblue: '#00008B',
  darkcyan: '#008B8B',
  darkgoldenrod: '#B8860B',
  darkgray: '#A9A9A9',
  darkgreen: '#006400',
  darkgrey: '#A9A9A9',
  darkkhaki: '#BDB76B',
  darkmagenta: '#8B008B',
  darkolivegreen: '#556B2F',
  darkorange: '#FF8C00',
  darkorchid: '#9932CC',
  darkred: '#8B0000',
  darksalmon: '#E9967A',
  darkseagreen: '#8FBC8F',
  darkslateblue: '#483D8B',
  darkslategray: '#2F4F4F',
  darkslategrey: '#2F4F4F',
  darkturquoise: '#00CED1',
  darkviolet: '#9400D3',
  deeppink: '#FF1493',
  deepskyblue: '#00BFFF',
  dimgray: '#696969',
  dimgrey: '#696969',
  dodgerblue: '#1E90FF',
  firebrick: '#B22222',
  floralwhite: '#FFFAF0',
  forestgreen: '#228B22',
  gainsboro: '#DCDCDC',
  ghostwhite: '#F8F8FF',
  gold: '#FFD700',
  goldenrod: '#DAA520',
  greenyellow: '#ADFF2F',
  honeydew: '#F0FFF0',
  hotpink: '#FF69B4',
  indianred: '#CD5C5C',
  ivory: '#FFFFF0',
  khaki: '#F0E68C',
  lavender: '#E6E6FA',
  lavenderblush: '#FFF0F5',
  lawngreen: '#7CFC00',
  lemonchiffon: '#FFFACD',
  lightblue: '#ADD8E6',
  lightcoral: '#F08080',
  lightcyan: '#E0FFFF',
  lightgoldenrodyellow: '#FAFAD2',
  lightgray: '#D3D3D3',
  lightgreen: '#90EE90',
  lightgrey: '#D3D3D3',
  lightpink: '#FFB6C1',
  lightsalmon: '#FFA07A',
  lightseagreen: '#20B2AA',
  lightskyblue: '#87CEFA',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  lightsteelblue: '#B0C4DE',
  lightyellow: '#FFFFE0',
  limegreen: '#32CD32',
  linen: '#FAF0E6',
  magenta: '#FF00FF',
  mediumaquamarine: '#66CDAA',
  mediumblue: '#0000CD',
  mediumorchid: '#BA55D3',
  mediumpurple: '#9370DB',
  mediumseagreen: '#3CB371',
  mediumslateblue: '#7B68EE',
  mediumspringgreen: '#00FA9A',
  mediumturquoise: '#48D1CC',
  mediumvioletred: '#C71585',
  midnightblue: '#191970',
  mintcream: '#F5FFFA',
  mistyrose: '#FFE4E1',
  moccasin: '#FFE4B5',
  navajowhite: '#FFDEAD',
  navy: '#000080',
  oldlace: '#FDF5E6',
  olivedrab: '#6B8E23',
  orange: '#FFA500',
  orangered: '#FF4500',
  orchid: '#DA70D6',
  palegoldenrod: '#EEE8AA',
  palegreen: '#98FB98',
  paleturquoise: '#AFEEEE',
  palevioletred: '#DB7093',
  papayawhip: '#FFEFD5',
  peachpuff: '#FFDAB9',
  peru: '#CD853F',
  pink: '#FFC0CB',
  plum: '#DDA0DD',
  powderblue: '#B0E0E6',
  red: '#FF0000',
  rosybrown: '#BC8F8F',
  royalblue: '#4169E1',
  saddlebrown: '#8B4513',
  salmon: '#FA8072',
  sandybrown: '#F4A460',
  seagreen: '#2E8B57',
  seashell: '#FFF5EE',
  sienna: '#A0522D',
  skyblue: '#87CEEB',
  slateblue: '#6A5ACD',
  slategray: '#708090',
  slategrey: '#708090',
  snow: '#FFFAFA',
  springgreen: '#00FF7F',
  steelblue: '#4682B4',
  tan: '#D2B48C',
  thistle: '#D8BFD8',
  tomato: '#FF6347',
  turquoise: '#40E0D0',
  violet: '#EE82EE',
  wheat: '#F5DEB3',
  white: '#FFFFFF',
  whitesmoke: '#F5F5F5',
  yellow: '#FFFF00',
  yellowgreen: '#9ACD32',
  gray: '#808080',
  green: '#008000',
  grey: '#808080',
  maroon: '#800000',
  purple: '#800080',
  aqua: '#00FFFF',
  crimson: '#DCC83C',
  fuchsia: '#FF00FF',
  indigo: '#4B0082',
  lime: '#00FF00',
  olive: '#808000',
  rebeccapurple: '#663399',
  silver: '#C0C0C0',
  teal: '#008080',
};

/** Native MusicXML uses ARGB; source color arrays remain RGBA. */
export function musicXMLColor(color: readonly number[] | null) {
  if (
    !Array.isArray(color) ||
    ![3, 4].includes(color.length) ||
    Array.from(color).some((v) => !Number.isFinite(v) || v < 0 || v > 1)
  ) {
    return undefined;
  }

  const bytes = color.map((v) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase(),
  );
  const alpha = bytes[3] ?? 'FF',
    rgb = bytes.slice(0, 3).join('');

  if (alpha === '00') {
    return '#00000000';
  }

  return '#' + (alpha === 'FF' ? '' : alpha) + rgb;
}

export function isTransparentColor(value: unknown): boolean {
  return typeof value === 'string' && /^#00[0-9a-f]{6}$/i.test(value);
}

export function markupNumber(value: TextMarkup | undefined) {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value !== 'string') {
    return NaN;
  }

  const pair = value.split('/');

  return pair.length === 2 ? Number(pair[0]) / Number(pair[1]) : Number(value);
}

export function markupColor(value: TextMarkup | undefined) {
  if (typeof value === 'string') {
    if (/^#[0-9a-f]{3,4}$/i.test(value)) {
      value =
        '#' +
        value
          .slice(1)
          .split('')
          .map((s) => s + s)
          .join('');
    }

    if (/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)) {
      // Hex strings in LilyPond markup are CSS RGB/RGBA, not native ARGB.
      const hex = value.slice(1);

      return musicXMLColor((hex.match(/../g) ?? []).map((byte) => parseInt(byte, 16) / 255));
    }

    const name = value.toLowerCase().replaceAll(' ', '');

    return Object.hasOwn(namedColors, name) ? namedColors[name] : undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const components = value.map(markupNumber);

  if (components.length === 4 && components[3] === 1) {
    components.pop();
  }

  return musicXMLColor(components);
}
