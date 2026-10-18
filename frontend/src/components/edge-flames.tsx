interface EdgeFlamesProps {
  active?: boolean;
  disabled?: boolean;
}

export function EdgeFlames({ active = false, disabled = false }: EdgeFlamesProps) {
  return (
    <span className='edge-flames' data-active={active} data-disabled={disabled} aria-hidden='true'>
      {Array.from({ length: 4 }, (_, index) => (
        <svg key={index} viewBox='0 0 20 40'>
          <path d='M8 38C-2 28 8 21 7 12C13 17 14 10 13 2C23 17 13 22 16 29C19 37 12 41 8 38Z' />
        </svg>
      ))}
    </span>
  );
}
