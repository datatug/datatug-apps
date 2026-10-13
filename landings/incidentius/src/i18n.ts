import { createI18n } from '@sneat/astro/i18n';

export const i18n = createI18n({
  defaultLocale: 'en',
  langs: [
    { code: 'en', label: 'English', short: 'EN', tag: 'en', ogLocale: 'en_IE' },
    { code: 'ru', label: 'Русский', short: 'RU', tag: 'ru', ogLocale: 'ru_RU' },
  ],
});
