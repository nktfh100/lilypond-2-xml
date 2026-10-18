import { ChevronDown, Info } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { conversionNotes } from '@/lib/conversion-notes';
import type { Diagnostic } from '@converter';

export function ConversionNotes({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const notes = conversionNotes(diagnostics);

  if (notes.length === 0) {
    return null;
  }

  return (
    <div className='conversion-notes'>
      <Collapsible className='notes-disclosure' defaultOpen>
        <CollapsibleTrigger className='notes-trigger'>
          <Info />
          <span>
            {notes.length} {notes.length === 1 ? 'thing' : 'things'} to check
          </span>
          <ChevronDown />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className='diagnostics-list'>
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
