import { useEffect, useRef } from 'react';

// TODO: Replace with your real AdSense Publisher ID once approved at google.com/adsense
export const ADSENSE_CLIENT_ID = 'ca-pub-XXXXXXXXXXXXXXXX';

interface AdSenseBannerProps {
  /** Ad unit slot ID from your AdSense dashboard. Leave empty to use auto-format. */
  slot?: string;
  /** Ad format: 'auto' (responsive) is the safest default. */
  format?: 'auto' | 'fluid' | 'rectangle' | 'horizontal' | 'vertical';
  /** Tailwind classes for the wrapper. */
  className?: string;
  /** Whether to allow the ad to be full-width responsive. */
  responsive?: boolean;
}

/**
 * Google AdSense banner for the bottom of content pages.
 * Renders nothing visible until AdSense is approved + the real Publisher ID is set.
 */
export default function AdSenseBanner({
  slot = '',
  format = 'auto',
  className = '',
  responsive = true,
}: AdSenseBannerProps) {
  const insRef = useRef<HTMLModElement>(null);
  const pushed = useRef(false);

  useEffect(() => {
    if (pushed.current) return;
    if (ADSENSE_CLIENT_ID.includes('XXXXXXXXXXXXXXXX')) return; // not configured yet
    try {
      // @ts-expect-error - adsbygoogle is injected by the AdSense script
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushed.current = true;
    } catch (err) {
      console.warn('[AdSense] push failed:', err);
    }
  }, []);

  // Until a real publisher ID is set, render a discreet placeholder so layouts stay stable.
  if (ADSENSE_CLIENT_ID.includes('XXXXXXXXXXXXXXXX')) {
    return (
      <div
        className={`mt-8 w-full rounded-lg border border-dashed border-border/30 px-4 py-6 text-center text-xs text-muted-foreground ${className}`}
        aria-hidden="true"
      >
        Ad space — configure your AdSense Publisher ID in <code>src/components/AdSenseBanner.tsx</code>
      </div>
    );
  }

  return (
    <div className={`mt-8 w-full ${className}`}>
      <ins
        ref={insRef}
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={ADSENSE_CLIENT_ID}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive={responsive ? 'true' : 'false'}
      />
    </div>
  );
}
