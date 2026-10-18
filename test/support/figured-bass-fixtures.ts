/** Valid custom engravers exercise final attachment independently of row ownership. */
export function lateFigureSource(
  parent: 'none' | 'column' | 'spanner',
  finalize = false,
  extraNotes = false,
) {
  const attach =
    parent === 'column'
      ? '(ly:grob-set-parent! grob X column)'
      : parent === 'spanner'
        ? String.raw`(let ((span (ly:engraver-make-grob engraver 'TextSpanner event)))
    (ly:grob-set-property! span 'stencil #f)
    (ly:spanner-set-bound! span LEFT column) (ly:spanner-set-bound! span RIGHT column)
    (ly:grob-set-parent! grob X span))`
        : '';

  return String.raw`\score { \new Staff \with { \remove Figured_bass_engraver
    \consists #(lambda (ctx) (let ((pending '()) (created '()))
      (make-engraver
        (listeners ((bass-figure-event engraver event) (set! pending (cons event pending))))
        ((stop-translation-timestep engraver)
          (for-each (lambda (event)
            (let ((grob (ly:engraver-make-grob engraver 'BassFigure event))
                  (column (ly:context-property ctx 'currentMusicalColumn)))
              (ly:grob-set-property! grob 'text "LateLabel")
              (set! created (cons (cons grob column) created))
              ${finalize ? '' : attach})) pending)
          (set! pending '()))
        ((finalize engraver)
          (for-each (lambda (entry) (let ((grob (car entry)) (column (cdr entry)))
            ${finalize ? attach : '#f'})) created))))) }
    << { \tempo 4 = 120 c1 ${extraNotes ? 'd1' : ''} } \figuremode { <6+>1 } >> \layout {} \midi {} }`;
}

export function retimedFigureSource(
  moves: readonly (readonly [number, number | string])[],
  notes = 'c1 d1',
  figures = '<6+>1',
) {
  const targets = moves.map(([figure, at]) => `(${figure} . ${at})`).join(' ');

  return String.raw`\score { \new Staff \with { \remove Figured_bass_engraver
    \consists #(lambda (ctx) (let ((pending '()) (created '()) (columns '()))
      (make-engraver
        (listeners ((bass-figure-event engraver event) (set! pending (cons event pending))))
        ((stop-translation-timestep engraver)
          (let ((column (ly:context-property ctx 'currentMusicalColumn)))
            (set! columns (cons (cons (ly:moment-main (ly:context-current-moment ctx)) column) columns))
            (for-each (lambda (event)
              (let ((grob (ly:engraver-make-grob engraver 'BassFigure event)))
                (ly:grob-set-property! grob 'text (format #f "Figure~a" (ly:event-property event 'figure)))
                (ly:grob-set-parent! grob X column)
                (set! created (cons grob created)))) pending))
          (set! pending '()))
        ((finalize engraver)
          (for-each (lambda (grob)
            (let* ((number (ly:event-property (ly:grob-property grob 'cause) 'figure))
                   (target (assoc-get number '(${targets}) #f))
                   (column (and target (assoc-get target columns #f))))
              (when column (ly:grob-set-parent! grob X column)))) created))))) }
    << { \tempo 4 = 120 ${notes} } \figuremode { ${figures} } >> \layout {} \midi {} }`;
}
