#(define (xml-tab-visible? ctx name)
   (let ((definition (ly:context-grob-definition ctx name)))
     (not (eq? (assoc-get 'stencil definition #t) #f))))

#(define (xml-tab-selection ctx notes selections)
   (when (= (length notes) (length selections))
     (for-each
      (lambda (note selection)
        (let ((id (ly:event-property note 'ed-note-id #f)))
          (when (and id (pair? selection) (number? (car selection)))
            (ed-push! ctx
              `((k . tabnote) (nid . ,id)
                (s . ,(ed-context-id (ly:context-parent ctx)))
                (string . ,(car selection))
                (fret . ,(ed-value (cadr selection)))
                (stems . ,(xml-tab-visible? ctx 'Stem)))))))
      notes selections)))

#(define (xml-tab-voice-engraver ctx)
   (let ((wrapped #f))
     (define (install)
       (let ((original (ly:context-property ctx 'noteToFretFunction)))
         (when (and (procedure? original) (not (eq? original wrapped)))
           (set! wrapped
             (lambda args
               (let ((result (apply original args)))
                 (xml-tab-selection ctx (cadr args) result)
                 result)))
           (ly:context-set-property! ctx 'noteToFretFunction wrapped))))
     (make-engraver
      ((initialize engraver) (install))
      ((start-translation-timestep engraver) (install)))))

#(define (xml-tab-staff-engraver ctx)
   (let ((previous #f))
     (make-engraver
      (acknowledgers
       ((staff-symbol-interface engraver grob source-engraver)
        (ed-push! ctx `((k . stafflines) (s . ,(ed-context-id ctx))
                        (count . ,(ly:grob-property grob 'line-count 6))))))
      ((stop-translation-timestep engraver)
       (let ((settings (list (ly:context-property ctx 'stringTunings '())
                             (ly:context-property ctx 'stringOneTopmost #t)
                             (ly:context-property ctx 'capoFret 0)
                             (map (lambda (name) (cons name (xml-tab-visible? ctx name)))
                                  '(TimeSignature Stem Beam Dots Rest Tie DynamicText Hairpin TupletNumber TupletBracket TextScript Script)))))
         (when (not (equal? settings previous))
           (set! previous settings)
           (ed-push! ctx
             `((k . tabstaff) (s . ,(ed-context-id ctx))
               (tunings . ,(list->vector (map ed-pitch (car settings))))
               (topmost . ,(cadr settings))
               (capo . ,(caddr settings))
               (visibility . ,(cadddr settings))))))))))

\layout {
  \context { \TabVoice \consists #ed-voice-engraver \consists #xml-tab-voice-engraver }
  \context { \TabStaff \consists #ed-staff-engraver \consists #xml-transposition-engraver \consists #xml-tab-staff-engraver }
}
