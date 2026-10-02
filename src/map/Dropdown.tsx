import { useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { useDismiss } from '../hooks';

type DropdownProps = {
  trigger: (isOpen: boolean, toggle: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  /** CSS classes of the wrapper; `contents` lets the popover position itself against an outer element */
  className?: string;
};

/** A button plus a popover that closes on outside click or Escape. */
export function Dropdown({ trigger, children, className = 'relative' }: DropdownProps) {
  const [isOpen, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss<HTMLDivElement>(isOpen, close);
  return (
    <div ref={ref} className={className}>
      {trigger(isOpen, () => setOpen((open) => !open))}
      {isOpen && children(close)}
    </div>
  );
}

type RadioMenuProps<T> = { heading?: string; options: { value: T; label: string }[]; selected: T; onSelect: (value: T) => void };

/** Pick-one menu with an optional heading and a check mark on the selected option. */
export function RadioMenu<T>({ heading, options, selected, onSelect }: RadioMenuProps<T>) {
  return (
    <div className="pop top-[42px] left-0 max-h-[360px] min-w-full overflow-auto" role="menu" aria-label={heading}>
      {heading && (
        <div className="cursor-default px-2.5 pt-2 pb-1 text-xs font-semibold text-muted select-none" aria-hidden="true">
          {heading}
        </div>
      )}
      {options.map((option) => (
        <button
          key={String(option.value)}
          className="menu-item"
          role="menuitemradio"
          aria-checked={option.value === selected}
          onClick={() => onSelect(option.value)}
        >
          {option.label} {option.value === selected && <Check size={16} />}
        </button>
      ))}
    </div>
  );
}
