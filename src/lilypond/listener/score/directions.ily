% Read a grob's stored direction without running its callback. `ly:grob-property` would
% invoke the Stem/Beam direction callbacks, which compute vertical pure heights and abort
% before line breaking when an engraver finalizes.
#(define (xml-grob-direction grob fallback)
   (let ((value (ly:grob-property-data grob 'direction)))
     (if (number? value) value fallback)))
