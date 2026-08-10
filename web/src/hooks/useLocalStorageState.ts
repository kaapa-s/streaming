import { useState } from 'react';

export function useLocalStorageState(
  key: string,
  initialValue: string,
): [string, (value: string) => void] {
  const [value, setValue] = useState(() => localStorage.getItem(key) ?? initialValue);

  const setStored = (next: string) => {
    setValue(next);
    localStorage.setItem(key, next);
  };

  return [value, setStored];
}
