export interface VersionInfo {
  version: string;
  buildId: string;
  builtAt: string;
}

export interface UpdateContextValue {
  updateAvailable: boolean;
  currentVersion: string;
  availableVersion: string | null;
  nextVersion: string | null;
  isUpdating: boolean;
  applyUpdate: () => Promise<void>;
}

export type UpdateAvailableCallback = () => void;
