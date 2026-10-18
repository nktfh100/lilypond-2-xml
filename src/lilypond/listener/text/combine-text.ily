% Reuses existing names/finger-origin helpers; final hook requires the caller to
% confirm ly:paper-score-paper-systems completed on the SAME translator output.
#(define-record-type <xml-combine-text-entry>
   (make-xml-combine-text-entry
    grob id context staff moment stencil before-line-breaking after-line-breaking status text)
   xml-combine-text-entry?
   (grob xml-combine-text-grob)
   (id xml-combine-text-id)
   (context xml-combine-text-context)
   (staff xml-combine-text-staff)
   (moment xml-combine-text-moment)
   (stencil xml-combine-text-stencil)
   (before-line-breaking xml-combine-text-before-line-breaking)
   (after-line-breaking xml-combine-text-after-line-breaking)
   (status xml-combine-text-status)
   (text xml-combine-text-text))
#(define xml-combine-text-originals '())
#(define xml-combine-text-count 0)
#(define xml-combine-text-observed (make-hash-table))
#(define (xml-clear-combine-text!)
   (set! xml-combine-text-originals '())
   (set! xml-combine-text-observed (make-hash-table)))
#(define (xml-reset-combine-text!)
   (xml-clear-combine-text!)
   (set! xml-combine-text-count 0))

% Delegate the actual standard printer ONCE. A procedural text value is observed
% only when that printer requests it; no call to a formatter is added beforehand.
#(define (xml-combine-text-print grob observed)
   (let ((raw (ly:grob-property-data grob 'text)))
     (cond
      ((procedure? raw)
       (ly:grob-set-property! grob 'text
         (lambda (actual)
           (let ((value (raw actual)))
             (hashq-set! observed actual (cons #t value))
             value))))
      ((markup? raw)
       (hashq-set! observed grob (cons #t raw)))))
   (ly:text-interface::print grob))

#(define (xml-combine-text-engraver ctx)
   (make-engraver
    (acknowledgers
     ((text-script-interface engraver grob source)
      (when (and (eq? ctx (ly:translator-context source))
                 (ly:item? grob)
                 (eq? (assoc-get 'name (ly:grob-property grob 'meta)) 'CombineTextScript))
        (set! xml-combine-text-count (+ 1 xml-combine-text-count))
        (xml-geometry-observe-root! ctx)
        (let* ((raw (xml-bracket-stencil grob))
               (cause (ly:grob-property grob 'cause #f))
               (status (and (ly:stream-event? cause)
                            (ly:event-property cause 'part-combine-status #f))))
          (set! xml-combine-text-originals
            (cons (make-xml-combine-text-entry
                    grob
                    xml-combine-text-count
                    (ed-context-id ctx)
                    (ed-context-id (xml-script-staff ctx))
                    (ly:context-current-moment ctx)
                    raw
                    (ly:grob-property-data grob 'before-line-breaking)
                    (ly:grob-property-data grob 'after-line-breaking)
                    (if status (ed-value status) 'null)
                    (ly:grob-property-data grob 'text))
                  xml-combine-text-originals))
          (when (eq? raw ly:text-interface::print)
            (let ((observed xml-combine-text-observed))
              (ly:grob-set-property! grob 'stencil
                (lambda (actual) (xml-combine-text-print actual observed)))))))))))

#(define (xml-combine-text-original? grob original)
   (and (ly:grob? grob)
        (or (eq? grob original) (eq? (ly:grob-original grob) original))))

% This reads the text-font chain itself. NO MeasureCounter fetaText defaults,
% formatter fontsize(-2), parenthesize normalization or font-series stripping.
#(define (xml-combine-text-encoding grob)
   (let* ((layout (ly:grob-layout grob))
          (props (ly:grob-alist-chain grob (ly:output-def-lookup layout 'text-font-defaults)))
          (name (chain-assoc-get 'font-name props #f)))
     (if (string? name) 'latin1 (chain-assoc-get 'font-encoding props 'latin1))))

% No Y-coordinate query occurs at acknowledgment or in an after-line callback.
% All geometry/font reads below are gated by completed source paper systems.
#(define* (xml-final-combine-text #:optional (formatted? #f))
   (let ((systems (if (and formatted? (ly:grob? xml-geometry-root-system))
                     (xml-geometry-broken-pieces xml-geometry-root-system) '())))
     (append-map
      (lambda (entry)
       (let* ((original (xml-combine-text-grob entry))
              (members (delete-duplicates
                (append-map (lambda (system)
                  (let ((array (ly:grob-object system 'all-elements #f)))
                    (if (ly:grob-array? array)
                      (filter (lambda (grob)
                        (and (eq? (ly:grob-system grob) system)
                             (xml-combine-text-original? grob original)))
                        (ly:grob-array->list array)) '()))) systems)))
              (pieces (if (pair? members) members (list original)))
              (piece 0))
        (map (lambda (grob)
          (set! piece (+ 1 piece))
          (let* ((present (and formatted? (if (memq grob members) #t #f)
                               (grob::is-live? grob)))
                 (raw (xml-combine-text-stencil entry))
                 (before (xml-combine-text-before-line-breaking entry))
                 (after (xml-combine-text-after-line-breaking entry))
                 (observed (hashq-ref xml-combine-text-observed grob #f))
                 ;; Use available literal text as metadata without executing an
                 ;; unobserved callback. Native visible fallback requires diagnosis.
                 (literal (if present
                              (ly:grob-property-data grob 'text)
                              (xml-combine-text-text entry)))
                 (text (if observed (cdr observed) (if (markup? literal) literal #f)))
                 (stencil (and present (ly:grob-property grob 'stencil #f)))
                 (ink (and (ly:stencil? stencil) (not (ly:stencil-empty? stencil))))
                 (hidden (or (not present) (eq? raw #f) (not ink)
                             (and present (eq? (ly:grob-property grob 'transparent #f) #t))))
                 (custom (or (not (or (eq? raw #f) (eq? raw ly:text-interface::print)))
                             (not (or (eq? before #f) (null? before)))
                             (not (or (eq? after #f) (null? after)))))
                 (moment (xml-combine-text-moment entry))
                 (system (and present (ly:grob-system grob)))
                 (column (and present (ly:item-get-column grob)))
                 (column-moment (and (ly:grob? column) (ly:grob-property column 'when #f)))
                 (layout (and present (ly:grob-layout grob)))
                 (space (and layout (ly:output-def-lookup layout 'staff-space #f)))
                 (scale (and (number? space) (> space 0) (/ 10 space)))
                 (origin (and present (xml-line-origin system moment (xml-combine-text-staff entry))))
                 (staff (and present (xml-geometry-unique-staff system (xml-combine-text-staff entry))))
                 (top (xml-geometry-staff-top staff system))
                 (font-name (and present (chain-assoc-get 'font-name
                   (ly:grob-alist-chain grob (ly:output-def-lookup layout 'text-font-defaults)) #f)))
                 (encoding (and present observed (xml-combine-text-encoding grob)))
                 (font (and (eq? encoding 'latin1) (xml-name-font-context grob))))
            `((k . combine-text) (id . ,(xml-combine-text-id entry)) (piece . ,piece)
              (context . ,(xml-combine-text-context entry))
              (s . ,(xml-combine-text-staff entry))
              (m . ,(ly:moment-main moment)) (g . ,(ly:moment-grace moment))
              (status . ,(xml-combine-text-status entry)) (present . ,(if present #t #f))
              (text . ,(if (markup? text) (ed-markup->string text) 'null))
              (markup . ,(if (markup? text) (xml-markup-tree text) 'null))
              (text-observed . ,(if observed #t #f))
              (color . ,(if present (xml-color (ly:grob-property grob 'color #f)) 'null))
              (direction . ,(if present (ed-value (xml-grob-direction grob #f)) 'null))
              (hidden . ,(if hidden #t #f)) (custom . ,(if custom #t #f))
              (font-name . ,(if (string? font-name) font-name 'null))
              (font-context . ,(or font 'null))
              (font-encoding . ,(if encoding (ed-value encoding) 'null))
              (music-fonts . ,(if (and observed font) (xml-name-music-fonts grob text) 'null))
              (x-tenths . ,(if (and present ink scale origin) (* scale
                (- (+ (ly:grob-relative-coordinate grob system X) (xml-geometry-render-extra grob X))
                   (ly:grob-relative-coordinate (car origin) system X))) 'null))
              (y-tenths . ,(if (and present ink scale top) (* scale
                (- (+ (ly:grob-relative-coordinate grob system Y) (xml-geometry-render-extra grob Y)) top)) 'null))
              (x-ref-m . ,(if origin (ly:moment-main (cdr origin)) 'null))
              (x-ref-g . ,(if origin (ly:moment-grace (cdr origin)) 'null))
              (column-m . ,(if (ly:moment? column-moment) (ly:moment-main column-moment) 'null))
              (column-g . ,(if (ly:moment? column-moment) (ly:moment-grace column-moment) 'null))
              (staff-space . ,(if present (ly:staff-symbol-staff-space grob) 'null))
              (layout-staff-space . ,(or space 'null))))) pieces)))
      (reverse xml-combine-text-originals))))
\layout {
  \context { \Voice \consists #xml-combine-text-engraver }
  \context { \CueVoice \consists #xml-combine-text-engraver }
  \context { \DrumVoice \consists #xml-combine-text-engraver }
  \context { \TabVoice \consists #xml-combine-text-engraver }
  \context { \Staff \consists #xml-combine-text-engraver }
  \context { \DrumStaff \consists #xml-combine-text-engraver }
  \context { \TabStaff \consists #xml-combine-text-engraver }
}

% Score lifecycle owned by this collector.
#(xml-define-collector-state combine-text layout
 (xml-combine-text-originals xml-combine-text-count xml-combine-text-observed)
 (reset (xml-reset-combine-text!))
 (clear (xml-clear-combine-text!)))
