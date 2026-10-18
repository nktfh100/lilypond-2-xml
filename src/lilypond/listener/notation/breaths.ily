#(define (xml-breath-font-points grob text stencil)
   (if (and (eq? stencil ly:text-interface::print) (pair? text) (eq? (car text) musicglyph-markup))
       (catch #t
         (lambda ()
           (let* ((layout (ly:grob-layout grob))
                  (props (cons '((font-encoding . fetaMusic) (font-name . #f))
                          (ly:grob-alist-chain grob (ly:output-def-lookup layout 'text-font-defaults)))))
             (xml-font-points (ly:paper-get-font layout props) layout)))
         (lambda args 'null)) 'null))
#(define (xml-breath-engraver ctx)
   (let ((items '()))
     (make-engraver
       (acknowledgers
         ((breathing-sign-interface engraver grob source-engraver)
          (when (eq? ctx (ly:translator-context source-engraver))
            (set! items (cons (list grob (ly:context-current-moment ctx)) items)))))
       ((finalize engraver)
        (for-each
          (lambda (entry)
            (ed-guard 'breath
              (lambda ()
                (let* ((grob (car entry)) (moment (cadr entry))
                       (event (ly:grob-property grob 'cause))
                       (id (and (ly:stream-event? event) (xml-script-id event)))
                       (text (ly:grob-property grob 'text ""))
                       (stencil (ly:grob-property-data grob 'stencil)))
                  (when id
                    (set! ed-events
                      (cons `((k . script) (id . ,id) (breath . #t)
                              (v . ,(ed-context-id ctx)) (s . ,(ed-context-id (xml-script-staff ctx)))
                              (articulation . "breathing-event")
                              (glyph . ,(if (and (pair? text) (eq? (car text) musicglyph-markup)
                                                (pair? (cdr text)) (string? (cadr text))) (cadr text) ""))
                              (direction . ,(xml-grob-direction grob 1))
                              (axis . 1) (staff-position . null)
                              (font-size . ,(ly:grob-property grob 'font-size 0))
                              (font-points . ,(xml-breath-font-points grob text stencil))
                              (color . ,(xml-color (ly:grob-property grob 'color #f)))
                              (offset . ,(xml-bracket-pair grob 'extra-offset '(0 . 0)))
                              (hidden . ,(or (eq? stencil #f) (eq? (ly:grob-property grob 'transparent #f) #t)
                                             (and (pair? text) (eq? (car text) null-markup))))
                              (custom . ,(not (or (eq? stencil #f) (eq? stencil ly:text-interface::print))))
                              (m . ,(ly:moment-main moment)) (g . ,(ly:moment-grace moment))) ed-events)))))))
          (reverse items))))))
\layout {
  \context { \Voice \consists #xml-breath-engraver }
  \context { \CueVoice \consists #xml-breath-engraver }
  \context { \DrumVoice \consists #xml-breath-engraver }
  \context { \TabVoice \consists #xml-breath-engraver }
  \context { \Staff \consists #xml-breath-engraver }
  \context { \DrumStaff \consists #xml-breath-engraver }
  \context { \TabStaff \consists #xml-breath-engraver }
  \context { \RhythmicStaff \consists #xml-breath-engraver }
}
