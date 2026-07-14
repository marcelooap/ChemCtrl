import React from 'react';
import { usePermissions } from '@/lib/rbac/PermissionProvider';

/**
 * Declarative UI gate.
 * @example <Can permission="recipes.edit"><Button>Edit</Button></Can>
 * @example <Can anyOf={['recipes.edit','recipes.approve']}>...</Can>
 */
export function Can({
  permission,
  anyOf,
  allOf,
  resource,
  action = 'view',
  fallback = null,
  children,
}) {
  const { hasPermission, hasAnyPermission, hasAllPermissions, can } = usePermissions();

  let allowed = false;
  if (permission) allowed = hasPermission(permission);
  else if (anyOf) allowed = hasAnyPermission(anyOf);
  else if (allOf) allowed = hasAllPermissions(allOf);
  else if (resource) allowed = can(resource, action);

  if (!allowed) return fallback;
  return <>{children}</>;
}

export default Can;
