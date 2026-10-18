#(define (xml-technique-engraver ctx)
   (let ((grobs '()))
     (define (remember grob name)
       (set! grobs (cons (list grob name (ly:context-current-moment ctx)) grobs)))
     (make-engraver
      (acknowledgers
       ((stroke-finger-interface engraver grob source-engraver)
        (remember grob 'stroke-finger-event))
       ((bend-after-interface engraver grob source-engraver)
        (remember grob 'bend-after-event)))
      ((finalize engraver)
       (for-each
        (lambda (entry)
          (ed-guard 'technique
            (lambda ()
              (let* ((grob (car entry)) (name (cadr entry)) (moment (caddr entry))
                     (event (ly:grob-property grob 'cause))
                     (id (and (ly:stream-event? event) (xml-script-id event)))
                     (bend? (eq? name 'bend-after-event))
                     (supports (if bend? (list (ly:spanner-bound grob LEFT))
                                   (ly:grob-array->list (ly:grob-object grob 'side-support-elements))))
                     (head (find (lambda (g) (and (ly:grob? g) (grob::has-interface g 'note-head-interface))) supports))
                     (note (and head (ly:grob-property head 'cause)))
                     (raw-stencil (ly:grob-property-data grob 'stencil))
                     (stencil (if (ly:unpure-pure-container? raw-stencil)
                                  (ly:unpure-pure-container-unpure-part raw-stencil) raw-stencil)))
                (when id
                  (set! ed-events
                    (cons
                     `((k . script) (id . ,id)
                       (v . ,(ed-context-id ctx)) (s . ,(ed-context-id (ly:context-parent ctx)))
                       (articulation . ,(symbol->string name)) (glyph . "")
                       (nid . ,(if (ly:stream-event? note) (ly:event-property note 'ed-note-id 'null) 'null))
                       (text . ,(if bend? 'null (xml-markup-tree (ly:grob-property grob 'text ""))))
                       (delta . ,(if bend? (ly:grob-property grob 'delta-position 0) 'null))
                       (direction . ,(xml-grob-direction grob 0))
                       (axis . ,(ly:grob-property grob 'side-axis 1)) (staff-position . null)
                       (font-size . ,(ly:grob-property grob 'font-size 0))
                       (font-style . ,(if (eq? (ly:grob-property grob 'font-shape 'italic) 'upright) "normal" "italic"))
                       (hidden . ,(or (eq? stencil #f) (eq? (ly:grob-property grob 'transparent #f) #t)))
                       (custom . ,(not (or (eq? stencil #f)
                                          (eq? stencil (if bend? bend::print ly:text-interface::print)))))
                       (m . ,(ly:moment-main moment)) (g . ,(ly:moment-grace moment)))
                     ed-events)))))))
        (reverse grobs))))))
\layout {
  \context { \Voice \consists #xml-technique-engraver }
  \context { \CueVoice \consists #xml-technique-engraver }
  \context { \DrumVoice \consists #xml-technique-engraver }
  \context { \TabVoice \consists #xml-technique-engraver }
}
