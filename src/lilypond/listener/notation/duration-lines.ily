% Retain original DurationLines until the same translated layout has broken systems.
#(define xml-duration-originals '())
#(define xml-duration-count 0)
#(define (xml-clear-duration-lines!) (set! xml-duration-originals '()))
#(define (xml-reset-duration-lines!)
   (xml-clear-duration-lines!) (set! xml-duration-count 0))
#(define (xml-duration-bound grob)
   (if (not (ly:grob? grob)) #f
     (let* ((column (if (grob::has-interface grob 'paper-column-interface)
                        grob (ly:item-get-column grob)))
            (moment (and (ly:grob? column) (ly:grob-property column 'when #f)))
            (array (ly:grob-object grob 'note-heads #f))
            (heads (if (grob::has-interface grob 'note-head-interface) (list grob)
                       (if (ly:grob-array? array) (ly:grob-array->list array) '()))))
       (list (assoc-get 'name (ly:grob-property grob 'meta)) moment
         (list->vector (filter-map
           (lambda (head)
             (let ((cause (ly:grob-property head 'cause)))
               (and (ly:stream-event? cause) (ly:event-property cause 'ed-note-id #f)))) heads))))))
#(define (xml-duration-engraver ctx)
   (make-engraver
     (acknowledgers
       ((duration-line-interface engraver grob source)
        (when (eq? ctx (ly:translator-context source))
          (set! xml-duration-count (+ xml-duration-count 1))
          (xml-geometry-observe-root! ctx)
          (set! xml-duration-originals
            (cons (list grob xml-duration-count (ed-context-id ctx)
                        (ed-context-id (xml-script-staff ctx))
                        (ly:context-current-moment ctx)
                        (xml-bracket-stencil grob)
                        (ly:grob-property-data grob 'after-line-breaking))
                  xml-duration-originals)))))))
#(define (xml-final-duration-lines)
   (append-map
     (lambda (entry)
       (let ((piece 0))
         (map
           (lambda (grob)
             (set! piece (+ piece 1))
             (let* ((left (xml-duration-bound (ly:spanner-bound grob LEFT #f)))
                    (right (xml-duration-bound (ly:spanner-bound grob RIGHT #f)))
                    (start (and left (cadr left))) (end (and right (cadr right)))
                    (moment (if (ly:moment? start) start (list-ref entry 4)))
                    (raw (list-ref entry 5)) (after (list-ref entry 6))
                    (standard (or (eq? raw #f) (eq? raw duration-line::print)))
                    (custom (or (not standard)
                      (not (or (eq? after #f) (null? after)
                               (eq? after ly:spanner::kill-zero-spanned-time)))))
                    (stencil (ly:grob-property grob 'stencil #f))
                    (style (ly:grob-property grob 'style 'beam))
                    (geometry (if (and standard (grob::is-live? grob) (ly:stencil? stencil))
                      (catch #t (lambda () (duration-line::calc grob)) (lambda args '())) '()))
                    (system (ly:grob-system grob))
                    (staff (xml-geometry-unique-staff system (list-ref entry 3)))
                    (positions (and staff (ly:grob-property staff 'line-positions '())))
                    (space (assoc-get 'staff-space geometry #f))
                    (layout-space (ly:output-def-lookup (ly:grob-layout grob) 'staff-space #f))
                    (top (and staff (pair? positions) (every number? positions)
                      (+ (ly:grob-relative-coordinate staff system Y) (xml-geometry-render-extra staff Y)
                        (* 0.5 (ly:staff-symbol-staff-space staff) (apply max positions)))))
                    (y (assoc-get 'y geometry #f))
                    (details (ly:grob-property grob 'details '()))
                    (right-info (ly:grob-property grob 'right-bound-info '())))
               `((k . durationline) (id . ,(cadr entry)) (piece . ,piece)
                 (voice . ,(caddr entry)) (s . ,(list-ref entry 3))
                 (m . ,(ly:moment-main moment)) (g . ,(ly:moment-grace moment))
                 (resolved-start . ,(ly:moment? start))
                 (end-m . ,(if (ly:moment? end) (ly:moment-main end) 'null))
                 (end-g . ,(if (ly:moment? end) (ly:moment-grace end) 'null))
                 (left-kind . ,(if left (car left) 'null))
                 (from-notes . ,(if left (caddr left) #()))
                 (right-kind . ,(if right (car right) 'null))
                 (to-notes . ,(if right (caddr right) #()))
                 (style . ,(ed-value style)) (end-style . ,(ed-value (assoc-get 'end-style right-info #f)))
                 (color . ,(xml-color (ly:grob-property grob 'color #f)))
                 (hidden . ,(or (eq? raw #f) (not (grob::is-live? grob))
                   (eq? (ly:grob-property grob 'transparent #f) #t) (eq? style 'none)
                   (not (ly:stencil? stencil))
                   (and (ly:stencil? stencil) (ly:stencil-empty? stencil))))
                 (custom . ,custom)
                 (y-tenths . ,(if (and top (number? y) (number? space)
                   (number? layout-space) (> layout-space 0) (ly:grob? system))
                   (* 10 (/ (- (+ (ly:grob-relative-coordinate grob system Y)
                     (* y space) (xml-geometry-render-extra grob Y)) top) layout-space)) 'null))
                 (staff-space . ,(or space 'null))
                 (layout-staff-space . ,(or layout-space 'null))
                 (thickness . ,(assoc-get 'thick geometry 'null))
                 (extra-offset . ,(xml-bracket-pair grob 'extra-offset '(0 . 0)))
                 (hook-direction . ,(assoc-get 'hook-direction details 1))
                 (hook-height . ,(assoc-get 'hook-height details 0.34))
                 (dash-fraction . ,(ly:grob-property grob 'dash-fraction 0.4))
                 (dash-period . ,(ly:grob-property grob 'dash-period 1)))) )
           (xml-geometry-broken-pieces (car entry)))))
     (reverse xml-duration-originals)))
\layout {
  \context { \Voice \consists #xml-duration-engraver }
  \context { \CueVoice \consists #xml-duration-engraver }
  \context { \DrumVoice \consists #xml-duration-engraver }
  \context { \TabVoice \consists #xml-duration-engraver }
  \context { \Staff \consists #xml-duration-engraver }
  \context { \DrumStaff \consists #xml-duration-engraver }
  \context { \TabStaff \consists #xml-duration-engraver }
  \context { \RhythmicStaff \consists #xml-duration-engraver }
}

% Score lifecycle owned by this collector.
#(xml-define-collector-state duration-lines layout
 (xml-duration-originals xml-duration-count)
 (reset (xml-reset-duration-lines!))
 (clear (xml-clear-duration-lines!)))
