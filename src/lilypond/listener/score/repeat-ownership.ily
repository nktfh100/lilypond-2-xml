#(define xml-repeat-owners (make-hash-table))
#(define (xml-repeat-event? event)
 (memq (car (ly:event-property event 'class))
  '(volta-repeat-start-event volta-repeat-end-event volta-span-event alternative-event)))
#(define (xml-repeat-owner-field event)
 (or (hashq-ref xml-repeat-owners event #f)
  (let ((field (cons 'repeat-context 'null)))
   (hashq-set! xml-repeat-owners event field) field)))
#(define xml-repeat-score-event-body ed-score-event-body)
#(set! ed-score-event-body
 (lambda (engraver event)
  (if (xml-repeat-event? event)
   (ed-push! (ly:translator-context engraver)
    (append `((k . score) (c . ,(car (ly:event-property event 'class))))
     (ed-event-alist event) (list (xml-repeat-owner-field event))))
   (xml-repeat-score-event-body engraver event))))
#(define (xml-repeat-ownership-engraver ctx)
 (define (watch owner)
  ;; Subscribing to StreamEvent also accepts note post-events. LilyPond then
  ;; delivers finger glides separately instead of leaving them on the note,
  ;; which breaks its native Finger_glide_engraver. Observe only repeat events.
  (for-each (lambda (event-class)
   (ly:add-listener
    (lambda (event)
     (set-cdr! (xml-repeat-owner-field event) (ed-context-id owner)))
    (ly:context-event-source owner) event-class))
   '(volta-repeat-start-event volta-repeat-end-event volta-span-event alternative-event)))
 (watch ctx)
 (ly:add-listener (lambda (event) (watch (ly:event-property event 'context)))
  (ly:context-events-below ctx) 'AnnounceNewContext)
 (make-engraver))
\layout { \context { \Score \consists #xml-repeat-ownership-engraver } }

% Score lifecycle owned by this collector.
#(xml-define-collector-state repeat-ownership semantic
 (xml-repeat-owners)
 (reset (set! xml-repeat-owners (make-hash-table)))
 (clear ))
