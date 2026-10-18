import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ScorePreview as Preview } from '../types';

function SvgPage({ svg, label, zoom }: { svg: string; label: string; zoom: number }) {
  const image = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));

    if (image.current) {
      image.current.src = url;
    }

    return () => URL.revokeObjectURL(url);
  }, [svg]);

  return <img ref={image} alt={label} className='score-image' style={{ width: `${zoom}%` }} />;
}

interface ScorePreviewProps {
  title: string;
  preview: Preview | undefined;
}

export function ScorePreview({ title, preview }: ScorePreviewProps) {
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(100);
  const pages = preview?.pages ?? [];
  const svg = pages[page];

  return (
    <section className='score-preview' aria-label={`${title} preview`}>
      <div className='preview-heading'>
        <h3>{title}</h3>
      </div>
      {!preview ? (
        <div className='score-viewport preview-placeholder' aria-label={`${title} preview loading`}>
          <LoaderCircle className='loading-spinner' aria-hidden='true' />
          <span>Rendering…</span>
        </div>
      ) : preview.error ? (
        <div className='preview-error'>
          <p>Preview unavailable</p>
          <pre>{preview.error}</pre>
        </div>
      ) : (
        <>
          <div
            className='score-viewport'
            tabIndex={0}
            aria-label={`${title} score, scroll to explore`}
          >
            {svg && <SvgPage svg={svg} label={`${title}, page ${page + 1}`} zoom={zoom} />}
          </div>
          <div className='preview-controls'>
            <div className='page-controls'>
              <Button
                variant='ghost'
                size='icon'
                aria-label={`Previous ${title} page`}
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft />
              </Button>
              <span aria-live='polite'>
                {page + 1} / {pages.length}
              </span>
              <Button
                variant='ghost'
                size='icon'
                aria-label={`Next ${title} page`}
                disabled={page >= pages.length - 1}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight />
              </Button>
            </div>
            <div className='zoom-controls'>
              <Button
                variant='ghost'
                size='icon'
                aria-label={`Zoom out ${title}`}
                disabled={zoom <= 100}
                onClick={() => setZoom(zoom - 25)}
              >
                <Minus />
              </Button>
              <Button
                variant='ghost'
                aria-label={`Reset ${title} zoom`}
                onClick={() => setZoom(100)}
              >
                <RotateCcw />
                <span>{zoom}%</span>
              </Button>
              <Button
                variant='ghost'
                size='icon'
                aria-label={`Zoom in ${title}`}
                disabled={zoom >= 250}
                onClick={() => setZoom(zoom + 25)}
              >
                <Plus />
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
