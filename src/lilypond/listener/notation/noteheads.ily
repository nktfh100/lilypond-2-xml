#(define (xml-notehead-engraver ctx)
   (let ((heads '()))
     (make-engraver
      (acknowledgers
       ((note-head-interface engraver grob source-engraver)
        (let ((event (ly:grob-property grob 'cause)))
          (when (and (ly:stream-event? event)
                     (ly:event-property event 'ed-note-id #f)
                     (not (eq? (assoc-get 'name (ly:grob-property grob 'meta)) 'TabNoteHead)))
            (set! heads (cons (list grob (ly:event-property event 'ed-note-id)
                                    (ly:context-current-moment ctx)) heads))))))
      ((finalize engraver)
       (for-each
        (lambda (entry)
          (ed-guard 'notehead
            (lambda ()
              (let* ((head (car entry)) (moment (caddr entry))
                     (stencil (ly:grob-property-data head 'stencil)))
                (set! ed-events
                  (cons
                   `((k . notehead) (nid . ,(cadr entry))
                     (m . ,(ly:moment-main moment)) (g . ,(ly:moment-grace moment))
                     (style . ,(ed-value (ly:grob-property head 'style 'default)))
                     (glyph . ,(ed-value (ly:grob-property head 'glyph-name "")))
                     (log . ,(ly:grob-property head 'duration-log 2))
                     (direction . ,(xml-grob-direction head 0))
                     (hidden . ,(or (eq? stencil #f) (eq? (ly:grob-property head 'transparent #f) #t)))
                     (custom . ,(not (or (eq? stencil #f) (eq? stencil ly:note-head::print)))))
                   ed-events))))))
        (reverse heads))))))
\layout {
  \context { \Voice \consists #xml-notehead-engraver }
  \context { \CueVoice \consists #xml-notehead-engraver }
  \context { \DrumVoice \consists #xml-notehead-engraver }
}
