import { convert } from 'lilypond-2-xml';
const result = await convert("{c'1}");

for (const score of result.scores) {
  score.document.durationLinesCaptured satisfies boolean | undefined;
  score.document.clustersCaptured satisfies boolean | undefined;
  score.document.ligaturesCaptured satisfies boolean | undefined;
  score.document.fingerGlidesCaptured satisfies boolean | undefined;
  score.document.episemasCaptured satisfies boolean | undefined;
  score.document.optionalMaterialCaptured satisfies boolean | undefined;
  score.document.bendsCaptured satisfies boolean | undefined;
  score.document.measureCountersCaptured satisfies boolean | undefined;
  score.document.footnotesCaptured satisfies boolean | undefined;
  score.document.lyricExtendersCaptured satisfies boolean | undefined;
  score.document.headerScopes satisfies import('lilypond-2-xml').HeaderScopes | undefined;
  score.document.headerScopes?.bookStart satisfies boolean | undefined;
  score.document.headerScopes?.printAllHeaders satisfies boolean | undefined;
  score.document.headerScopes?.book.title satisfies import('lilypond-2-xml').TextMarkup | undefined;

  for (const event of score.document.events) {
    if (event.kind === 'arpeggio') {
      event.noteIds satisfies readonly number[];
      event.context satisfies number;
      event.style satisfies 'normal' | 'bracket' | 'parenthesis';
      event.positions satisfies readonly [number, number] | null;
      event.hidden satisfies boolean;
    }

    if (event.kind === 'script') {
      event.glyphMissing satisfies boolean | undefined;
      event.fontPoints satisfies number | null | undefined;
      event.breathSign satisfies boolean | undefined;
      event.id satisfies number;
      event.axis satisfies number;
      event.staffPosition satisfies number | null;
      event.glyph satisfies string;
    }

    if (event.kind === 'noteSize') {
      event.noteId satisfies number | null;
      event.fontSize satisfies number;
      event.stemFontSize satisfies number | null;
    }

    if (event.kind === 'instrumentName') {
      event.nameId satisfies number | undefined;
      event.context satisfies number;
      event.markup satisfies import('lilypond-2-xml').TextMarkup | null;
      event.shortText satisfies string;
    }

    if (event.kind === 'instrumentLabelPiece') {
      event.musicFonts?.[0]?.textPoints satisfies number | undefined;
      event.musicFonts?.[0]?.musicPoints satisfies number | undefined;
    }

    if (event.kind === 'ligature') {
      event.name satisfies string;
      event.fromNotes satisfies readonly number[];
      event.yTenths satisfies readonly [number, number] | null;
      event.edges satisfies readonly [number, number];
      event.connect satisfies readonly [boolean, boolean];
    }

    if (event.kind === 'bendGraphic') {
      event.quarterDifference satisfies number | null;
      event.fromHeads satisfies readonly import('lilypond-2-xml').BendHeadState[];
      event.toHeads[0]?.stemHidden satisfies boolean | null | undefined;
      event.dashSettings satisfies readonly [number, number, number] | null;
    }

    if (event.kind === 'measureCounter') {
      event.text satisfies string | null;
      event.fontEncoding satisfies 'fetaText' | 'latin1' | null;
      event.xTenths satisfies number | null;
      event.fontContext?.reference satisfies number | undefined;
      event.musicFonts?.[0]?.musicPoints satisfies number | undefined;
    }

    if (event.kind === 'optionalMaterial') {
      event.context satisfies number;
      event.staff satisfies number;
      event.rectangles satisfies
        readonly (readonly [number, number, number, number, number])[] | null;
      event.xReference?.main.numerator satisfies number | undefined;
      event.passageDirection satisfies number;
    }

    if (event.kind === 'episema') {
      event.fromNotes satisfies readonly number[];
      event.xTenths satisfies readonly [number | null, number | null];
      event.xReference[0]?.main.numerator satisfies number | undefined;
    }

    if (event.kind === 'fingerGlide') {
      event.fromLabel?.noteIds satisfies readonly number[] | undefined;
      event.fromLabel?.text satisfies string | undefined;
      event.xTenths satisfies readonly [number | null, number | null];
      event.xReference[0]?.main.numerator satisfies number | undefined;
    }

    if (event.kind === 'clusterGraphic') {
      event.noteIds satisfies readonly number[];
      event.positions satisfies readonly [number, number] | null;
      event.style satisfies string | null;
    }

    if (event.kind === 'durationLine') {
      event.fromNotes satisfies readonly number[];
      event.toNotes satisfies readonly number[];
      event.yTenths satisfies number | null;
      event.layoutStaffSpace satisfies number | null;
      event.endStyle satisfies string | null;
      event.extraOffset satisfies readonly [number, number];
      event.piece satisfies number;
    }

    if (event.kind === 'staffLines') {
      event.positions satisfies readonly number[] | null | undefined;
      event.staffSpace satisfies number | undefined;
      event.layoutStaffSpace satisfies number | undefined;
      event.present satisfies boolean | undefined;
      event.color satisfies readonly number[] | null | undefined;
      event.lineWidth satisfies number | null | undefined;
    }

    if (event.kind === 'figuredBass') {
      event.figures[0]?.graphic satisfies boolean | undefined;
      event.figures[0]?.display satisfies import('lilypond-2-xml').TextMarkup | undefined;
      event.figures[0]?.continuation satisfies
        import('lilypond-2-xml').FigureContinuation | undefined;
      event.figures[0]?.continuation?.offset satisfies readonly [number, number] | undefined;
      event.figures[0]?.fontContext satisfies import('lilypond-2-xml').TextFontContext | undefined;
      event.figures[0]?.numberFontContext satisfies
        import('lilypond-2-xml').FigureNumberFontContext | undefined;
      event.figures[0]?.columnUsed satisfies boolean | undefined;
      event.figures[0]?.column satisfies
        import('lilypond-2-xml').FiguredBassEvent['moment'] | null | undefined;
      event.figures[0]?.color satisfies readonly number[] | null | undefined;
      event.figures[0]?.custom satisfies boolean | undefined;
      event.figures[0]?.extendTo satisfies number | null | undefined;
      event.figures[0]?.markup satisfies import('lilypond-2-xml').TextMarkup | null | undefined;
      event.staff satisfies number | null;
    }

    if (event.kind === 'label') {
      event satisfies import('lilypond-2-xml').LabelEvent;
      event.names satisfies readonly string[];
      event.columnMoment satisfies import('@sightread/lilypond-eventdocument').Moment | null;
      event.observedMoment satisfies import('@sightread/lilypond-eventdocument').Moment;
    }

    if (event.kind === 'combineText') {
      event satisfies import('lilypond-2-xml').CombineTextEvent;
      event.fontName satisfies string | null;
      event.direction satisfies number | null;
      event.fontContext satisfies import('lilypond-2-xml').TextFontContext | undefined;
      event.xReference satisfies import('@sightread/lilypond-eventdocument').Moment | null;
    }

    if (event.kind === 'vowelTransition') {
      event satisfies import('lilypond-2-xml').VowelTransitionEvent;
      event.xTenths satisfies readonly [number | null, number | null];
      event.fromLyricId satisfies number | null;
      event.toLyricMoment satisfies import('@sightread/lilypond-eventdocument').Moment | null;
    }

    if (event.kind === 'vowelTransitionRequest') {
      event satisfies import('lilypond-2-xml').VowelTransitionRequestEvent;
    }

    if (event.kind === 'footnote') {
      event satisfies import('lilypond-2-xml').FootnoteEvent;
      event.noteId satisfies number | null;
      event.body satisfies string | null;
      event.markerMarkup satisfies import('lilypond-2-xml').TextMarkup | undefined;
      event.automaticallyNumbered satisfies boolean;
      event.markerHidden satisfies boolean;
    }

    if (event.kind === 'lyricExtender') {
      event satisfies import('lilypond-2-xml').LyricExtenderEvent;
      event.headNotes satisfies readonly (number | null)[];
      event.toNotes satisfies readonly (number | null)[];
      event.lyricMoment satisfies import('@sightread/lilypond-eventdocument').Moment | null;
      event.staff satisfies number | null;
    }

    if (event.kind === 'notehead') {
      event.glyph satisfies string;
      event.direction satisfies number;
      event.custom satisfies boolean;
    }

    if (event.kind === 'script') {
      event.color satisfies readonly number[] | null | undefined;
      event.offset satisfies readonly [number, number] | undefined;
    }

    if (event.kind === 'note') {
      event.cluster satisfies boolean | undefined;
      event.quotedCue satisfies boolean | undefined;
      event.cue satisfies boolean | undefined;
      event.markup satisfies import('lilypond-2-xml').TextMarkup | undefined;
      event.attachments[0]?.markup satisfies import('lilypond-2-xml').TextMarkup | undefined;
      event.attachments.map((a) => a.markup);
      event.attachments[0]?.scriptId satisfies number | undefined;
    }
  }
}
