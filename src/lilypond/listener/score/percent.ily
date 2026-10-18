#(set-object-property! 'xml-percent-id 'music-type? integer?)
#(set-object-property! 'xml-percent-id 'music-doc "The extracted percent-repeat identifier.")
#(define xml-percent-id 0)
#(define (xml-percent-event engraver event)
   (let ((ctx (ly:translator-context engraver)))
     (set! xml-percent-id (+ xml-percent-id 1))
     (ly:event-set-property! event 'xml-percent-id xml-percent-id)
     (ed-push! ctx
       `((k . percent) (id . ,xml-percent-id)
         (v . ,(ed-context-id ctx)) (s . ,(ed-context-id (ly:context-parent ctx)))
         (c . ,(car (ly:event-property event 'class)))
         (length . ,(ed-value (ly:event-property event 'length (ly:make-moment 0))))
         (count . ,(ly:event-property event 'repeat-count 0))
         (slashes . ,(ly:event-property event 'slash-count 1))))))
#(define (xml-percent-engraver ctx)
   (let ((items '()))
     (define (remember item)
       (let* ((event (ly:grob-property item 'cause))
              (id (and (ly:stream-event? event) (ly:event-property event 'xml-percent-id #f))))
         (when id (set! items (cons (cons id item) items)))))
     (make-engraver
      (listeners
       (percent-event . xml-percent-event)
       (double-percent-event . xml-percent-event)
       (repeat-slash-event . xml-percent-event))
      (acknowledgers
       ((percent-repeat-interface engraver item source-engraver) (remember item))
       ((text-interface engraver item source-engraver)
        (when (memq (assoc-get 'name (ly:grob-property item 'meta)) '(PercentRepeatCounter DoublePercentRepeatCounter)) (remember item))))
      ((stop-translation-timestep engraver)
       (for-each
        (lambda (entry)
          (let ((item (cdr entry)))
            (ed-push! ctx
              `((k . percentgraphic) (id . ,(car entry))
                (name . ,(assoc-get 'name (ly:grob-property item 'meta)))
                (text . ,(ed-value (ly:grob-property item 'text "")))
                (hidden . ,(or (eq? (ly:grob-property item 'stencil #t) #f) (eq? (ly:grob-property item 'transparent #f) #t)))))))
        (reverse items))
       (set! items '())))))
\layout {
  \context { \Voice \consists #xml-percent-engraver }
  \context { \TabVoice \consists #xml-percent-engraver }
  \context { \ChordNames \consists #xml-percent-engraver }
  \context { \CueVoice \consists #xml-percent-engraver }
  \context { \DrumVoice \consists #xml-percent-engraver }
}

% Score lifecycle owned by this collector.
#(xml-define-collector-state percent semantic
 (xml-percent-id)
 (reset (set! xml-percent-id 0))
 (clear ))
