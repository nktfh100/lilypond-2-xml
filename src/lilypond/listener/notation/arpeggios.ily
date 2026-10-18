#(define xml-arpeggio-count 0)
#(define (xml-arpeggio-head-grobs grob)
   (let ((stems (ly:grob-object grob 'stems)))
     (if (ly:grob-array? stems)
         (delete-duplicates
          (append-map (lambda (stem)
                        (let ((heads (ly:grob-object stem 'note-heads)))
                          (if (ly:grob-array? heads) (ly:grob-array->list heads) '())))
                      (ly:grob-array->list stems))) '())))
#(define (xml-arpeggio-head-id head)
   (let ((event (ly:grob-property head 'cause)))
     (and (ly:stream-event? event) (ly:event-property event 'ed-note-id #f))))
#(define (xml-arpeggio-offset grob)
   (let ((offset (ly:grob-property grob 'extra-offset '(0 . 0))))
     (if (and (pair? offset) (number? (car offset)) (number? (cdr offset)))
         (vector (car offset) (cdr offset)) #(0 0))))
#(define (xml-arpeggio-y-base grob staff offset)
   (let ((parent (ly:grob-parent grob Y)))
     (if (and (number? offset) (ly:grob? staff) (ly:grob? parent)
              (eq? staff (ly:grob-object parent 'staff-symbol)))
         (let* ((common (ly:grob-common-refpoint parent staff Y))
                (space (ly:staff-symbol-staff-space staff)))
           (if (and (ly:grob? common) (> space 0))
               (/ (+ offset (- (ly:grob-relative-coordinate parent common Y)
                               (ly:grob-relative-coordinate staff common Y))) space) #f)) #f)))
#(define (xml-arpeggio-engraver ctx)
   (let ((items '()))
     (define (capture engraver grob source-engraver)
       (when (eq? ctx (ly:translator-context source-engraver))
         (set! items (cons (list grob (ly:context-current-moment ctx) (ly:grob-property-data grob 'positions) (assoc-get 'name (ly:grob-property grob 'meta))) items))))
     (make-engraver
      (acknowledgers
       ((arpeggio-interface engraver grob source-engraver) (capture engraver grob source-engraver))
       ((chord-bracket-interface engraver grob source-engraver) (capture engraver grob source-engraver))
       ((chord-slur-interface engraver grob source-engraver) (capture engraver grob source-engraver)))
      ((finalize engraver)
       (for-each
        (lambda (entry)
          (ed-guard 'arpeggio
            (lambda ()
              (let* ((grob (car entry)) (moment (cadr entry))
                     (surrogate (ly:grob-object grob 'vertically-spanning-surrogate))
                     (stencil (ly:grob-property-data grob 'stencil))
                     (name (cadddr entry))
                     (shape (cond ((eq? stencil ly:arpeggio::print) 'normal)
                                  ((eq? stencil ly:chord-bracket::print) 'bracket)
                                  ((eq? stencil ly:chord-slur::print) 'parenthesis)
                                  ((eq? name 'ChordBracket) 'bracket)
                                  ((eq? name 'ChordSlur) 'parenthesis)
                                  (else 'normal)))
                     (positions (caddr entry))
                     (heads (xml-arpeggio-head-grobs grob))
                     (staff (ly:grob-object grob 'staff-symbol))
                     (staff-position (ly:grob-property-data grob 'staff-position))
                     (y-offset (ly:grob-property-data grob 'Y-offset))
                     (x-offset (ly:grob-property-data grob 'X-offset))
                     (defaults (assoc-get name all-grob-descriptions))
                     (normal-y? (eq? y-offset (assoc-get 'Y-offset defaults)))
                     (space (if (ly:grob? staff) (ly:staff-symbol-staff-space staff) (ly:output-def-lookup (ly:grob-layout grob) 'staff-space #f)))
                     (y-base (if (and normal-y? (number? staff-position)) (/ staff-position 2) (xml-arpeggio-y-base grob staff y-offset))))
                (unless (ly:grob? surrogate)
                  (set! xml-arpeggio-count (+ xml-arpeggio-count 1))
                  (set! ed-events
                    (cons
                     `((k . arpeggio) (id . ,xml-arpeggio-count)
                       (context . ,(ed-context-id ctx))
                       (notes . ,(list->vector (filter-map xml-arpeggio-head-id heads)))
                       (head-positions . ,(list->vector
                         (filter-map (lambda (head)
                           (let ((id (xml-arpeggio-head-id head))
                                 (position (ly:grob-property head 'staff-position #f)))
                             (and id (number? position) (vector id position)))) heads)))
                       (range-reference . ,(list->vector
                         (filter-map (lambda (head)
                           (and (ly:grob? staff) (eq? staff (ly:grob-object head 'staff-symbol))
                                (xml-arpeggio-head-id head))) heads)))
                       (range-base . ,(if (number? y-base) y-base 'null))
                       (default-x . ,(if (and (number? x-offset) (number? space) (> space 0)) (/ x-offset space) 'null))
                       (range-staff-top . ,(let ((lines (and (ly:grob? staff) (ly:grob-property staff 'line-positions '()))))
                         (if (and (pair? lines) (every number? lines)) (/ (apply max lines) 2) 'null)))
                       (color . ,(xml-color (ly:grob-property grob 'color #f)))
                       (offset . ,(xml-arpeggio-offset grob))
                       (custom-positions . ,(not (or (eq? positions ly:arpeggio::calc-positions)
                         (and (pair? positions) (number? (car positions)) (number? (cdr positions))))))
                       (custom-geometry . ,(or (not (number? y-base))
                         (not (or (number? x-offset) (eq? x-offset (assoc-get 'X-offset defaults))))
                         (not (= (ly:grob-property grob 'padding 0.5) 0.5))
                         (not (= (ly:grob-property grob 'protrusion 0.4) 0.4))
                         (not (= (ly:grob-property grob 'thickness 1) 1))
                         (not (= (ly:grob-property grob 'line-thickness 1) 1))))
                       (style . ,shape)
                       (arrow . ,(ly:grob-property grob 'arpeggio-direction 0))
                       (side . ,(xml-grob-direction grob -1))
                       (dashed . ,(pair? (ly:grob-property grob 'dash-definition)))
                       (size . ,(ly:grob-property grob 'font-size 0))
                       (positions . ,(and (pair? positions) (number? (car positions)) (number? (cdr positions))
                                          (vector (car positions) (cdr positions))))
                       (hidden . ,(or (eq? stencil #f) (eq? (ly:grob-property grob 'transparent #f) #t)))
                       (custom . ,(not (memq stencil (list #f ly:arpeggio::print ly:chord-bracket::print ly:chord-slur::print))))
                       (m . ,(ly:moment-main moment)) (g . ,(ly:moment-grace moment)))
                     ed-events)))))))
        (reverse items))))))
\layout {
  \context { \Voice \consists #xml-arpeggio-engraver }
  \context { \CueVoice \consists #xml-arpeggio-engraver }
  \context { \DrumVoice \consists #xml-arpeggio-engraver }
  \context { \TabVoice \consists #xml-arpeggio-engraver }
  \context { \Staff \consists #xml-arpeggio-engraver }
  \context { \DrumStaff \consists #xml-arpeggio-engraver }
  \context { \RhythmicStaff \consists #xml-arpeggio-engraver }
  \context { \TabStaff \consists #xml-arpeggio-engraver }
  \context { \PianoStaff \consists #xml-arpeggio-engraver }
  \context { \GrandStaff \consists #xml-arpeggio-engraver }
  \context { \StaffGroup \consists #xml-arpeggio-engraver }
  \context { \ChoirStaff \consists #xml-arpeggio-engraver }
}

% Score lifecycle owned by this collector.
#(xml-define-collector-state arpeggios semantic
 (xml-arpeggio-count)
 (reset (set! xml-arpeggio-count 0))
 (clear ))
