#(define (xml-transposition-engraver ctx)
   (let ((previous #f))
     (make-engraver
       ((stop-translation-timestep engraver)
        (let ((pitch
                (ly:context-property ctx 'instrumentTransposition
                  (ly:make-pitch 0 0 0))))
          (when (and (ly:pitch? pitch) (not (equal? pitch previous)))
            (set! previous pitch)
            (ed-push! ctx
              `((k . transpose)
                (s . ,(ed-context-id ctx))
                (pitch . ,(ed-value pitch))))))))))

\layout {
  \context { \Staff \consists #xml-transposition-engraver }
}
