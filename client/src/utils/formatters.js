/**
 * Format price with commas and decimals
 * @param {number} price - Price to format
 * @param {object} options - Formatting options
 * @returns {string} Formatted price string
 */
export const formatPrice = (price, options = {}) => {
  if (price === null || price === undefined || isNaN(price)) {
    return 'N/A';
  }

  const {
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
    showSymbol = true,
    symbol = '$',
  } = options;

  const formatted = price.toLocaleString(undefined, {
    minimumFractionDigits,
    maximumFractionDigits,
  });

  return showSymbol ? `${symbol}${formatted}` : formatted;
};

/**
 * Format percentage with +/- sign
 * @param {number} value - Percentage value
 * @param {object} options - Formatting options
 * @returns {string} Formatted percentage string
 */
export const formatPercent = (value, options = {}) => {
  if (value === null || value === undefined || isNaN(value)) {
    return 'N/A';
  }

  const {
    decimals = 2,
    showSign = true,
    showSymbol = true,
    symbol = '%',
  } = options;

  const sign = showSign && value >= 0 ? '+' : '';
  const formatted = Math.abs(value).toFixed(decimals);

  return `${sign}${formatted}${showSymbol ? symbol : ''}`;
};

/**
 * Format large numbers (market cap, volume, etc.)
 * @param {number} num - Number to format
 * @param {object} options - Formatting options
 * @returns {string} Formatted number string
 */
export const formatLargeNumber = (num, options = {}) => {
  if (num === null || num === undefined || isNaN(num)) {
    return 'N/A';
  }

  const { showSymbol = true, symbol = '$', decimals = 2 } = options;

  let formatted;
  if (num >= 1e12) {
    formatted = `${symbol}${(num / 1e12).toFixed(decimals)}T`;
  } else if (num >= 1e9) {
    formatted = `${symbol}${(num / 1e9).toFixed(decimals)}B`;
  } else if (num >= 1e6) {
    formatted = `${symbol}${(num / 1e6).toFixed(decimals)}M`;
  } else if (num >= 1e3) {
    formatted = `${symbol}${(num / 1e3).toFixed(decimals)}K`;
  } else {
    formatted = `${symbol}${num.toLocaleString()}`;
  }

  return formatted;
};

/**
 * Format date/time
 * @param {Date|string|number} date - Date to format
 * @param {object} options - Formatting options
 * @returns {string} Formatted date string
 */
export const formatDate = (date, options = {}) => {
  if (!date) return 'N/A';

  const {
    format = 'default', // 'default', 'short', 'long', 'time', 'relative'
  } = options;

  const dateObj = date instanceof Date ? date : new Date(date);

  if (isNaN(dateObj.getTime())) {
    return 'Invalid Date';
  }

  switch (format) {
    case 'short':
      return dateObj.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    case 'long':
      return dateObj.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    case 'time':
      return dateObj.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
    case 'relative':
      return formatRelativeTime(dateObj);
    default:
      return dateObj.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
  }
};

/**
 * Format relative time (e.g., "2 hours ago")
 * @param {Date} date - Date to format
 * @returns {string} Relative time string
 */
const formatRelativeTime = (date) => {
  const now = new Date();
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  } else {
    return formatDate(date, { format: 'short' });
  }
};
