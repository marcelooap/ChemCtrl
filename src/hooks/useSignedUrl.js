import { useState, useEffect } from 'react';
// eslint-disable-next-line
import { getSignedFileUrl } from '@/api/storage'; // storage module (split from supabaseClient)

/**
 * useSignedUrl — generates a time-limited signed URL for a private Supabase Storage file.
 * Re-generates when the source URL changes.
 *
 * @param {string} url — file path ("fotos-cq/123.jpg") or legacy public URL
 * @returns {{ signedUrl: string|null, loading: boolean }}
 */
export function useSignedUrl(url) {
  const [signedUrl, setSignedUrl] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!url) {
      setSignedUrl(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getSignedFileUrl(url)
      .then((signed) => { if (!cancelled) setSignedUrl(signed); })
      .catch(() => { if (!cancelled) setSignedUrl(url); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url]);

  return { signedUrl, loading };
}
