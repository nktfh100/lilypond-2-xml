#(define evaluation-written-notes '())
#(define evaluation-written-voices (make-hash-table))
#(define evaluation-written-next-voice 0)
#(define evaluation-written-events (make-hash-table))
#(define evaluation-written-uncaptured-contexts '())

#(define (evaluation-written-voice context)
   (or (hashq-ref evaluation-written-voices context)
       (begin
         (set! evaluation-written-next-voice (+ evaluation-written-next-voice 1))
         (hashq-set! evaluation-written-voices context evaluation-written-next-voice)
         evaluation-written-next-voice)))

#(define (evaluation-written-engraver context)
   (make-engraver
    (listeners
     ((note-event engraver event)
      (let ((pitch (ly:event-property event 'pitch #f))
            (duration (ly:event-property event 'duration #f))
            (moment (ly:context-current-moment context)))
        (when (and (ly:pitch? pitch) (ly:duration? duration))
          (hashq-set! evaluation-written-events event
                      (cons context (hashq-ref evaluation-written-events event '())))
          (set! evaluation-written-notes
                (cons (format #f "~a\t~a\t~a\t~a\t~a\t~a\t~a\n"
                              (ly:pitch-notename pitch)
                              (+ 4 (ly:pitch-octave pitch))
                              (* 2 (ly:pitch-alteration pitch))
                              (* 4 (ly:moment-main moment))
                              (* 4 (ly:moment-grace moment))
                              (* 4 (expt 2 (- (ly:duration-log duration)))
                                 (- 2 (expt 2 (- (ly:duration-dot-count duration))))
                                 (ly:duration-scale duration))
                              (evaluation-written-voice context))
                      evaluation-written-notes))))))))

#(define (evaluation-written-completeness-engraver context)
   (make-engraver
    (acknowledgers
     ((rhythmic-head-interface engraver grob source-engraver)
      (let ((event (ly:grob-property grob 'cause))
            (source (ly:translator-context source-engraver)))
        (when (and (ly:stream-event? event)
                   (ly:pitch? (ly:event-property event 'pitch #f))
                   (not (ly:context-alias? source 'NullVoice))
                   (not (memq source (hashq-ref evaluation-written-events event '()))))
          (set! evaluation-written-uncaptured-contexts
                (cons (ly:context-name source) evaluation-written-uncaptured-contexts))))))))

\layout {
  \context { \Score \consists #evaluation-written-completeness-engraver }
  \context { \VaticanaScore \consists #evaluation-written-completeness-engraver }
  \context { \StandaloneRhythmScore \consists #evaluation-written-completeness-engraver }
  \context { \Voice \consists #evaluation-written-engraver }
  \context { \CueVoice \consists #evaluation-written-engraver }
  \context { \TabVoice \consists #evaluation-written-engraver }
  \context { \MensuralVoice \consists #evaluation-written-engraver }
  \context { \PetrucciVoice \consists #evaluation-written-engraver }
  \context { \VaticanaVoice \consists #evaluation-written-engraver }
  \context { \GregorianTranscriptionVoice \consists #evaluation-written-engraver }
  \context { \KievanVoice \consists #evaluation-written-engraver }
  \context { \StandaloneRhythmVoice \consists #evaluation-written-engraver }
}

#(define (evaluation-write-written score)
   (set! evaluation-written-notes '())
   (set! evaluation-written-voices (make-hash-table))
   (set! evaluation-written-next-voice 0)
   (set! evaluation-written-events (make-hash-table))
   (set! evaluation-written-uncaptured-contexts '())
   (let* ((layouts (filter (lambda (definition)
                            (eq? (ly:output-def-lookup definition 'output-def-kind) 'layout))
                          (ly:score-output-defs score)))
          (layout (ly:output-def-clone (if (pair? layouts) (car layouts) $defaultlayout)))
          (paper (ly:output-def-clone $defaultpaper))
          (music (evaluation-clear-length
                  (unfold-repeats '(percent)
                    (evaluation-clear-length
                      (evaluation-printed-music (ly:music-deep-copy (ly:score-music score))))))))
     (module-for-each
      (lambda (name variable)
        (when (and (variable-bound? variable)
                   (not (module-defined? (ly:output-def-scope layout) name)))
          (ly:output-def-set-variable! layout name (variable-ref variable))))
      (ly:output-def-scope paper))
     (ly:run-translator music layout)
     (call-with-output-file
      (format #f "~a-~a.written.tsv" evaluation-output-prefix evaluation-score-index)
      (lambda (port)
        (if (pair? evaluation-written-uncaptured-contexts)
            (format port "unavailable\tUncaptured pitched notes in contexts: ~a\n"
                    (delete-duplicates evaluation-written-uncaptured-contexts))
            (for-each (lambda (note) (display note port)) (reverse evaluation-written-notes)))))))
