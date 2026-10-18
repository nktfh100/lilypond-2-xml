% Original spanners survive until the same score has final broken systems.
#(define xml-name-originals '())
#(define xml-name-ids (make-hash-table))
#(define xml-name-count 0)
#(define (xml-clear-name-pieces!)
   (set! xml-name-originals '())
   (set! xml-name-ids (make-hash-table)))
#(define (xml-reset-name-pieces!)
   (xml-clear-name-pieces!)
   (set! xml-name-count 0))
#(define (xml-retain-name-piece! ctx grob)
   (unless (hashq-ref xml-name-ids grob #f)
     (set! xml-name-count (+ xml-name-count 1))
     (hashq-set! xml-name-ids grob xml-name-count)
     (xml-geometry-observe-root! ctx)
     (set! xml-name-originals
       (cons (list xml-name-count (ed-context-id ctx) grob
                   (ly:grob-property-data grob 'stencil)
                   (ly:grob-property grob 'long-text "")
                   (ly:grob-property grob 'text "")
                   (ly:grob-property-data grob 'after-line-breaking))
             xml-name-originals))))
#(define (xml-name-font-context grob)
   (catch #t
     (lambda ()
       (let ((layout (ly:grob-layout grob)))
         (xml-text-font-context layout
           (ly:grob-alist-chain grob (ly:output-def-lookup layout 'text-font-defaults)))))
     (lambda args 'null)))
#(define (xml-name-music-fonts grob text)
   (catch #t
     (lambda ()
       (let* ((layout (ly:grob-layout grob))
              (reference (ly:output-def-lookup layout 'text-font-size 11))
              (root (ly:grob-alist-chain grob (ly:output-def-lookup layout 'text-font-defaults)))
              (fonts '()))
         (define (walk node props)
           (cond
             ((and (pair? node) (procedure? (car node)))
              (let* ((name (procedure-name (car node))) (args (cdr node))
                     (size (chain-assoc-get 'font-size props 0)))
                (define (at child step) (walk child (prepend-alist-chain 'font-size step props)))
                (case name
                  ((flat-markup sharp-markup natural-markup doubleflat-markup doublesharp-markup)
                   (let* ((font (ly:paper-get-font layout
                                  (cons '((font-encoding . fetaMusic) (font-name . #f)) props)))
                          (points (xml-font-points font layout)))
                     (when (number? points)
                       (set! fonts (cons `((text-size . ,(* reference (magstep size)))
                                           (music-size . ,points)) fonts)))))
                  ((fontsize-markup) (at (cadr args) (+ size (car args))))
                  ((smaller-markup larger-markup) (at (car args) (+ size (if (eq? name 'smaller-markup) -1 1))))
                  ((abs-fontsize-markup) (at (cadr args) (magnification->font-size (/ (car args) reference))))
                  ((magnify-markup) (at (cadr args) (magnification->font-size (car args))))
                  ((tiny-markup teeny-markup small-markup large-markup huge-markup normalsize-markup)
                   (at (car args) (assq-ref '((tiny-markup . -2) (teeny-markup . -3) (small-markup . -1)
                                           (large-markup . 1) (huge-markup . 2) (normalsize-markup . 0)) name)))
                  ((override-markup) (walk (cadr args) (prepend-props (car args) props)))
                  ((with-color-markup) (walk (cadr args) props))
                  ((bold-markup normal-weight-markup italic-markup upright-markup normal-text-markup
                    sans-markup roman-markup typewriter-markup transparent-markup underline-markup
                    box-markup circle-markup oval-markup line-markup concat-markup column-markup
                    left-column-markup center-column-markup right-column-markup
                    center-align-markup left-align-markup right-align-markup)
                   (for-each (lambda (child) (walk child props)) args)))))
             ((list? node) (for-each (lambda (child) (walk child props)) node))))
         (walk text root)
         (list->vector (delete-duplicates (reverse fonts)))))
     (lambda args 'null)))
#(define (xml-final-name-pieces)
   (let ((systems (if (ly:grob? xml-geometry-root-system)
                       (xml-geometry-broken-pieces xml-geometry-root-system) '())))
     (append-map
       (lambda (entry)
         (append-map
           (lambda (grob)
             (let* ((system (ly:grob-system grob))
                    (index (and (ly:grob? system) (list-index (lambda (s) (eq? s system)) systems))))
               (if (not index) '()
                 (let* ((left (ly:spanner-bound grob LEFT))
                        (right (ly:spanner-bound grob RIGHT))
                        (moment (ly:grob-property left 'when))
                        (end (ly:grob-property right 'when))
                        (long (moment<=? moment ZERO-MOMENT))
                        (text (ly:grob-property grob (if long 'long-text 'text)
                                (list-ref entry (if long 4 5))))
                        (color (xml-color (ly:grob-property grob 'color #f)))
                        (transparent (eq? (ly:grob-property grob 'transparent #f) #t))
                        (stencil (ly:grob-property grob 'stencil #f))
                        (live (and (ly:stencil? stencil)
                                   (not (and (ly:stencil-empty? stencil)
                                             (null? (ly:stencil-expr stencil))))
                                   (grob::is-live? grob)))
                        (layout (ly:grob-layout grob))
                        (space (ly:output-def-lookup layout 'staff-space #f))
                        (scale (ly:output-def-lookup layout 'output-scale #f))
                        (candidates
                          (filter
                            (lambda (staff)
                              (and (eq? (ly:grob-system staff) system)
                                   (equal? (ly:grob-property (ly:spanner-bound staff LEFT) 'when) moment)))
                            (append-map
                              (lambda (staff) (xml-geometry-broken-pieces (cdr staff)))
                              (filter (lambda (staff) (= (car staff) (cadr entry))) xml-geometry-staff-symbols))))
                        (staff (and (= (length candidates) 1) (car candidates)))
                        (positions (and staff (ly:grob-property staff 'line-positions '())))
                        (staff-space (and staff
                          (* (ly:grob-property staff 'staff-space 1)
                             (ly:output-def-lookup (ly:grob-layout staff) 'staff-space))))
                        (top (and staff (pair? positions) (every number? positions)
                               (+ (ly:grob-relative-coordinate staff system Y)
                                  (xml-geometry-render-extra staff Y)
                                  (* 0.5 staff-space (apply max positions)))))
                        (raw-stencil (list-ref entry 3))
                        (raw-after (list-ref entry 6)))
                   (list
                     `((k . namepiece) (m . ,(ly:moment-main moment)) (g . ,(ly:moment-grace moment))
                       (end-m . ,(ly:moment-main end)) (end-g . ,(ly:moment-grace end))
                       (context . ,(cadr entry)) (name-id . ,(car entry)) (system . ,(+ index 1))
                       (text . ,(ed-value text)) (markup . ,(if (markup? text) (xml-markup-tree text) 'null))
                       (color . ,color) (hidden . ,(or transparent (not live)))
                       (custom . ,(or
                         (not (or (eq? raw-stencil #f) (eq? raw-stencil system-start-text::print)))
                         (not (or (eq? raw-after #f) (null? raw-after)))))
                       (x . ,(if live
                               (- (+ (ly:grob-relative-coordinate grob system X)
                                     (xml-geometry-render-extra grob X))
                                  (ly:grob-relative-coordinate (ly:spanner-bound system LEFT) system X)) 'null))
                       (y . ,(if (and live top) (- (+ (ly:grob-relative-coordinate grob system Y)
                                                    (xml-geometry-render-extra grob Y)) top) 'null))
                       (staff-space . ,(ed-value (or staff-space space)))
                       (output-scale . ,(ed-value scale))
                       (music-fonts . ,(if live (xml-name-music-fonts grob text) 'null))
                       (font-context . ,(if live (xml-name-font-context grob) 'null))))))))
           (xml-geometry-broken-pieces (caddr entry))))
       (reverse xml-name-originals))))
#(define (xml-name-engraver ctx)
   (let ((items '()))
     (make-engraver
      (acknowledgers
       ((text-interface engraver item source-engraver)
        (when (and (eq? ctx (ly:translator-context source-engraver))
                   (eq? (assoc-get 'name (ly:grob-property item 'meta)) 'InstrumentName))
          (xml-retain-name-piece! ctx item)
          (set! items (cons item items)))))
      ((stop-translation-timestep engraver)
       (for-each
        (lambda (item)
          (let ((long (ly:grob-property item 'long-text ""))
                (short (ly:grob-property item 'text ""))
                (stencil (ly:grob-property-data item 'stencil)))
            (ed-push! ctx
              `((k . instrumentname) (context . ,(ed-context-id ctx))
                (name-id . ,(hashq-ref xml-name-ids item #f))
                (color . ,(xml-color (ly:grob-property item 'color #f)))
                (text . ,(ed-value long)) (short . ,(ed-value short))
                (markup . ,(if (markup? long) (xml-markup-tree long) 'null))
                (short-markup . ,(if (markup? short) (xml-markup-tree short) 'null))
                (hidden . ,(or (eq? stencil #f) (eq? (ly:grob-property item 'transparent #f) #t)))
                (custom . ,(not (or (eq? stencil #f) (eq? stencil system-start-text::print))))))))
        (reverse items))
       (set! items '())))))
\layout {
  \context { \Staff \consists #xml-name-engraver }
  \context { \DrumStaff \consists #xml-name-engraver }
  \context { \RhythmicStaff \consists #xml-name-engraver }
  \context { \TabStaff \consists #xml-name-engraver }
  \context { \StaffGroup \consists #xml-name-engraver }
  \context { \ChoirStaff \consists #xml-name-engraver }
  \context { \PianoStaff \consists #xml-name-engraver }
  \context { \GrandStaff \consists #xml-name-engraver }
  \context { \ChordNames \consists #xml-name-engraver }
  \context { \FiguredBass \consists #xml-name-engraver }
}

% Score lifecycle owned by this collector.
#(xml-define-collector-state names layout
 (xml-name-originals xml-name-ids xml-name-count)
 (reset (xml-reset-name-pieces!))
 (clear (xml-clear-name-pieces!)))
