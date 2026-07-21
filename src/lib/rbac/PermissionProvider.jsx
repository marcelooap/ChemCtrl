import React, { createContext, useContext, useMemo } from 'react';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import {
  getLegacyPermissionsForUser,
  getViewPermissionForPath,
  permissionKey,
} from '@/lib/rbac/permissionCatalog';

const PermissionsContext = createContext(null);

function resolvePermissions(user) {
  if (!user) return [];
  if (Array.isArray(user.permissions) && user.permissions.length > 0) {
    return user.permissions;
  }
  return getLegacyPermissionsForUser(user);
}

export function PermissionProvider({ children }) {
  const { user } = useInternalAuth();

  const value = useMemo(() => {
    const permissions = resolvePermissions(user);
    const permissionSet = new Set(permissions);

    const hasPermission = (key) => {
      if (!key) return false;
      return permissionSet.has(key);
    };

    const hasAnyPermission = (keys = []) => keys.some((k) => hasPermission(k));
    const hasAllPermissions = (keys = []) => keys.every((k) => hasPermission(k));

    const can = (resourceId, actionKey = 'view') =>
      hasPermission(permissionKey(resourceId, actionKey));

    const canAccessPath = (pathname) => {
      const viewKey = getViewPermissionForPath(pathname);
      if (!viewKey) return false;
      return hasPermission(viewKey);
    };

    const isReadOnlyPath = (pathname) => {
      const viewKey = getViewPermissionForPath(pathname);
      if (!viewKey) return false;
      if (!hasPermission(viewKey)) return true;
      const resourceId = viewKey.replace(/\.view$/, '');
      const writeKeys = [
        permissionKey(resourceId, 'create'),
        permissionKey(resourceId, 'edit'),
        permissionKey(resourceId, 'delete'),
        permissionKey(resourceId, 'create_op'),
        permissionKey(resourceId, 'edit_op'),
        permissionKey(resourceId, 'register_test'),
        permissionKey(resourceId, 'release_production'),
        permissionKey(resourceId, 'issue_coa'),
        permissionKey(resourceId, 'approve'),
        permissionKey(resourceId, 'manage_fds'),
      ];
      return !writeKeys.some((k) => hasPermission(k));
    };

    return {
      user,
      permissions,
      permissionSet,
      hasPermission,
      hasAnyPermission,
      hasAllPermissions,
      can,
      canAccessPath,
      isReadOnlyPath,
      perfil: user?.perfil || null,
    };
  }, [user]);

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) {
    throw new Error('usePermissions must be used within a PermissionProvider');
  }
  return ctx;
}

/** Optional hook when provider may be absent (e.g. public pages). */
export function usePermissionsOptional() {
  return useContext(PermissionsContext);
}
