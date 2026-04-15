import { de } from '../i18n/de';
import { en } from '../i18n/en';

type Translations = typeof de | typeof en;

/**
 * Format relative time using i18n translations
 * @param isoString ISO date string
 * @param translations Translation object (de or en)
 * @returns Formatted relative time string
 */
export function zeitRelativ(isoString: string | null, translations: Translations): string {
  if (!isoString) return '—';

  const diff = Date.now() - new Date(isoString).getTime();
  const min = Math.floor(diff / 60000);

  if (min < 1) return translations.common.relativeTimes.justNow;
  if (min < 60) {
    return translations.common.relativeTimes.minuteAgo.replace('{count}', min.toString());
  }

  const std = Math.floor(min / 60);
  if (std < 24) {
    return translations.common.relativeTimes.hourAgo.replace('{count}', std.toString());
  }

  return new Date(isoString).toLocaleDateString();
}
