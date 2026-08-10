// Generates a cryptographically secure, unguessable public token for lot traceability.
// 24 random bytes = 192 bits of entropy = 48 hex characters.
// Not derived from internal IDs, lot numbers, or any predictable source.

export const generatePublicToken = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
};
