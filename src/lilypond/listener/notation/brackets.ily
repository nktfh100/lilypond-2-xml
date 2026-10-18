#(define xml-bracket-count 0)
#(define (xml-bracket-staff ctx)
   (if (or (not (ly:context? (ly:context-parent ctx)))
           (memq (ly:context-name ctx) '(Staff DrumStaff TabStaff RhythmicStaff)))
       (ed-context-id ctx)
       (xml-bracket-staff (ly:context-parent ctx))))
#(define (xml-bracket-bound-moment grob side)
   (let* ((bound (ly:spanner-bound grob side #f))
          (column (and (ly:grob? bound) (ly:item-get-column bound))))
     (and (ly:grob? column) (ly:grob-property column 'when #f))))
#(define (xml-bracket-pair grob property fallback)
   (let ((pair (ly:grob-property grob property fallback)))
     (if (and (pair? pair) (number? (car pair)) (number? (cdr pair)))
         (vector (car pair) (cdr pair)) (vector (car fallback) (cdr fallback)))))
#(define (xml-bracket-stencil grob)
   (let ((stencil (ly:grob-property-data grob 'stencil)))
     (if (ly:unpure-pure-container? stencil)
         (ly:unpure-pure-container-unpure-part stencil) stencil)))
#(define (xml-bracket-engraver ctx)
   (let ((grobs '()))
     (define (remember grob source)
       (when (eq? ctx (ly:translator-context source))
         (set! grobs (cons (list grob (ly:context-current-moment ctx)) grobs))))
     (make-engraver
      (acknowledgers
       ((horizontal-bracket-interface engraver grob source) (remember grob source))
       ((measure-spanner-interface engraver grob source) (remember grob source)))
      ((finalize engraver)
       (for-each
        (lambda (entry)
          (ed-guard 'bracket
            (lambda ()
              (let* ((grob (car entry)) (fallback (cadr entry))
                     (measure? (grob::has-interface grob 'measure-spanner-interface))
                     (left (xml-bracket-bound-moment grob LEFT))
                     (right (xml-bracket-bound-moment grob RIGHT))
                     (text-grob (if measure? grob (ly:grob-object grob 'bracket-text)))
                     (text (if (ly:grob? text-grob) (ly:grob-property text-grob 'text "") ""))
                     (stencil (xml-bracket-stencil grob))
                     (text-stencil (and (ly:grob? text-grob) (xml-bracket-stencil text-grob))))
                (set! xml-bracket-count (+ xml-bracket-count 1))
                (set! ed-events
                  (cons
                   `((k . bracket) (id . ,xml-bracket-count)
                     (context . ,(ed-context-id ctx)) (s . ,(xml-bracket-staff ctx))
                     (kind . ,(if measure? 'measure 'analysis))
                     (resolved-start . ,(ly:moment? left))
                     (m . ,(ly:moment-main (if (ly:moment? left) left fallback)))
                     (g . ,(ly:moment-grace (if (ly:moment? left) left fallback)))
                     (end-m . ,(if (ly:moment? right) (ly:moment-main right) 'null))
                     (end-g . ,(if (ly:moment? right) (ly:moment-grace right) 'null))
                     (direction . ,(xml-grob-direction grob (if measure? UP DOWN)))
                     (edges . ,(xml-bracket-pair grob 'edge-height '(1 . 1)))
                     (flare . ,(xml-bracket-pair grob 'bracket-flare '(0 . 0)))
                     (shorten . ,(xml-bracket-pair grob 'shorten-pair '(0 . 0)))
                     (style . ,(ed-value (ly:grob-property grob 'style 'line)))
                     (dash-fraction . ,(ly:grob-property grob 'dash-fraction 0.4))
                     (dash-period . ,(ly:grob-property grob 'dash-period 1))
                     (color . ,(xml-color (ly:grob-property grob 'color #f)))
                     (text-color . ,(if (ly:grob? text-grob) (xml-color (ly:grob-property text-grob 'color #f)) #f))
                     (text-custom . ,(and (not measure?) text-stencil (not (eq? text-stencil ly:horizontal-bracket-text::print))))
                     (hidden . ,(or (eq? stencil #f) (eq? (ly:grob-property grob 'transparent #f) #t)
                                    (eq? (ly:grob-property grob 'style 'line) 'none)
                                    (and (memq (ly:grob-property grob 'style 'line) '(dashed-line dotted-line))
                                         (<= (ly:grob-property grob 'dash-period 1) 0))))
                     (custom . ,(not (or (eq? stencil #f) (eq? stencil (if measure? ly:measure-spanner::print ly:horizontal-bracket::print)))))
                     (text . ,(if (markup? text) (ed-markup->string text) ""))
                     (markup . ,(xml-markup-tree text))
                     (text-hidden . ,(or (not text-stencil) (eq? (ly:grob-property text-grob 'transparent #f) #t)))
                     (text-size . ,(if (ly:grob? text-grob) (ly:grob-property text-grob 'font-size 0) 0)))
                   ed-events))))))
        (reverse grobs))))))
\layout {
  \context { \Voice \consists #xml-bracket-engraver }
  \context { \CueVoice \consists #xml-bracket-engraver }
  \context { \DrumVoice \consists #xml-bracket-engraver }
  \context { \TabVoice \consists #xml-bracket-engraver }
  \context { \Staff \consists #xml-bracket-engraver }
  \context { \DrumStaff \consists #xml-bracket-engraver }
  \context { \TabStaff \consists #xml-bracket-engraver }
  \context { \RhythmicStaff \consists #xml-bracket-engraver }
}

% Score lifecycle owned by this collector.
#(xml-define-collector-state brackets semantic
 (xml-bracket-count)
 (reset (set! xml-bracket-count 0))
 (clear ))
