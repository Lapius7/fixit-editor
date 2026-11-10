import { defineConfig } from '@x18n/core'

// Detected presets: react-i18next, i18next. They apply automatically.
export default defineConfig({
  sourceLocale: 'ja',
  resources: [
    {
      pattern: 'src/i18n/locales/{locale}.{ext}'
    }
  ]
})
