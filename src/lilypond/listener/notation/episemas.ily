% Actual surviving chant episema lines; no tenuto/articulation substitution.
#(define xml-episema-originals '())
#(define xml-episema-count 0)
#(define (xml-clear-episemas!) (set! xml-episema-originals '()))
#(define (xml-reset-episemas!)
   (xml-clear-episemas!) (set! xml-episema-count 0))
#(define (xml-episema-engraver ctx)
   (make-engraver
     (acknowledgers
       ((episema-interface engraver grob source)
        (when (eq? ctx (ly:translator-context source))
          (set! xml-episema-count (+ xml-episema-count 1))
          (xml-geometry-observe-root! ctx)
          (set! xml-episema-originals
            (cons (list grob xml-episema-count (ed-context-id ctx)
                        (ed-context-id (xml-script-staff ctx)) (ly:context-current-moment ctx)
                        (xml-bracket-stencil grob) (ly:grob-property-data grob 'after-line-breaking))
                  xml-episema-originals)))))
     ((stop-translation-timestep engraver)
      (xml-observe-line-measure! ctx))))

#(define (xml-final-episemas)
   (append-map
     (lambda (entry)
       (let ((piece 0))
         (map (lambda (grob)
           (set! piece (+ piece 1))
           (let* ((left (xml-duration-bound (ly:spanner-bound grob LEFT #f)))
                  (right (xml-duration-bound (ly:spanner-bound grob RIGHT #f)))
                  (start (and left (cadr left))) (end (and right (cadr right)))
                  (moment (if (ly:moment? start) start (list-ref entry 4)))
                  (raw (list-ref entry 5)) (after (list-ref entry 6))
                  (stencil (ly:grob-property grob 'stencil #f))
                  (live (and (grob::is-live? grob) (ly:stencil? stencil)))
                  (standard (or (eq? raw #f) (eq? raw ly:line-spanner::print)))
                  (info (if (and live standard)
                    (list (ly:grob-property grob 'left-bound-info '())
                          (ly:grob-property grob 'right-bound-info '())) '()))
                  (decorated (any (lambda (edge)
                    (or (assoc-get 'stencil edge #f) (assoc-get 'arrow edge #f))) info))
                  (custom (or (not standard) decorated
                    (not (or (eq? after #f) (null? after)))))
                  (system (ly:grob-system grob))
                  (points (and (not custom) live
                    (xml-line-points (ly:stencil-expr stencil) 0 0)))
                  (layout-space (ly:output-def-lookup (ly:grob-layout grob) 'staff-space #f))
                  (scale (and (number? layout-space) (> layout-space 0) (/ 10 layout-space)))
                  (staff (xml-geometry-unique-staff system (list-ref entry 3)))
                  (top (xml-geometry-staff-top staff system))
                  (origins (list (xml-line-origin system start (list-ref entry 3))
                                 (xml-line-origin system end (list-ref entry 3))))
                  (x (if (and points scale (ly:grob? system))
                    (map (lambda (point origin) (if origin (* scale
                      (- (+ (car point) (ly:grob-relative-coordinate grob system X)
                            (xml-geometry-render-extra grob X))
                         (ly:grob-relative-coordinate (car origin) system X))) 'null)) points origins)
                    '(null null)))
                  (y (if (and points scale top (ly:grob? system))
                    (map (lambda (point) (* scale (- (+ (cdr point)
                      (ly:grob-relative-coordinate grob system Y) (xml-geometry-render-extra grob Y)) top))) points)
                    '(null null))))
             `((k . episema) (id . ,(cadr entry)) (piece . ,piece)
               (voice . ,(caddr entry)) (s . ,(list-ref entry 3))
               (m . ,(ly:moment-main moment)) (g . ,(ly:moment-grace moment))
               (resolved-start . ,(ly:moment? start))
               (end-m . ,(if (ly:moment? end) (ly:moment-main end) 'null))
               (end-g . ,(if (ly:moment? end) (ly:moment-grace end) 'null))
               (left-kind . ,(if left (car left) 'null)) (right-kind . ,(if right (car right) 'null))
               (from-notes . ,(if left (caddr left) #())) (to-notes . ,(if right (caddr right) #()))
               (style . ,(ed-value (ly:grob-property grob 'style 'line)))
               (color . ,(xml-color (ly:grob-property grob 'color #f)))
               (hidden . ,(or (eq? raw #f) (not live)
                 (eq? (ly:grob-property grob 'transparent #f) #t)
                 (and (ly:stencil? stencil) (ly:stencil-empty? stencil))))
               (custom . ,(if custom #t #f))
               (x-tenths . ,(list->vector x)) (y-tenths . ,(list->vector y))
               (x-ref-m . ,(list->vector (map (lambda (o) (if o (ly:moment-main (cdr o)) 'null)) origins)))
               (x-ref-g . ,(list->vector (map (lambda (o) (if o (ly:moment-grace (cdr o)) 'null)) origins)))
               (staff-space . ,(ly:staff-symbol-staff-space grob))
               (layout-staff-space . ,(or layout-space 'null))
               (dash-fraction . ,(ly:grob-property grob 'dash-fraction .4))
               (dash-period . ,(ly:grob-property grob 'dash-period 1)))))
           (xml-geometry-broken-pieces (car entry)))))
     (reverse xml-episema-originals)))
\layout {
  \context { \Voice \consists #xml-episema-engraver }
  \context { \CueVoice \consists #xml-episema-engraver }
  \context { \DrumVoice \consists #xml-episema-engraver }
  \context { \TabVoice \consists #xml-episema-engraver }
  \context { \VaticanaVoice \consists #xml-episema-engraver }
  \context { \MensuralVoice \consists #xml-episema-engraver }
}

% Score lifecycle owned by this collector.
#(xml-define-collector-state episemas layout
 (xml-episema-originals xml-episema-count)
 (reset (xml-reset-episemas!))
 (clear (xml-clear-episemas!)))
