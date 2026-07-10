import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  applyServiceWorkerUpdate,
  initServiceWorkerManager,
  onUpdateAvailable,
} from '../ServiceWorkerManager';
import { fetchAvailableVersion, getInstalledVersion } from '../version';
import { resolveNextVersion } from '../versionUtils';
import type { UpdateContextValue } from '../types';

export const UpdateContext = createContext<UpdateContextValue | null>(null);

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [nextVersion, setNextVersion] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const currentVersion = getInstalledVersion();

  const handleUpdateDetected = useCallback(async () => {
    setUpdateAvailable(true);
    const remote = await fetchAvailableVersion();
    setAvailableVersion(remote);
    setNextVersion(resolveNextVersion(currentVersion, remote));
  }, [currentVersion]);

  useEffect(() => {
    const cleanupSw = initServiceWorkerManager();
    const unsub = onUpdateAvailable(() => {
      handleUpdateDetected();
    });

    const onCustomEvent = () => handleUpdateDetected();
    window.addEventListener('pwa-update-available', onCustomEvent);

    return () => {
      cleanupSw();
      unsub();
      window.removeEventListener('pwa-update-available', onCustomEvent);
    };
  }, [handleUpdateDetected]);

  const applyUpdate = useCallback(async () => {
    setIsUpdating(true);
    await applyServiceWorkerUpdate();
  }, []);

  const value = useMemo(
    () => ({
      updateAvailable,
      currentVersion,
      availableVersion,
      nextVersion,
      isUpdating,
      applyUpdate,
    }),
    [updateAvailable, currentVersion, availableVersion, nextVersion, isUpdating, applyUpdate]
  );

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}
