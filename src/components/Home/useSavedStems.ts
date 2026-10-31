import { useEffect, useState } from 'react';
import { onStemCacheChange, savedStems } from '../../lib/stemCache';

/** Stems saved on the device (absolute URL → bytes), kept fresh as songs are saved or removed. */
export function useSavedStems(): Map<string, number> {
  const [saved, setSaved] = useState<Map<string, number>>(() => new Map());
  useEffect(() => {
    let live = true;
    const refresh = () => void savedStems().then((m) => live && setSaved(m));
    refresh();
    const off = onStemCacheChange(refresh);
    return () => {
      live = false;
      off();
    };
  }, []);
  return saved;
}
