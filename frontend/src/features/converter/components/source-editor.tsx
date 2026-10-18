import { useRef, useState, type ChangeEvent } from 'react';
import { useDropzone } from 'react-dropzone';
import { Check, FileMusic, Paperclip, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { EdgeFlames } from '@/components/edge-flames';
import { errorMessage, UserFacingError } from '@/lib/error-message';
import { example } from '../example';
import type { SourceInput } from '../types';

interface SourceEditorProps {
  input: SourceInput;
  disabled: boolean;
  reading: boolean;
  onReadingChange: (reading: boolean) => void;
  onChange: (input: SourceInput) => void;
}

export function SourceEditor({
  input,
  disabled,
  reading,
  onReadingChange,
  onChange,
}: SourceEditorProps) {
  const [mode, setMode] = useState('upload');
  const [error, setError] = useState<string | null>(null);
  const attachments = useRef<HTMLInputElement>(null);
  const locked = disabled || reading;
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'text/plain': ['.ly', '.ily'] },
    multiple: false,
    maxSize: 5 * 1024 * 1024,
    disabled: locked,
    onDropRejected: () => setError('Choose one .ly or .ily file, up to 5 MB.'),
    onDropAccepted: async ([file]) => {
      if (!file) {
        return;
      }

      onReadingChange(true);
      setError(null);

      try {
        const source = await file.text();

        if (!source.trim()) {
          throw new UserFacingError(
            'This file is empty. Choose a LilyPond file with a score in it.',
          );
        }

        onChange({ source, filename: file.name, files: {} });
      } catch (cause) {
        setError(errorMessage(cause, 'This file could not be read. Try choosing it again.'));
      } finally {
        onReadingChange(false);
      }
    },
  });

  function loadExample() {
    onChange(example);
    setError(null);
    setMode('paste');
  }

  function editSource(event: ChangeEvent<HTMLTextAreaElement>) {
    setError(null);
    onChange({ ...input, source: event.target.value });
  }

  async function addIncludes(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);

    event.target.value = '';
    onReadingChange(true);
    setError(null);

    try {
      if (files.some((file) => !/\.(ly|ily)$/i.test(file.name) || file.size > 5 * 1024 * 1024)) {
        throw new UserFacingError('Include files must be .ly or .ily files, up to 5 MB each.');
      }

      const contents = await Promise.all(
        files.map(async (file) => [file.name, await file.text()] as const),
      );

      onChange({ ...input, files: { ...input.files, ...Object.fromEntries(contents) } });
    } catch (cause) {
      setError(errorMessage(cause, 'An attached file could not be read. Try choosing it again.'));
    } finally {
      onReadingChange(false);
    }
  }

  function removeInclude(filename: string) {
    onChange({
      ...input,
      files: Object.fromEntries(Object.entries(input.files).filter(([name]) => name !== filename)),
    });
  }

  return (
    <div className='source-editor'>
      <Tabs value={mode} onValueChange={setMode}>
        <div className='input-toolbar'>
          <TabsList aria-label='Score input method'>
            <TabsTrigger value='upload' disabled={locked}>
              <Upload />
              Upload
            </TabsTrigger>
            <TabsTrigger value='paste' disabled={locked}>
              <FileMusic />
              Paste
            </TabsTrigger>
          </TabsList>
          <Button
            variant='ghost'
            className='example-button'
            onClick={loadExample}
            disabled={locked}
          >
            Example
            <FileMusic />
          </Button>
        </div>
        <TabsContent value='upload'>
          <div
            {...getRootProps({
              className: 'upload-zone',
              'data-dragging': isDragActive,
              'aria-disabled': locked,
              role: 'button',
              'aria-label': 'Upload a LilyPond file',
            })}
          >
            <input {...getInputProps({ 'aria-label': 'LilyPond file' })} />
            <EdgeFlames active={isDragActive || reading} disabled={locked} />
            <span className='score-file' aria-hidden='true'>
              <FileMusic strokeWidth={1.25} />
            </span>
            <h2>
              {reading
                ? 'Reading…'
                : isDragActive
                  ? 'Drop it here.'
                  : input.source
                    ? input.filename
                    : 'Upload a LilyPond file'}
            </h2>
            <span className='file-hint'>{input.source ? <Check /> : '.ly / .ily'}</span>
          </div>
        </TabsContent>
        <TabsContent value='paste'>
          <div className='code-editor'>
            <div className='code-caption'>
              <label htmlFor='lilypond-source'>LilyPond source</label>
            </div>
            <Textarea
              id='lilypond-source'
              value={input.source}
              onChange={editSource}
              disabled={locked}
              spellCheck={false}
              autoCapitalize='off'
              autoCorrect='off'
              placeholder={'\\version "2.26.0"\n\\relative c\' {\n  c4 d e f | g1\n}'}
            />
          </div>
        </TabsContent>
      </Tabs>
      {input.source && (
        <div className='include-files'>
          <input
            ref={attachments}
            type='file'
            accept='.ly,.ily'
            multiple
            className='sr-only'
            tabIndex={-1}
            aria-label='Include files'
            onChange={addIncludes}
            disabled={locked}
          />
          <Button variant='ghost' onClick={() => attachments.current?.click()} disabled={locked}>
            <Paperclip />
            Include files
          </Button>
          {Object.keys(input.files).map((filename) => (
            <Button
              key={filename}
              variant='secondary'
              onClick={() => removeInclude(filename)}
              disabled={locked}
              aria-label={`Remove ${filename}`}
            >
              {filename}
              <X />
            </Button>
          ))}
        </div>
      )}
      {error && (
        <p className='input-error' role='alert'>
          {error}
        </p>
      )}
    </div>
  );
}
