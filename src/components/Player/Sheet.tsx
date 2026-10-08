import { useEffect, type ReactNode } from 'react';

interface Props {
  title?: string;
  onClose: () => void;
  children: ReactNode;
}

/** Moises-style bottom sheet. */
export function Sheet({ title, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grabber" />
        {title && <h3 className="sheet__title">{title}</h3>}
        {children}
      </div>
    </div>
  );
}

export function MenuItem({ children, onClick, active }: { children: ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" className={`menu-item ${active ? 'menu-item--active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

export function Stepper({
  value,
  onMinus,
  onPlus,
  label,
}: {
  value: ReactNode;
  onMinus: () => void;
  onPlus: () => void;
  label: string;
}) {
  return (
    <div className="stepper" aria-label={label}>
      <button type="button" className="stepper__btn" aria-label={`Decrease ${label}`} onClick={onMinus}>
        −
      </button>
      <span className="stepper__value">{value}</span>
      <button type="button" className="stepper__btn" aria-label={`Increase ${label}`} onClick={onPlus}>
        +
      </button>
    </div>
  );
}
