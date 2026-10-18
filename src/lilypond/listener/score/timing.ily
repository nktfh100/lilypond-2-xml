#(define (xml-staff-timing-engraver ctx)
   (let ((previous #f))
     (make-engraver
      ((stop-translation-timestep engraver)
       (let* ((bar (ly:context-property ctx 'currentBarNumber #f))
              (length (ly:context-property ctx 'measureLength #f))
              (signature (ly:context-property ctx 'timeSignature #f))
              (timing (ly:context-property ctx 'timing #t))
              (state (list bar length signature timing)))
         (when (and (integer? bar) (number? length) (not (equal? state previous)))
           (set! previous state)
           (ed-push! ctx `((k . staffstep) (s . ,(ed-context-id ctx))
                          (bar . ,bar) (len . ,(ed-value length))
                          (pos . ,(ed-value (ly:context-property ctx 'measurePosition)))
                          (time . ,(if (pair? signature) (ed-value signature) 'null))
                          (timing . ,timing)))))))))
\layout {
  \context { \Staff \consists #xml-staff-timing-engraver }
  \context { \TabStaff \consists #xml-staff-timing-engraver }
  \context { \DrumStaff \consists #xml-staff-timing-engraver }
  \context { \RhythmicStaff \consists #xml-staff-timing-engraver }
}
