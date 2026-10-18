% Optional passage delimiters are independent Items, never an inferred span.
#(define xml-optional-material-originals '())
#(define xml-optional-material-count 0)
#(define (xml-clear-optional-material!) (set! xml-optional-material-originals '()))
#(define (xml-reset-optional-material!)
   (xml-clear-optional-material!) (set! xml-optional-material-count 0))
% Exact standard Lookup::round_filled_box operands, preserving final translations.
#(define (xml-optional-material-boxes expr dx dy)
   (cond
    ((and (list? expr) (= (length expr) 3) (eq? (car expr) 'translate-stencil)
          (pair? (cadr expr)) (number? (caadr expr)) (number? (cdadr expr)))
     (xml-optional-material-boxes (caddr expr) (+ dx (caadr expr)) (+ dy (cdadr expr))))
    ((and (list? expr) (= (length expr) 6) (eq? (car expr) 'round-filled-box)
          (every number? (cdr expr)))
     (list (list (- dx (list-ref expr 1)) (+ dx (list-ref expr 2))
                 (- dy (list-ref expr 3)) (+ dy (list-ref expr 4)) (list-ref expr 5))))
    ((and (list? expr) (eq? (car expr) 'combine-stencil))
     (let ((parts (map (lambda (child) (xml-optional-material-boxes child dx dy)) (cdr expr))))
       (and (every list? parts) (apply append parts))))
    (else #f)))
#(define (xml-optional-material-engraver ctx)
   (make-engraver
    (acknowledgers
     ((optional-material-bracket-interface engraver grob source)
      (when (and (eq? ctx (ly:translator-context source))
                 (eq? (assoc-get 'name (ly:grob-property grob 'meta)) 'OptionalMaterialBracket))
        (set! xml-optional-material-count (+ 1 xml-optional-material-count))
        (xml-geometry-observe-root! ctx)
        (set! xml-optional-material-originals
          (cons (list grob xml-optional-material-count (ed-context-id ctx)
                      (ed-context-id (xml-script-staff ctx)) (ly:context-current-moment ctx)
                      (xml-bracket-stencil grob) (ly:grob-property-data grob 'after-line-breaking)
                      (ly:grob-property grob 'passage-direction 0))
                xml-optional-material-originals)))))
    ((stop-translation-timestep engraver)
     (xml-observe-line-measure! ctx))))

#(define (xml-final-optional-material)
   (let ((systems (if (ly:grob? xml-geometry-root-system) (xml-geometry-broken-pieces xml-geometry-root-system) '())))
     (append-map
      (lambda (entry)
       (let ((piece 0))
        (append-map
         (lambda (system)
          (let* ((array (ly:grob-object system 'all-elements))
                 (elements (if (ly:grob-array? array) (ly:grob-array->list array) '()))
                 (items (delete-duplicates (filter (lambda (grob)
                   (and (eq? (ly:grob-system grob) system)
                        (or (eq? grob (car entry)) (eq? (ly:grob-original grob) (car entry))))) elements))))
           (map (lambda (grob)
             (set! piece (+ 1 piece))
             (let* ((moment (list-ref entry 4)) (raw (list-ref entry 5)) (after (list-ref entry 6))
                    (stencil (ly:grob-property grob 'stencil #f))
                    (live (and (grob::is-live? grob) (ly:stencil? stencil)))
                    (standard (or (eq? raw #f) (eq? raw ly:chord-bracket::print)))
                    (custom (or (not standard) (not (or (eq? after #f) (null? after)))))
                    (boxes (and live standard (not custom)
                      (xml-optional-material-boxes (ly:stencil-expr stencil) 0 0)))
                    (space (ly:output-def-lookup (ly:grob-layout grob) 'staff-space #f))
                    (scale (and (number? space) (> space 0) (/ 10 space)))
                    (origin (xml-line-origin system moment (list-ref entry 3)))
                    (staff (xml-geometry-unique-staff system (list-ref entry 3)))
                    (top (xml-geometry-staff-top staff system))
                    (x (and origin (- (+ (ly:grob-relative-coordinate grob system X)
                        (xml-geometry-render-extra grob X)) (ly:grob-relative-coordinate (car origin) system X))))
                    (y (and top (- (+ (ly:grob-relative-coordinate grob system Y)
                        (xml-geometry-render-extra grob Y)) top))))
               `((k . optional-material) (id . ,(cadr entry)) (piece . ,piece)
                 (context . ,(caddr entry)) (s . ,(list-ref entry 3))
                 (m . ,(ly:moment-main moment)) (g . ,(ly:moment-grace moment))
                 (passage-direction . ,(list-ref entry 7))
                 (rectangles . ,(if (and boxes scale x y)
                   (list->vector (map (lambda (box) (list->vector
                     (list (* scale (+ x (list-ref box 0))) (* scale (+ x (list-ref box 1)))
                           (* scale (+ y (list-ref box 2))) (* scale (+ y (list-ref box 3)))
                           (* scale (list-ref box 4))))) boxes)) 'null))
                 (x-ref-m . ,(if origin (ly:moment-main (cdr origin)) 'null))
                 (x-ref-g . ,(if origin (ly:moment-grace (cdr origin)) 'null))
                 (staff-space . ,(ly:staff-symbol-staff-space grob)) (layout-staff-space . ,(or space 'null))
                 (color . ,(xml-color (ly:grob-property grob 'color #f)))
                 (hidden . ,(or (eq? raw #f) (not live) (eq? (ly:grob-property grob 'transparent #f) #t)
                               (and (ly:stencil? stencil) (ly:stencil-empty? stencil))))
                 (custom . ,(if custom #t #f))))) items))) systems)))
      (reverse xml-optional-material-originals))))
\layout {
  \context { \Staff \consists #xml-optional-material-engraver }
  \context { \DrumStaff \consists #xml-optional-material-engraver }
  \context { \RhythmicStaff \consists #xml-optional-material-engraver }
  \context { \TabStaff \consists #xml-optional-material-engraver }
}

% Score lifecycle owned by this collector.
#(xml-define-collector-state optional-material layout
 (xml-optional-material-originals xml-optional-material-count)
 (reset (xml-reset-optional-material!))
 (clear (xml-clear-optional-material!)))
