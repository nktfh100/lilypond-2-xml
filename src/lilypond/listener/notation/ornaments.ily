#(define xml-script-count 0)
#(define (xml-script-staff ctx)
   (let find ((context ctx))
     (cond ((not (ly:context? context)) ctx)
           ((or (ly:context-alias? context 'Staff) (ly:context-alias? context 'DrumStaff)) context)
           (else (find (ly:context-parent context))))))
#(define (xml-script-id event)
   (and (any (lambda (name) (memq name (ly:event-property event 'class)))
             '(articulation-event multi-measure-articulation-event stroke-finger-event bend-after-event breathing-event caesura-event))
        (or (ly:event-property event 'xml-script-id #f)
            (begin
              (set! xml-script-count (+ xml-script-count 1))
              (ly:event-set-property! event 'xml-script-id xml-script-count)
              xml-script-count))))
#(define (xml-font-points font layout)
   (let* ((scale (ly:output-def-lookup layout 'output-scale))
          (points (* (ly:font-design-size font) (ly:font-magnification font) scale (/ 72 25.4))))
     (if (and (real? points) (finite? points) (> points 0)) points 'null)))
#(define (xml-script-font-points grob)
   (catch #t
     (lambda () (xml-font-points (ly:grob-default-font grob) (ly:grob-layout grob)))
     (lambda args 'null)))
% Detect a missing feta glyph the way ly:script-interface::print does, but without
% calling the print callback. That callback resolves the script direction through
% the stem/beam pure-height chain and aborts before line breaking.
#(define (xml-script-glyph-missing grob glyphs direction)
   (define (pick-name entry)
     (if (pair? entry)
         (if (equal? direction 1) (cdr entry) (car entry))
         entry))
   (if (and (pair? glyphs) (eq? (car glyphs) 'feta))
       (let ((glyph (ly:font-get-glyph (ly:grob-default-font grob)
                                       (string-append "scripts." (pick-name (cdr glyphs))))))
         (and (ly:stencil? glyph) (ly:stencil-empty? glyph)))
       #t))
% Resolve a script's direction the way ly:script-interface::calc-direction does, but
% read the direction source through stored data and 'default-direction so no stem or
% beam callback computes pure heights. Those need line-break ranks that do not exist
% while engravers finalize.
#(define (xml-script-source-direction source)
   (let ((stored (ly:grob-property-data source 'direction)))
     (if (number? stored)
         stored
         (let ((default (ly:grob-property source 'default-direction)))
           (if (number? default) default 1)))))
#(define (xml-script-direction grob)
   (let ((stored (ly:grob-property-data grob 'direction)))
     (if (number? stored)
         stored
         (if (eqv? (ly:grob-property-data grob 'side-axis) 0)
             (let ((parent (ly:grob-parent grob 1)))
               (if (and (ly:grob? parent) (grob::has-interface parent 'note-head-interface)) -1 0))
             (let ((source (ly:grob-object grob 'direction-source #f))
                   (relative (ly:grob-property-data grob 'side-relative-direction)))
               (if (and (ly:grob? source) (grob::is-live? source))
                   (* (xml-script-source-direction source)
                      (if (number? relative) relative 1))
                   0))))))
#(define (xml-script-engraver ctx)
   (let ((scripts '()))
     (make-engraver
      (acknowledgers
       ((script-interface engraver grob source-engraver)
        (when (eq? ctx (ly:translator-context source-engraver))
          (set! scripts (cons (list grob (ly:context-current-moment ctx)) scripts)))))
      ((finalize engraver)
       (for-each
        (lambda (entry)
          (ed-guard 'script
            (lambda ()
              (let* ((grob (car entry)) (moment (cadr entry))
                     (event (ly:grob-property grob 'cause))
                     (id (and (ly:stream-event? event) (xml-script-id event)))
                     (axis (ly:grob-property grob 'side-axis 1))
                     (glyphs (ly:grob-property grob 'script-stencil))
                     (stencil (ly:grob-property-data grob 'stencil))
                     (direction (xml-script-direction grob))
                     (empty-glyph (and (eq? stencil ly:script-interface::print)
                                       (xml-script-glyph-missing grob glyphs direction))))
                (when id
                  (set! ed-events
                    (cons
                     `((k . script) (id . ,id)
                       (v . ,(ed-context-id ctx)) (s . ,(ed-context-id (xml-script-staff ctx)))
                       (articulation . ,(ed-value (ly:event-property event 'articulation-type "")))
                       (breath . ,(if (any (lambda (c) (memq c (ly:event-property event 'class))) '(breathing-event caesura-event)) #t #f))
                       (glyph . ,(if (and (pair? glyphs) (eq? (car glyphs) 'feta) (pair? (cdr glyphs)))
                                     (if (< direction 0) (cadr glyphs) (cddr glyphs)) ""))
                       (direction . ,direction)
                       (axis . ,axis)
                       (staff-position . ,(if (= axis 0) (ed-value (ly:grob-property grob 'staff-position)) 'null))
                       (font-size . ,(ly:grob-property grob 'font-size 0))
                       (font-points . ,(if empty-glyph 'null (xml-script-font-points grob)))
                       (glyph-missing . ,empty-glyph)
                       (color . ,(xml-color (ly:grob-property grob 'color #f)))
                       (offset . ,(xml-bracket-pair grob 'extra-offset '(0 . 0)))
                       (hidden . ,(or empty-glyph (eq? stencil #f) (eq? (ly:grob-property grob 'transparent #f) #t)))
                       (custom . ,(not (and (or (eq? stencil #f) (eq? stencil ly:script-interface::print))
                                          (pair? glyphs) (eq? (car glyphs) 'feta))))
                       (m . ,(ly:moment-main moment)) (g . ,(ly:moment-grace moment)))
                     ed-events)))))))
        (reverse scripts))))))
\layout {
  \context { \Staff \consists #xml-script-engraver }
  \context { \DrumStaff \consists #xml-script-engraver }
  \context { \TabStaff \consists #xml-script-engraver }
  \context { \RhythmicStaff \consists #xml-script-engraver }
  \context { \Voice \consists #xml-script-engraver }
  \context { \CueVoice \consists #xml-script-engraver }
  \context { \DrumVoice \consists #xml-script-engraver }
  \context { \TabVoice \consists #xml-script-engraver }
}

% Score lifecycle owned by this collector.
#(xml-define-collector-state ornaments semantic
 (xml-script-count)
 (reset (set! xml-script-count 0))
 (clear ))
