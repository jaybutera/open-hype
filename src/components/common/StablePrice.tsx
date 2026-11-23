import { useRef, type CSSProperties } from 'react';

interface Props {
  /** Text to show, already formatted. */
  text: string;
  /** Width resets when this changes (e.g. the asset), so a new asset starts at its own size. */
  resetKey: string;
  style?: CSSProperties;
}

/**
 * Live-updating number that never changes the size of its box.
 *
 * Digits are tabular so every digit takes the same width, and the box only grows:
 * it keeps the widest text seen for the current resetKey, so a price that drops a
 * trailing digit (63,455.25 -> 63,455.5) leaves its slot the same width instead of
 * shrinking and pulling the rest of the header around on every tick.
 */
export function StablePrice({ text, resetKey, style }: Props) {
  const widest = useRef({ key: resetKey, chars: 0 });
  if (widest.current.key !== resetKey) widest.current = { key: resetKey, chars: 0 };
  widest.current.chars = Math.max(widest.current.chars, text.length);
  return (
    <span
      style={{
        display: 'inline-block',
        minWidth: `${widest.current.chars}ch`,
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {text}
    </span>
  );
}
