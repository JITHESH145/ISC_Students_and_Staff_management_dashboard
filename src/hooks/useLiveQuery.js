import { useEffect, useRef, useState } from 'react';

// useLiveQuery — bind a real-time Firestore subscription to component state.
//
//   const [batches, loading] = useLiveQuery(
//     (cb) => subscribeBatches(cb),   // subscribe factory: gets a setter, returns unsub
//     [/* deps */]                    // re-subscribe when these change
//   );
//
// The factory receives a callback and MUST return the unsubscribe function
// (every services.js `subscribe*` already does). Data flows in live — no
// manual reload after a mutation, and other users' changes appear on their
// own. `setData` is returned for optimistic tweaks if a page needs it.
export function useLiveQuery(subscribe, deps = [], initial = []) {
  const [data, setData]       = useState(initial);
  const [loading, setLoading] = useState(true);
  const subRef = useRef(subscribe);
  subRef.current = subscribe;

  useEffect(() => {
    setLoading(true);
    const unsub = subRef.current((rows) => {
      setData(rows);
      setLoading(false);
    });
    return typeof unsub === 'function' ? unsub : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return [data, loading, setData];
}
