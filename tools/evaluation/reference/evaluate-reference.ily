\include "evaluate-written-reference.ily"
\midi {}
#(define evaluation-default-midi (ly:output-def-clone $defaultmidi))

#(define (evaluation-midi-property? name)
   (and (symbol? name)
        (or (string-prefix? "midi" (symbol->string name))
            (memq name '(dynamicAbsoluteVolumeFunction instrumentEqualizer quotedCueEventTypes)))))

#(define (evaluation-printed-music music)
   (music-map
    (lambda (item)
      (let ((operations (ly:music-property item 'property-operations '())))
        (when (pair? operations)
          (set! (ly:music-property item 'property-operations)
                (filter (lambda (operation)
                          (not (and (memq (car operation) '(assign unset))
                                    (evaluation-midi-property? (cadr operation)))))
                        operations))))
      (if (and (memq (ly:music-property item 'name) '(PropertySet PropertyUnset))
               (evaluation-midi-property? (ly:music-property item 'symbol)))
          (make-music 'SequentialMusic 'elements '())
          item))
    music))

#(define (evaluation-clear-length music)
   (let ((element (ly:music-property music 'element))
         (elements (ly:music-property music 'elements)))
     (when (or (ly:music? element) (pair? elements))
       (set! (ly:music-property music 'length) '()))
     (when (ly:music? element) (evaluation-clear-length element))
     (for-each evaluation-clear-length elements))
   music)

#(define evaluation-score-index 0)
#(define evaluation-manifest
   (open-output-file (string-append evaluation-output-prefix ".tsv")))

#(define (evaluation-book book)
   (for-each
    (lambda (score)
      (when (ly:score? score)
        (set! evaluation-score-index (+ evaluation-score-index 1))
        (when (or (null? (ly:score-output-defs score))
                  (any (lambda (definition)
                         (eq? (ly:output-def-lookup definition 'output-def-kind) 'layout))
                       (ly:score-output-defs score)))
        (evaluation-write-written score)
        (let* ((original (evaluation-printed-music (ly:music-deep-copy (ly:score-music score))))
               (music (evaluation-clear-length
                       (unfold-repeats '() (evaluation-clear-length original))))
               (reference (ly:make-score music))
               (midi (ly:output-def-clone evaluation-default-midi)))
          (format evaluation-manifest "~a\tprinted\n" evaluation-score-index)
          (force-output evaluation-manifest)
          (ly:score-add-output-def! reference (ly:output-def-clone midi))
          (ly:book-process
           (ly:make-book $defaultpaper $defaultheader reference)
           $defaultpaper $defaultlayout
           (format #f "~a-~a" evaluation-output-prefix evaluation-score-index))))))
    (reverse (ly:book-scores book)))
   (for-each evaluation-book (reverse (ly:book-book-parts book))))

#(define toplevel-book-handler evaluation-book)
#(define default-toplevel-book-handler evaluation-book)
