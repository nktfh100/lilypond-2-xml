#(define (xml-harmony-engraver ctx)
   (let ((wrapped #f) (current #f) (rest #f) (length #f) (grob #f) (played '()) (skip #f))
     (define (install)
       (let ((original (ly:context-property ctx 'chordNameFunction)))
         (when (and (procedure? original) (not (eq? original wrapped)))
           (set! wrapped
             (lambda (pitches bass inversion context)
               (let ((text (original pitches bass inversion context)))
                 (set! current (list pitches bass inversion text))
                 text)))
           (ly:context-set-property! ctx 'chordNameFunction wrapped))))
     (make-engraver
      ((initialize engraver) (install))
      ((start-translation-timestep engraver) (install))
      (listeners
       ((note-event engraver event)
        (set! length (ly:event-property event 'duration))
        (set! played (cons (ly:event-property event 'pitch) played)))
       ((skip-event engraver event)
        (set! skip #t)
        (set! length (ly:event-property event 'duration)))
       ((general-rest-event engraver event)
        (set! rest #t)
        (set! length (ly:event-property event 'duration))))
      (acknowledgers
       ((text-interface engraver item source-engraver)
        (when (eq? (assoc-get 'name (ly:grob-property item 'meta)) 'ChordName) (set! grob item))))
      ((stop-translation-timestep engraver)
       (when (and length (or current rest skip))
         (ed-push! ctx
           `((k . harmony) (v . ,(ed-context-id ctx))
             (d . ,(ed-duration length))
             (skip . ,skip)
             (played . ,(list->vector (map ed-pitch (reverse played))))
             (pitches . ,(if current (list->vector (map ed-pitch (car current))) (vector)))
             (bass . ,(if current (ed-value (cadr current)) 'null))
             (inversion . ,(if current (ed-value (caddr current)) 'null))
             (text . ,(ed-value (if grob (ly:grob-property grob 'text "") (if current (cadddr current) (ly:context-property ctx 'noChordSymbol "")))))
             (repeat . ,(if grob (eq? (ly:grob-property grob 'begin-of-line-visible #f) #t) #f)))))
       (set! current #f)
       (set! rest #f)
       (set! length #f)
       (set! grob #f)
       (set! played '())
       (set! skip #f)))))

\layout {
  \context { \ChordNames \consists #xml-harmony-engraver }
}
