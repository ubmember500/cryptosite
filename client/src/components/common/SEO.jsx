/**
 * SEO component — renders <title>, <meta>, <link> tags using React 19 native
 * document metadata hoisting (no react-helmet needed).
 *
 * React 19 automatically hoists <title>, <meta>, <link> rendered inside any
 * component into the document <head>, deduplicating by name/property.
 *
 * Usage:
 *   <SEO />                          — defaults for /market screener page
 *   <SEO title="Charts" description="..." />  — custom page
 */

const SITE_URL = 'https://cryptosite2027.vercel.app';
const SITE_NAME = 'CryptoAlerts';

const DEFAULTS = {
  title: 'Crypto Screener 2027 | Real-Time Scanner with Alerts & Density',
  description:
    'Free crypto screener 2027: real-time prices from multiple exchanges, price alerts, order book density scanner, volume filters, live charts. Best tool for crypto scalpers and day traders.',
  keywords:
    'crypto screener, cryptocurrency screener, real time crypto screener, crypto trading scanner, best crypto screener 2027, free crypto screener, crypto alerts scanner, order book density scanner, crypto density scanner, multi exchange crypto screener, crypto volume scanner, crypto volatility scanner, scalping crypto screener, day trading crypto tool, crypto price alerts tool, crypto scanner with alerts, скринер криптовалют, крипто скринер, скринер криптовалют 2027, скринер криптовалют с алертами, скринер плотностей стакана, реал тайм скринер криптовалют, скринер для скальпинга, бесплатный скринер криптовалют, лучший скринер криптовалют 2027, крипто скринер с плотностями',
  ogTitle: 'Crypto Screener 2027 | Скринер криптовалют с алертами и плотностями',
  ogDescription:
    'Бесплатный реал-тайм скринер криптовалют 2027 с алертами, плотностями стакана и графиками бирж.',
  ogImage: `${SITE_URL}/og-screener.png`,
  canonicalUrl: `${SITE_URL}/market`,
};

const SEO = ({
  title = DEFAULTS.title,
  description = DEFAULTS.description,
  keywords = DEFAULTS.keywords,
  ogTitle = DEFAULTS.ogTitle,
  ogDescription = DEFAULTS.ogDescription,
  ogImage = DEFAULTS.ogImage,
  canonicalUrl = DEFAULTS.canonicalUrl,
  ogType = 'website',
}) => {
  return (
    <>
      {/* Primary */}
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="keywords" content={keywords} />
      <meta name="author" content={SITE_NAME} />

      {/* Canonical */}
      <link rel="canonical" href={canonicalUrl} />

      {/* Open Graph */}
      <meta property="og:type" content={ogType} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={ogTitle} />
      <meta property="og:description" content={ogDescription} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:locale" content="en_US" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
    </>
  );
};

export default SEO;
export { SITE_URL, SITE_NAME, DEFAULTS as SEO_DEFAULTS };
