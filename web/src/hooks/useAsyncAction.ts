import { useRef, useState } from 'react';

/** Runs an async action with a pending flag; no-ops if already in flight. */
export function useAsyncAction() {
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  const run = async (action: () => Promise<void>) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await action();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return { pending, run };
}
