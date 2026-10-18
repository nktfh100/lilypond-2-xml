% Shared score geometry. Retain original grobs until final broken systems exist.
% Root observation stays at each collector's existing translation-time call site.
#(define xml-geometry-staff-symbols '())
#(define xml-geometry-root-system #f)

#(define (xml-reset-geometry!)
   (set! xml-geometry-staff-symbols '())
   (set! xml-geometry-root-system #f))

#(define (xml-geometry-observe-root! ctx)
   (unless xml-geometry-root-system
     (set! xml-geometry-root-system (ly:context-property ctx 'rootSystem #f))))

#(define (xml-geometry-broken-pieces grob)
   (let ((pieces (ly:spanner-broken-into grob)))
     (if (pair? pieces)
         pieces
         (list grob))))

% System::get_paper_system applies extra-offset only when assembling print stencils.
% Use its exact Staff_symbol_referencer scale, including its no-reference fallback.
#(define (xml-geometry-render-extra grob axis)
   (let ((extra (ly:grob-property grob 'extra-offset '(0 . 0))))
     (if (and (pair? extra)
              (number? (car extra))
              (number? (cdr extra)))
         (* (if (= axis X) (car extra) (cdr extra))
            (ly:staff-symbol-staff-space grob))
         0)))

% Do not choose an arbitrary staff when ownership or broken pieces are ambiguous.
#(define (xml-geometry-unique-staff system staff-context)
   (let ((pieces
           (filter
             (lambda (staff)
               (eq? (ly:grob-system staff) system))
             (append-map
               (lambda (entry)
                 (xml-geometry-broken-pieces (cdr entry)))
               (filter
                 (lambda (entry)
                   (= (car entry) staff-context))
                 xml-geometry-staff-symbols)))))
     (and (= (length pieces) 1) (car pieces))))

% Final rendered top staff line, in system coordinates. The caller controls when
% these properties are read; this helper does not observe or force any stencil.
#(define (xml-geometry-staff-top staff system)
   (let ((positions (and staff (ly:grob-property staff 'line-positions '()))))
     (and staff
       (pair? positions)
       (every number? positions)
       (+ (ly:grob-relative-coordinate staff system Y)
          (xml-geometry-render-extra staff Y)
          (* .5 (ly:staff-symbol-staff-space staff) (apply max positions))))))

#(define (xml-geometry-engraver ctx)
   (make-engraver
     (acknowledgers
       ((staff-symbol-interface engraver item source-engraver)
        (when (eq? ctx (ly:translator-context source-engraver))
          (set! xml-geometry-staff-symbols
            (cons (cons (ed-context-id ctx) item)
              xml-geometry-staff-symbols)))))))

% Observe the same contexts and acknowledger phase as the original name collector.
\layout {
  \context { \Staff \consists #xml-geometry-engraver }
  \context { \DrumStaff \consists #xml-geometry-engraver }
  \context { \RhythmicStaff \consists #xml-geometry-engraver }
  \context { \TabStaff \consists #xml-geometry-engraver }
  \context { \StaffGroup \consists #xml-geometry-engraver }
  \context { \ChoirStaff \consists #xml-geometry-engraver }
  \context { \PianoStaff \consists #xml-geometry-engraver }
  \context { \GrandStaff \consists #xml-geometry-engraver }
  \context { \ChordNames \consists #xml-geometry-engraver }
  \context { \FiguredBass \consists #xml-geometry-engraver }
}

% Each geometry field has one snapshot/reset/clear owner.
#(xml-define-collector-state geometry layout
   (xml-geometry-staff-symbols xml-geometry-root-system)
   (reset (xml-reset-geometry!))
   (clear (xml-reset-geometry!)))
