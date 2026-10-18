% Final system metadata uses the same translated score, never a second layout pass.
% Paper normalization arithmetic is pinned to LilyPond 2.26 Output_def::normalize.
#(define xml-final-layout-failure #f)
#(define (xml-reset-final-layout!)
   (xml-reset-collectors! 'layout))
% Clone-only literal port of the arithmetic branches in v2.26.0 Output_def::normalize.
#(define (xml-final-overlay! target source)
 (module-for-each (lambda (symbol variable)
  (when (variable-bound? variable)
   (ly:output-def-set-variable! target symbol (variable-ref variable))))
  (ly:output-def-scope source)))
#(define (xml-final-resolved-paper)
 (let ((paper (ly:output-def-clone (ly:parser-lookup '$defaultpaper))))
  (for-each (lambda (source) (xml-final-overlay! paper source)) (reverse ed-book-papers))
  (let* ((get (lambda (key) (ly:output-def-lookup paper key 'xml-final-unset)))
         (unset? (lambda (v) (eq? v 'xml-final-unset)))
         (two (get 'two-sided)) (pw (get 'paper-width))
         (ld (get (if two 'outer-margin-default-scaled 'left-margin-default-scaled)))
         (rd (get (if two 'inner-margin-default-scaled 'right-margin-default-scaled)))
         (l (get (if two 'outer-margin 'left-margin)))
         (r (get (if two 'inner-margin 'right-margin)))
         (width (get 'line-width))
         (binding (if two (ly:output-def-lookup paper 'binding-offset 0) 0))
         (left 0) (right 0))
   (if (unset? width)
    (begin (set! left (if (unset? l) ld l))
           (set! right (+ (if (unset? r) rd r) binding))
           (set! width (- pw left right)))
    (if (unset? l)
     (if (unset? r)
      (begin (set! left (/ (- pw width) 2)) (set! right left))
      (begin (set! right (+ r binding)) (set! left (- pw width right))))
     (begin (set! left l) (set! right (+ (if (unset? r) (- pw width left) r) binding)))))
   (when (and (get 'check-consistency)
              (or (> (abs (- pw width left right)) 1e-6) (< left 0) (< right 0)))
    (set! width (- pw ld rd)) (set! left ld) (set! right rd)
    (ly:warning "Final layout: margins do not fit the paper; using LilyPond default margins."))
   (ly:output-def-set-variable! paper 'left-margin left)
   (ly:output-def-set-variable! paper 'right-margin right)
   (ly:output-def-set-variable! paper 'line-width width)

   paper)))
#(define (xml-final-scaled-layout score)
 (let* ((paper (xml-final-resolved-paper))
        (layout (ly:output-def-clone
          (or (find (lambda (def) (eq? (ly:output-def-lookup def 'output-def-kind) 'layout)) (ly:score-output-defs score))
              (ly:parser-lookup '$defaultlayout)))))
  (module-for-each
   (lambda (symbol variable)
    (when (and (variable-bound? variable)
               (eq? (ly:output-def-lookup layout symbol 'xml-final-unset) 'xml-final-unset))
     (ly:output-def-set-variable! layout symbol (variable-ref variable))))
   (ly:output-def-scope paper))
  (scale-layout layout (ly:paper-outputscale paper))))

#(define (xml-final-layout-definition fallback score)
   (catch #t
     (lambda () (xml-final-scaled-layout score))
     (lambda (key . args)
       (set! xml-final-layout-failure
         (format #f "Final layout preparation failed: ~a ~s" key args))
       fallback)))
% Avoid forcing an expensive drawing that the native serializer must reject.
% This is deliberately only a sufficient test: identical nonzero spans, not
% an arbitrary count of simultaneous voices or unresolved/zero-width spans.
#(define (xml-final-native-capacity-failure)
 (let ((groups (make-hash-table)) (anchors (make-hash-table)) (staffs (make-hash-table))
       (notes (filter (lambda (e) (eq? (assoc-get 'k e) 'note)) ed-events)))
  (define (bounds e)
   (let ((m (assoc-get 'm e)) (g (assoc-get 'g e))
         (em (assoc-get 'end-m e)) (eg (assoc-get 'end-g e)))
    (and (eq? (assoc-get 'resolved-start e) #t)
     (every (lambda (n) (and (number? n) (exact? n) (rational? n))) (list m g em eg))
     (or (< m em) (and (= m em) (< g eg))) (list m g em eg))))
  (define (actual-anchor? ids voice staff main grace)
   (and (integer? staff) (vector? ids) (> (vector-length ids) 0)
    (every (lambda (id)
     (equal? (hash-ref anchors (list voice id main grace) #f) (list staff)))
     (vector->list ids))))
  (for-each (lambda (n)
   (let ((key (list (assoc-get 'v n) (assoc-get 'nid n) (assoc-get 'm n) (assoc-get 'g n))))
    (hash-set! anchors key (cons (assoc-get 's n) (hash-ref anchors key '())))
    (hash-set! staffs (assoc-get 's n) #t))) notes)
  ; Percent normalization may omit crossing spans; leave that path to TS.
  (and (not (any (lambda (e) (eq? (assoc-get 'k e) 'percent)) ed-events))
   (any (lambda (e)
    (let* ((kind (assoc-get 'k e)) (b (bounds e))
           (staff (assoc-get 's e)) (voice (assoc-get 'v e))
           (id (assoc-get 'id e))
           (key (and b (integer? id)
            (cond
             ((and (eq? kind 'bracket) (integer? staff)
                (hash-ref staffs staff #f))
              (list 'bracket staff b))
             ((and (eq? kind 'slur) (integer? voice)
                (actual-anchor? (assoc-get 'from e) voice staff (car b) (cadr b))
                (actual-anchor? (assoc-get 'to e) voice staff (caddr b) (cadddr b)))
              (list 'slur voice b (assoc-get 'from e) (assoc-get 'to e)))
             (else #f)))))
     (and key
      (let* ((identity (list (if (eq? kind 'bracket) (assoc-get 'context e) voice) id))
             (previous (hash-ref groups key '()))
             (next (if (member identity previous) previous (cons identity previous))))
       (hash-set! groups key next)
       (and (> (length next) 16)
        (format #f "Final layout skipped: more than 16 identical resolved ~a spans must be rejected by the native MusicXML serializer." kind)))))) ed-events))))
% Participation and completion share this ordered list. Figures update semantic
% rows before snapshot collection; slurs add geometry after the snapshot commit.
% Defer callbacks until capture: some finalizers are defined by later includes.
#(define-record-type <xml-final-layout-participant>
   (make-xml-final-layout-participant name stage pending? finish)
   xml-final-layout-participant?
   (name xml-final-layout-participant-name)
   (stage xml-final-layout-participant-stage)
   (pending? xml-final-layout-participant-pending?)
   (finish xml-final-layout-participant-finish))
#(define xml-final-layout-participants
   (list
     (make-xml-final-layout-participant 'figures 'figures
       (lambda () (pair? xml-figure-positions))
       (lambda ()
         (xml-finish-figure-positions!)))
     (make-xml-final-layout-participant 'names 'pieces
       (lambda () (pair? xml-name-originals))
       (lambda ()
         (xml-final-name-pieces)))
     (make-xml-final-layout-participant 'duration-lines 'pieces
       (lambda () (pair? xml-duration-originals))
       (lambda ()
         (xml-final-duration-lines)))
     (make-xml-final-layout-participant 'ligatures 'pieces
       (lambda () (pair? xml-ligature-originals))
       (lambda ()
         (xml-final-ligatures)))
     (make-xml-final-layout-participant 'finger-glides 'pieces
       (lambda () (pair? xml-finger-originals))
       (lambda ()
         (xml-final-finger-glides)))
     (make-xml-final-layout-participant 'episemas 'pieces
       (lambda () (pair? xml-episema-originals))
       (lambda ()
         (xml-final-episemas)))
     (make-xml-final-layout-participant 'optional-material 'pieces
       (lambda () (pair? xml-optional-material-originals))
       (lambda ()
         (xml-final-optional-material)))
     (make-xml-final-layout-participant 'bends 'pieces
       (lambda () (pair? xml-bend-originals))
       (lambda ()
         (xml-final-bends)))
     (make-xml-final-layout-participant 'measure-counters 'pieces
       (lambda () (pair? xml-measure-counter-originals))
       (lambda ()
         (xml-final-measure-counters)))
     (make-xml-final-layout-participant 'footnotes 'pieces
       (lambda () (pair? xml-footnote-originals))
       (lambda ()
         (xml-final-footnotes)))
     (make-xml-final-layout-participant 'lyric-extenders 'pieces
       (lambda () (pair? xml-lyric-extender-originals))
       (lambda ()
         (xml-final-lyric-extenders)))
     (make-xml-final-layout-participant 'combine-text 'pieces
       (lambda () (pair? xml-combine-text-originals))
       (lambda ()
         (xml-final-combine-text #t)))
     (make-xml-final-layout-participant 'vowel-transitions 'pieces
       (lambda () (pair? xml-vowel-transition-originals))
       (lambda ()
         (xml-final-vowel-transitions)))
     (make-xml-final-layout-participant 'note-positions 'pieces
       (lambda () (pair? xml-note-position-originals))
       (lambda ()
         (xml-final-note-positions)))
     (make-xml-final-layout-participant 'measure-layout 'pieces
       (lambda () (pair? xml-measure-layout-originals))
       (lambda ()
         (xml-final-measure-layout)))
     (make-xml-final-layout-participant 'barlines 'pieces
       (lambda () (pair? xml-barline-originals))
       (lambda ()
         (xml-final-barlines)))
     (make-xml-final-layout-participant 'accidentals 'pieces
       (lambda () (pair? xml-accidental-originals))
       (lambda ()
         (xml-final-accidentals)))
     (make-xml-final-layout-participant 'ties 'pieces
       (lambda () (pair? xml-tie-originals))
       (lambda ()
         (xml-final-ties)))
     (make-xml-final-layout-participant 'text-columns 'pieces
       (lambda () (pair? xml-text-column-originals))
       (lambda ()
         (xml-final-text-column-positions)))
     (make-xml-final-layout-participant 'slurs 'slurs
       (lambda () (pair? xml-slur-originals))
       (lambda ()
         (xml-final-slur-geometries)))))
#(define (xml-final-layout-stage-participants stage)
   (filter
     (lambda (participant)
       (eq? stage (xml-final-layout-participant-stage participant)))
     xml-final-layout-participants))
#(define (xml-final-layout-participant-pending-now? participant)
   ((xml-final-layout-participant-pending? participant)))
#(define (xml-finish-final-layout-participant! participant)
   ((xml-final-layout-participant-finish participant)))
#(define* (xml-finish-final-layout! global #:optional (completed? #f))
   (let ((attempted
           (any xml-final-layout-participant-pending-now?
             xml-final-layout-participants)))
     (when (and attempted (not xml-final-layout-failure))
       (set! xml-final-layout-failure (xml-final-native-capacity-failure)))
     (when (and attempted (not xml-final-layout-failure))
       (catch #t
         (lambda ()
           (let ((paper-score (and (not completed?) (ly:format-output global))))
             (unless completed?
               (ly:paper-score-paper-systems paper-score))
             (for-each xml-finish-final-layout-participant!
               (xml-final-layout-stage-participants 'figures))
             ; Commit only a complete snapshot; failures keep semantic name history.
             (let ((pieces
                     (apply append
                       (map xml-finish-final-layout-participant!
                         (xml-final-layout-stage-participants 'pieces)))))
               (when (any
                       (lambda (participant)
                         (and
                           (eq? 'ties (xml-final-layout-participant-name participant))
                           (xml-final-layout-participant-pending-now? participant)))
                       xml-final-layout-participants)
                 (set! ed-events
                   (filter
                     (lambda (event)
                       (not (eq? (assoc-get 'k event) 'tiegraphic)))
                     ed-events)))
               (for-each
                 (lambda (piece)
                   (set! ed-events (cons piece ed-events)))
                 pieces)
               (for-each xml-finish-final-layout-participant!
                 (xml-final-layout-stage-participants 'slurs)))))
         (lambda (key . args)
           (set! xml-final-layout-failure
             (format #f "Final layout capture failed at ~a: ~a ~s"
               xml-text-column-stage key args)))))
     (set! ed-events
       (cons `((m . 0)
               (g . 0)
               (k . finallayout)
               (stage . ,(if completed? 'book 'score))
               (status . ,(if xml-final-layout-failure 'failed 'complete))
               (attempted . ,attempted)
               (failure . ,(or xml-final-layout-failure 'null)))
         ed-events))
     (xml-clear-collected-layout!)))

% Score lifecycle owned by this collector.
#(xml-define-collector-state final-layout layout
 (xml-final-layout-failure)
 (reset (set! xml-final-layout-failure #f))
 (clear ))
