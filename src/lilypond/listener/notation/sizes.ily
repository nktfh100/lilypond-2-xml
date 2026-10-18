#(define (xml-size-engraver ctx)
   (let ((grobs '()))
     (define (remember grob kind)
       (set! grobs (cons (list grob kind (ly:context-current-moment ctx)) grobs)))
     (make-engraver
      (acknowledgers
       ((note-head-interface engraver grob source-engraver) (remember grob 'note))
       ((rest-interface engraver grob source-engraver) (remember grob 'rest))
       ((multi-measure-rest-interface engraver grob source-engraver) (remember grob 'mmrest)))
      ((finalize engraver)
       (for-each
        (lambda (entry)
          (ed-guard 'note-size
            (lambda ()
              (let* ((grob (car entry)) (moment (caddr entry))
                     (event (ly:grob-property grob 'cause))
                     (stem (ly:grob-object grob 'stem))
                     (size (ly:grob-property grob 'font-size 0)))
                (when (number? size)
                  (set! ed-events
                    (cons
                     `((k . notesize) (v . ,(ed-context-id ctx))
                       (s . ,(ed-context-id (ly:context-parent ctx)))
                       (nid . ,(if (ly:stream-event? event) (ly:event-property event 'ed-note-id 'null) 'null))
                       (kind . ,(cadr entry)) (size . ,size)
                       (stem-size . ,(if (ly:grob? stem) (ly:grob-property stem 'font-size 0) 'null))
                       (m . ,(ly:moment-main moment)) (g . ,(ly:moment-grace moment)))
                     ed-events)))))))
        (reverse grobs))))))
\layout {
  \context { \Voice \consists #xml-size-engraver }
  \context { \CueVoice \consists #xml-size-engraver }
  \context { \DrumVoice \consists #xml-size-engraver }
  \context { \TabVoice \consists #xml-size-engraver }
}
