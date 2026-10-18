% Shared final line geometry used by line-spanner collectors.
#(define xml-line-measures '())
#(define (xml-reset-line-geometry!) (set! xml-line-measures '()))
#(define (xml-observe-line-measure! ctx)
 (let ((position (ly:context-property ctx 'measurePosition #f))
       (column (ly:context-property ctx 'currentCommandColumn #f))
       (staff (ed-context-id (xml-script-staff ctx))))
  (when (and (ly:moment? position) (equal? position ZERO-MOMENT) (ly:grob? column))
   (unless (find (lambda (entry) (and (eq? column (car entry)) (= staff (caddr entry)))) xml-line-measures)
    (set! xml-line-measures (cons (list column (ly:context-current-moment ctx) staff) xml-line-measures))))))
% The ordinary line stencil contains its FINAL padded endpoints, in grob space.
% Reject unrecognized operations rather than use an extent or a nominal bound.
#(define (xml-line-points expr dx dy)
   (cond
     ((and (pair? expr) (eq? (car expr) 'translate-stencil)
           (pair? (cadr expr)) (number? (caadr expr)) (number? (cdadr expr)))
      (xml-line-points (caddr expr) (+ dx (caadr expr)) (+ dy (cdadr expr))))
     ((and (list? expr) (= (length expr) 6) (eq? (car expr) 'draw-line)
           (every number? (cdr expr)))
      (list (cons (+ dx (list-ref expr 2)) (+ dy (list-ref expr 3)))
            (cons (+ dx (list-ref expr 4)) (+ dy (list-ref expr 5)))))
     ((and (list? expr) (= (length expr) 7) (eq? (car expr) 'dashed-line)
           (every number? (cdr expr)) (= (list-ref expr 6) 0))
      (list (cons dx dy)
            (cons (+ dx (list-ref expr 4)) (+ dy (list-ref expr 5)))))
     (else #f)))
#(define (xml-line-origin system moment owner)
   (and (ly:grob? system) (ly:moment? moment)
     (let* ((columns (ly:grob-object system 'columns #f))
            (actual (if (ly:grob-array? columns) (ly:grob-array->list columns) '()))
            (left (ly:spanner-bound system LEFT #f))
            (left-when (and (ly:grob? left) (ly:grob-property left 'when #f)))
            (matches (filter-map (lambda (entry)
              (and (= (caddr entry) owner) (moment<=? (cadr entry) moment)
                (cond ((memq (car entry) actual) (cons (car entry) (cadr entry)))
                  ;; The actual System LEFT bound is the start of a measure only
                  ;; when its moment is the independently captured measure start.
                  ((and (ly:grob? left) (ly:moment? left-when)
                        (moment<=? left-when (cadr entry)) (moment<=? (cadr entry) left-when))
                    (cons left (cadr entry)))
                  (else #f)))) xml-line-measures)))
       (and (pair? matches)
         (car (sort matches (lambda (a b) (not (moment<=? (cdr a) (cdr b))))))))))

% Score lifecycle owned by this collector.
#(xml-define-collector-state line-geometry layout
 (xml-line-measures)
 (reset (xml-reset-line-geometry!))
 (clear (xml-reset-line-geometry!)))
