#(define ed-paper '())
#(define ed-book-papers '())
#(define (xml-paper-settings layout score)
   (let* ((paper (ly:parser-lookup '$defaultpaper))
          (score-layout (find (lambda (def) (eq? (ly:output-def-lookup def 'output-def-kind) 'layout)) (ly:score-output-defs score)))
          (sources (append ed-book-papers (list paper)))
          (lookup (lambda (name)
                    (let loop ((remaining (if (and score-layout (memq name '(indent short-indent staff-space))) (cons score-layout sources) sources)))
                      (if (null? remaining) #f
                          (let* ((source (car remaining))
                                 (variable (and (ly:output-def? source)
                                                (module-local-variable (ly:output-def-scope source) name))))
                            (if (and variable (variable-bound? variable)) (variable-ref variable)
                                (loop (cdr remaining)))))))))
     (filter-map
      (lambda (name)
        (let ((v (cond ((eq? name 'staff-space) (or (lookup name) (ly:output-def-lookup layout name #f)))
                        ((eq? name 'system-width) (and score-layout (let ((variable (module-local-variable (ly:output-def-scope score-layout) 'line-width))) (and variable (variable-bound? variable) (variable-ref variable)))))
                        (else (lookup name)))))
          (and (or (number? v) (memq name '(two-sided check-consistency))) (cons name v))))
      '(paper-width paper-height left-margin right-margin top-margin bottom-margin
        left-margin-default-scaled right-margin-default-scaled inner-margin-default-scaled outer-margin-default-scaled
        inner-margin outer-margin binding-offset first-page-number staff-space indent short-indent line-width system-width two-sided check-consistency))))

% Score lifecycle owned by this collector.
#(xml-define-collector-state paper metadata
 (ed-paper ed-book-papers)
 (reset )
 (clear ))
