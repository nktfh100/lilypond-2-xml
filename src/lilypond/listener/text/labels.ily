% Passive global labels on actual Score command columns; no new layout/formatting.
#(define (xml-label-engraver ctx)
   (let ((seen (make-hash-table)) (count 0) (columns '()))
    (make-engraver
     ((stop-translation-timestep engraver)
      (let* ((column (ly:context-property ctx 'currentCommandColumn #f))
             (labels (and (ly:grob? column) (ly:grob-property-data column 'labels)))
             (entry (and (ly:grob? column) (hashq-ref seen column #f))))
       (cond
        (entry (set-car! (cddr entry) (ly:context-current-moment ctx)))
        ((and (list? labels) (pair? labels))
         (set! count (+ count 1))
         (let ((row (list column count (ly:context-current-moment ctx))))
          (hashq-set! seen column row)
          (set! columns (cons row columns)))))))
     ((finalize engraver)
      (for-each
       (lambda (entry)
        (let* ((column (car entry)) (observed (caddr entry))
               (labels (ly:grob-property-data column 'labels))
               (column-moment (ly:grob-property-data column 'when))
               (moment (if (ly:moment? column-moment) column-moment observed)))
         (when (and (list? labels) (pair? labels))
          (set! ed-events (cons
           `((k . label-anchor) (id . ,(cadr entry)) (context . ,(ed-context-id ctx))
             (m . ,(ly:moment-main moment)) (g . ,(ly:moment-grace moment))
             (labels . ,(list->vector (filter-map (lambda (label)
               (and (symbol? label) (symbol->string label))) labels)))
             (column-m . ,(if (ly:moment? column-moment) (ly:moment-main column-moment) 'null))
             (column-g . ,(if (ly:moment? column-moment) (ly:moment-grace column-moment) 'null))
             (observed-m . ,(ly:moment-main observed)) (observed-g . ,(ly:moment-grace observed)))
           ed-events)))))
       (reverse columns))))))
\layout { \context { \Score \consists #xml-label-engraver } }
