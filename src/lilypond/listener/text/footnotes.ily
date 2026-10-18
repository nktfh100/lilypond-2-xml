% Footnote ownership follows the actual sticky host, never event/note order.
#(define xml-footnote-originals '())
#(define xml-footnote-count 0)
#(define (xml-clear-footnotes!) (set! xml-footnote-originals '()))
#(define (xml-reset-footnotes!) (xml-clear-footnotes!) (set! xml-footnote-count 0))
#(define (xml-footnote-engraver ctx)
   (make-engraver
    (acknowledgers
     ((footnote-interface engraver grob source)
      (when (and (eq? ctx (ly:translator-context source))
                 (eq? (assoc-get 'name (ly:grob-property grob 'meta)) 'Footnote))
        (set! xml-footnote-count (+ 1 xml-footnote-count))
        (xml-geometry-observe-root! ctx)
        (let* ((host (ly:grob-object grob 'sticky-host #f))
               (kind (and (ly:grob? host) (assoc-get 'name (ly:grob-property host 'meta))))
               (cause (and (ly:grob? host) (ly:grob-property host 'cause #f)))
               (defaults (assoc-get 'Footnote all-grob-descriptions))
               (custom (any (lambda (key)
                 (let* ((candidate (ly:grob-property-data grob key))
                        (raw (if (and (eq? key 'after-line-breaking) (procedure? candidate))
                          (or (procedure-property candidate 'xml-normal-original-after) candidate) candidate)))
                   (and (not (eq? raw #f)) (not (null? raw))
                        (not (eq? raw (assoc-get key defaults #f)))
                        (or (procedure? raw) (eq? key 'stencil)))))
                 '(stencil before-line-breaking after-line-breaking text footnote-text))))
          (set! xml-footnote-originals
            (cons (list grob xml-footnote-count (ed-context-id ctx)
                        (ed-context-id (xml-script-staff ctx)) (ly:context-current-moment ctx)
                        kind
                        (if (and (memq kind '(NoteHead TabNoteHead)) (ly:stream-event? cause))
                          (ly:event-property cause 'ed-note-id 'null) 'null)
                        (xml-bracket-stencil grob) custom)
                  xml-footnote-originals))))))))
#(define (xml-footnote-original? grob original)
   (and (ly:grob? grob)
        (or (eq? grob original) (eq? (ly:grob-original grob) original))))
#(define (xml-final-footnotes)
   (let ((systems (if (ly:grob? xml-geometry-root-system)
                     (xml-geometry-broken-pieces xml-geometry-root-system) '())))
     (append-map
      (lambda (entry)
       (let* ((original (car entry))
              (members (delete-duplicates (append-map
                (lambda (system)
                  (let ((array (ly:grob-object system 'all-elements)))
                    (if (ly:grob-array? array)
                      (filter (lambda (grob)
                        (and (eq? (ly:grob-system grob) system)
                             (xml-footnote-original? grob original)))
                        (ly:grob-array->list array)) '()))) systems)))
              (pieces (if (pair? members) members (list original)))
              (piece 0))
        (map (lambda (grob)
          (set! piece (+ piece 1))
          (let* ((body (ly:grob-property grob 'footnote-text #f))
                 (marker (ly:grob-property grob 'text #f))
                 (stencil (ly:grob-property grob 'stencil #f))
                 (live (grob::is-live? grob)) (moment (list-ref entry 4)))
            `((k . footnote) (id . ,(cadr entry)) (piece . ,piece)
              (context . ,(caddr entry)) (s . ,(list-ref entry 3))
              (m . ,(ly:moment-main moment)) (g . ,(ly:moment-grace moment))
              (host-kind . ,(or (list-ref entry 5) 'null)) (nid . ,(list-ref entry 6))
              (body . ,(if (markup? body) (ed-markup->string body) 'null))
              (markup . ,(if (markup? body) (xml-markup-tree body) 'null))
              (marker . ,(if (markup? marker) (ed-markup->string marker) 'null))
              (marker-markup . ,(if (markup? marker) (xml-markup-tree marker) 'null))
              (automatically-numbered . ,(eq? (ly:grob-property grob 'automatically-numbered #f) #t))
              (present . ,(and (if (memq grob members) #t #f) live))
              (marker-hidden . ,(or (eq? (list-ref entry 7) #f) (not live)
                (eq? (ly:grob-property grob 'transparent #f) #t)
                (not (ly:stencil? stencil))
                (and (ly:stencil? stencil) (ly:stencil-empty? stencil))))
              (custom . ,(if (list-ref entry 8) #t #f))))) pieces)))
      (reverse xml-footnote-originals))))
\layout {
  \context { \Voice \consists #xml-footnote-engraver }
  \context { \CueVoice \consists #xml-footnote-engraver }
  \context { \DrumVoice \consists #xml-footnote-engraver }
  \context { \TabVoice \consists #xml-footnote-engraver }
  \context { \Staff \consists #xml-footnote-engraver }
  \context { \DrumStaff \consists #xml-footnote-engraver }
  \context { \RhythmicStaff \consists #xml-footnote-engraver }
  \context { \TabStaff \consists #xml-footnote-engraver }
  \context { \Lyrics \consists #xml-footnote-engraver }
  \context { \PianoStaff \consists #xml-footnote-engraver }
  \context { \GrandStaff \consists #xml-footnote-engraver }
  \context { \StaffGroup \consists #xml-footnote-engraver }
  \context { \ChoirStaff \consists #xml-footnote-engraver }
  \context { \Score \consists #xml-footnote-engraver }
}

% Score lifecycle owned by this collector.
#(xml-define-collector-state footnotes layout
 (xml-footnote-originals xml-footnote-count)
 (reset (xml-reset-footnotes!))
 (clear (xml-clear-footnotes!)))
