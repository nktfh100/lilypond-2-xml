#(define (xml-percussion-note ctx grob)
   (let loop ((cause (ly:grob-property grob 'cause)))
     (cond
      ((ly:grob? cause) (loop (ly:grob-property cause 'cause)))
      ((and (ly:stream-event? cause) (ly:event-property cause 'ed-note-id #f))
       (let ((drum (ly:event-property cause 'drum-type #f)))
         (when drum
           (ed-push! ctx
             `((k . percussion)
               (nid . ,(ly:event-property cause 'ed-note-id))
               (s . ,(ed-context-id (ly:context-parent ctx)))
               (drum . ,drum)
               (position . ,(ly:grob-property grob 'staff-position 0))
               (style . ,(ed-value (ly:grob-property grob 'style 'default))))))))
      (else #f))))

#(define (xml-percussion-script ctx grob)
   (let ((note-id (ed-stem-note-id grob))
         (stencil (ly:grob-property grob 'script-stencil)))
     (when (integer? note-id)
       (ed-push! ctx
         `((k . drumscript) (nid . ,note-id)
           (glyph . ,(if (and (pair? stencil) (pair? (cdr stencil))) (ed-value (cadr stencil)) "custom"))
           (direction . ,(xml-grob-direction grob 0))
           (hidden . ,(eq? (ly:grob-property grob 'transparent #f) #t)))))))

#(define (xml-percussion-engraver ctx)
   (make-engraver
    (acknowledgers
     ((script-interface engraver grob source-engraver)
      (ed-guard 'percussion-script (lambda () (xml-percussion-script ctx grob))))
     ((note-head-interface engraver grob source-engraver)
      (ed-guard 'percussion (lambda () (xml-percussion-note ctx grob)))))))

% Retain actual StaffSymbol instances, not subsequent context override intent.
% Flush after all translator finalizers, before optional final-system rendering.
#(define xml-staff-line-grobs '())
#(define xml-staff-line-contexts '())
#(define (xml-reset-staff-lines!)
   (set! xml-staff-line-grobs '())
   (set! xml-staff-line-contexts '()))
#(define* (xml-finish-staff-lines! #:optional (completed? #f))
   (define members (make-hash-table))
   (define indexed
    (when (and completed? (ly:grob? xml-geometry-root-system))
     (for-each
      (lambda (system)
        (let ((array (ly:grob-object system 'all-elements #f)))
          (when (ly:grob-array? array)
            (for-each
             (lambda (grob)
               (when (and (grob::has-interface grob 'staff-symbol-interface)
                          (grob::is-live? grob) (eq? (ly:grob-system grob) system))
                 (let ((original (or (ly:grob-original grob) grob)))
                   (hashq-set! members original
                     (cons grob (hashq-ref members original '()))))))
             (ly:grob-array->list array)))))
      (xml-geometry-broken-pieces xml-geometry-root-system))))
   (define (properties grob)
     (let* ((positions (if completed? (ly:grob-property-data grob 'line-positions)
                           (ly:grob-property grob 'line-positions '())))
            (known (and (list? positions) (every number? positions)))
            (layout-space (ly:output-def-lookup (ly:grob-layout grob) 'staff-space 1))
            (raw-space (if completed? (ly:grob-property-data grob 'staff-space)
                           (ly:grob-property grob 'staff-space 1)))
            (relative-space (if (null? raw-space) 1 raw-space))
            (base (ly:output-def-lookup (ly:grob-layout grob) 'line-thickness #f))
            (raw-factor (if completed? (ly:grob-property-data grob 'thickness)
                            (ly:grob-property grob 'thickness 1)))
            (factor (if (null? raw-factor) 1 raw-factor))
            (stencil (ly:grob-property-data grob 'stencil))
            (color (if completed? (ly:grob-property-data grob 'color)
                       (ly:grob-property grob 'color #f))))
       (and known (number? relative-space) (number? layout-space)
            (or (eq? stencil #f) (ly:stencil? stencil) (not completed?))
         (list (length positions) positions (* layout-space relative-space) layout-space
               (or (eq? stencil #f) (eq? (ly:grob-property-data grob 'transparent) #t)
                   (and (ly:stencil? stencil) (ly:stencil-empty? stencil)))
               (xml-color (if (null? color) #f color)) (and (number? base) (number? factor) (* base factor))))))
   (define (emit staff moment count positions space layout-space hidden custom present color line-width)
     (set! ed-events
       (cons `((k . stafflines) (s . ,staff)
               (m . ,(ly:moment-main moment)) (g . ,(ly:moment-grace moment))
               (count . ,count) (positions . ,positions)
               (staff-space . ,(+ 0.0 space)) (layout-staff-space . ,(+ 0.0 layout-space))
               (hidden . ,hidden) (custom . ,custom) (present . ,present)
               (color . ,color) (line-width . ,line-width)) ed-events)))
   (for-each
    (lambda (context-entry)
      (let* ((staff (vector-ref context-entry 0))
             (start (vector-ref context-entry 1)) (finish (vector-ref context-entry 2))
             (entries (filter (lambda (e) (= (cadr e) staff)) (reverse xml-staff-line-grobs)))
             (previous #f))
        (define (absent moment)
          ; With no StaffSymbol, Staff_symbol_referencer::staff_space is 1.0.
          ; A logical five-line grid can therefore remain with all ink hidden.
          (emit staff moment 0 '#() 1 1 #t #f #f #f 'null))
        (when (or (null? entries) (ly:moment<? start (caddr (car entries)))) (absent start))
        (for-each
         (lambda (entry)
           (ed-guard 'staff-lines
             (lambda ()
               (let* ((grob (car entry)) (moment (caddr entry))
                      (pieces (if completed? (hashq-ref members grob '()) (list grob)))
                      (values (map properties pieces))
                      (valid (and (pair? values) (car values)
                                  (every (lambda (v) (equal? v (car values))) values)))
                      (value (and valid (car values)))
                      (positions (if value (list-ref value 1) #f))
                      (count (if value (car value) 0))
                      (space (if value (list-ref value 2) 1))
                      (layout-space (if value (list-ref value 3) 1))
                      (hidden (if value (list-ref value 4) (null? pieces)))
                      (color (and value (list-ref value 5)))
                      (line-width (and value (list-ref value 6)))
                      (stencil (list-ref entry 3))
                      (after (list-ref entry 4))
                      (custom (or (not (or (eq? stencil #f) (eq? stencil ly:staff-symbol::print)))
                                  (not (or (eq? after #f) (null? after)))
                                  (and (pair? pieces) (not valid))))
                      (signature (list count positions space layout-space hidden custom color line-width))
                      (end (list-ref entry 5)))
                 (unless (equal? signature previous)
                   (set! previous signature)
                   (emit staff moment count
                     (if positions (list->vector (map (lambda (p) (+ 0.0 p)) positions)) 'null)
                     space layout-space hidden custom (if (null? pieces) #f #t) color (if line-width (+ 0.0 line-width) 'null)))
                 (when (and (ly:moment? end) (ly:moment? finish) (ly:moment<? end finish)
                            (not (any (lambda (other) (equal? (caddr other) end)) entries)))
                   (absent end) (set! previous #f))))))
         entries)))
    (reverse xml-staff-line-contexts))
   (xml-reset-staff-lines!))
#(define (xml-staff-lines-engraver ctx)
   (let ((context-entry #f))
     (make-engraver
       ((initialize engraver)
        (set! context-entry (vector (ed-context-id ctx) (ly:context-current-moment ctx) #f))
        (set! xml-staff-line-contexts (cons context-entry xml-staff-line-contexts)))
       (acknowledgers
         ((staff-symbol-interface engraver grob source)
          (when (eq? ctx (ly:translator-context source))
            (set! xml-staff-line-grobs
              (cons (list grob (ed-context-id ctx) (ly:context-current-moment ctx)
                          (ly:grob-property-data grob 'stencil)
                          (ly:grob-property-data grob 'after-line-breaking) #f)
                    xml-staff-line-grobs)))))
       ((finalize engraver)
        (for-each (lambda (entry)
          (when (= (cadr entry) (ed-context-id ctx))
            (let* ((bound (ly:spanner-bound (car entry) RIGHT #f))
                   (end (and (ly:grob? bound) (ly:grob-property-data bound 'when))))
              (set-car! (list-tail entry 5) end)))) xml-staff-line-grobs)
        (vector-set! context-entry 2 (ly:context-current-moment ctx))))))

\layout {
  \context { \DrumVoice \consists #xml-percussion-engraver }
  \context { \Staff \consists #xml-staff-lines-engraver }
  \context { \DrumStaff \consists #xml-staff-lines-engraver }
  \context { \RhythmicStaff \consists #xml-staff-lines-engraver }
}

% Score lifecycle owned by this collector.
#(xml-define-collector-state percussion metadata
 (xml-staff-line-grobs xml-staff-line-contexts)
 (reset )
 (clear ))
