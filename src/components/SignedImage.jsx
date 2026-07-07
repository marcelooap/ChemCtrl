import { useSignedUrl } from '@/hooks/useSignedUrl';

/**
 * SignedImage — displays an image from a private Supabase Storage bucket.
 * Automatically generates a signed URL and shows a placeholder while loading.
 */
export default function SignedImage({ url, alt = '', className = '', fallbackClassName = '' }) {
  const { signedUrl, loading } = useSignedUrl(url);

  if (loading || !signedUrl) {
    return <div className={`${fallbackClassName || className} bg-gray-100 animate-pulse`} />;
  }

  return <img src={signedUrl} alt={alt} className={className} />;
}
