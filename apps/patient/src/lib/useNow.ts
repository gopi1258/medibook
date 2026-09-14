/**
 * A ticking clock.
 *
 * Countdowns (the 5-minute hold), "Today · 6:30 PM" labels and the join window all
 * have to advance without a refetch. One interval per mounted consumer keeps this
 * simple; screens that only need a coarse value pass a longer `intervalMs`.
 */
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);

  return now;
}
