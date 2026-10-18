#(define xml-glissando-count 0)
#(define (xml-glissando-engraver ctx)
   (let ((grobs '()))
     (make-engraver
      (acknowledgers
       ((glissando-interface engraver grob source)
        (when (eq? ctx (ly:translator-context source))
          (set! grobs (cons (list grob (ly:context-current-moment ctx)) grobs)))))
      ((finalize engraver)
       (for-each
        (lambda (entry)
          (ed-guard 'glissando
            (lambda ()
              (let* ((grob (car entry)) (fallback (cadr entry))
                     (left (xml-bracket-bound-moment grob LEFT))
                     (right (xml-bracket-bound-moment grob RIGHT))
                     (stencil (xml-bracket-stencil grob))
                     (style (ly:grob-property grob 'style 'line))
                     (period (ly:grob-property grob 'dash-period 1))
                     (defaults (assoc-get 'Glissando all-grob-descriptions)))
                (set! xml-glissando-count (+ xml-glissando-count 1))
                (set! ed-events
                  (cons
                   `((k . glissando) (id . ,xml-glissando-count)
                     (v . ,(ed-context-id ctx)) (s . ,(xml-bracket-staff ctx))
                     (from . ,(xml-slur-bound-notes grob LEFT))
                     (to . ,(xml-slur-bound-notes grob RIGHT))
                     (resolved-start . ,(ly:moment? left))
                     (m . ,(ly:moment-main (if (ly:moment? left) left fallback)))
                     (g . ,(ly:moment-grace (if (ly:moment? left) left fallback)))
                     (end-m . ,(if (ly:moment? right) (ly:moment-main right) 'null))
                     (end-g . ,(if (ly:moment? right) (ly:moment-grace right) 'null))
                     (style . ,(symbol->string style))
                     (dash-fraction . ,(ly:grob-property grob 'dash-fraction 0.4))
                     (dash-period . ,period)
                     (color . ,(xml-color (ly:grob-property grob 'color #f)))
                     (offset . ,(xml-bracket-pair grob 'extra-offset '(0 . 0)))
                     (thickness . ,(ly:grob-property grob 'thickness 1))
                     (custom-bounds . ,(not (equal? (ly:grob-property-data grob 'bound-details) (assoc-get 'bound-details defaults))))
                     (hidden . ,(or (eq? stencil #f) (eq? style 'none)
                                    (and (memq style '(dashed-line dotted-line)) (<= period 0))
                                    (eq? (ly:grob-property grob 'transparent #f) #t)))
                     (custom . ,(not (or (eq? stencil #f) (eq? stencil ly:line-spanner::print)))))
                   ed-events))))))
        (reverse grobs))))))
\layout {
  \context { \Voice \consists #xml-glissando-engraver }
  \context { \CueVoice \consists #xml-glissando-engraver }
  \context { \DrumVoice \consists #xml-glissando-engraver }
  \context { \TabVoice \consists #xml-glissando-engraver }
}

% Score lifecycle owned by this collector.
#(xml-define-collector-state glissandi semantic
 (xml-glissando-count)
 (reset (set! xml-glissando-count 0))
 (clear ))
