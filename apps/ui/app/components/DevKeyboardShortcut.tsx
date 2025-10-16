'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DevKeyboardShortcut() {
  const router = useRouter();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Cmd+Shift+D (Mac) or Ctrl+Shift+D (Windows/Linux)
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifierKey = isMac ? event.metaKey : event.ctrlKey;

      if (modifierKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        router.push('/dev');
      }
    };

    // Add event listener
    window.addEventListener('keydown', handleKeyDown);

    // Clean up on unmount
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [router]);

  // No UI - this component is invisible
  return null;
}
