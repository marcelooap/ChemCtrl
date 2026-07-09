import { useContext } from 'react';
import { UpdateContext } from '../context/UpdateProvider';

export function useUpdate() {
  const ctx = useContext(UpdateContext);
  if (!ctx) {
    throw new Error('useUpdate must be used within UpdateProvider');
  }
  return ctx;
}
