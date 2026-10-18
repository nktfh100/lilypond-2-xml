#(define (xml-markup-style markup choices)
   (and (pair? markup)
        (or (and (procedure? (car markup)) (assoc-get (procedure-name (car markup)) choices))
            (any (lambda (part) (xml-markup-style part choices)) markup))))
#(define (xml-navigation-engraver ctx)
   (let ((items '()))
     (make-engraver
      (acknowledgers
       ((text-interface engraver item source-engraver)
        (when (memq (assoc-get 'name (ly:grob-property item 'meta)) '(RehearsalMark SegnoMark CodaMark SectionLabel JumpScript))
          (set! items (cons item items)))))
      ((stop-translation-timestep engraver)
       (for-each
        (lambda (item)
          (let ((event (ly:grob-property item 'cause)))
            (when (ly:stream-event? event)
              (ed-push! ctx
                `((k . navigation)
                  (c . ,(car (ly:event-property event 'class)))
                  (text . ,(ed-value (ly:grob-property item 'text "")))
                  (markup . ,(xml-markup-tree (ly:grob-property item 'text "")))
                  (enclosure . ,(or (xml-markup-style (ly:grob-property item 'text "") '((box-markup . rectangle) (circle-markup . circle) (oval-markup . oval))) 'none))
                  (bold . ,(or (eq? (xml-markup-style (ly:grob-property item 'text "") '((bold-markup . bold) (normal-text-markup . normal))) 'bold) (eq? (ly:grob-property item 'font-series 'normal) 'bold)))
                  (italic . ,(or (eq? (xml-markup-style (ly:grob-property item 'text "") '((italic-markup . italic) (upright-markup . normal))) 'italic) (eq? (ly:grob-property item 'font-shape 'upright) 'italic)))
                  (direction . ,(ed-value (xml-grob-direction item 1)))
                  (hidden . ,(or (eq? (ly:grob-property item 'stencil #t) #f) (eq? (ly:grob-property item 'transparent #f) #t)))
                  (final-visible . ,(ly:context-property ctx 'finalFineTextVisibility #f))
                  (segno . ,(ly:context-property ctx 'segnoMarkCount 0))
                  (coda . ,(ly:context-property ctx 'codaMarkCount 0))
                  (return-count . ,(ly:event-property event 'return-count 1))
                  (alternative-number . ,(ly:event-property event 'alternative-number 0)))))))
        (reverse items))
       (set! items '())))))
\layout {
  \context { \Score \consists #xml-navigation-engraver }
}
