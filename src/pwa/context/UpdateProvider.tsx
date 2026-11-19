import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  const applyingRef = useRef(false);
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
    if (applyingRef.current) return;
    applyingRef.current = true;
    setIsUpdating(true);

    try {
      await applyServiceWorkerUpdate();
    } catch {
      // Fallback duro: se o fluxo do SW falhar, força navegação
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('_sw', String(Date.now()));
        window.location.replace(url.toString());
      } catch {
        window.location.reload();
      }
    } finally {
      // Se o reload não ocorrer (cenário raro), libera o botão após alguns segundos
      window.setTimeout(() => {
        applyingRef.current = false;
        setIsUpdating(false);
      }, 4000);
    }
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
