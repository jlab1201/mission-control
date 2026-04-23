'use client';

import { useLayoutEffect, useRef } from 'react';

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'details > summary',
].join(', ');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(
    (el) => !el.closest('[hidden]') && !el.closest('[aria-hidden="true"]'),
  );
}

/**
 * Traps keyboard focus within `containerRef`, moves focus to the container on
 * mount, and restores focus to the previously-focused element on unmount.
 *
 * @param containerRef  Ref attached to the dialog / drawer root element.
 * @param active        Pass `false` to disable the trap (e.g. while animating out).
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active = true,
): void {
  // Remember what was focused before the overlay opened.
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!active) return;

    // Store the currently-focused element so we can restore it on close.
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    // Move focus into the container.
    const container = containerRef.current;
    if (container) {
      container.focus();
    }

    return () => {
      // Restore focus when the component unmounts / trap deactivates.
      previousFocusRef.current?.focus();
    };
  }, [active, containerRef]);

  useLayoutEffect(() => {
    if (!active) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;

      const focusable = getFocusableElements(container);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement;

      if (e.shiftKey) {
        // Shift+Tab: if we're on the first element (or the container itself), wrap to last.
        if (active === first || active === container) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if we're on the last element (or the container itself), wrap to first.
        if (active === last || active === container) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [active, containerRef]);
}
