import { useEffect } from 'react';

const APP_NAME = 'CryptoAlerts';

/**
 * Sets the browser tab title for the current page.
 * @param {string} title - Page-specific title (e.g. "Market"). Pass null to show only the app name.
 */
const usePageTitle = (title) => {
  useEffect(() => {
    document.title = title ? `${title} — ${APP_NAME}` : APP_NAME;
    return () => {
      document.title = APP_NAME;
    };
  }, [title]);
};

export default usePageTitle;
