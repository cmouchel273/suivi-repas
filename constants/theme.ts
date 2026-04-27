/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

export const AppTheme = {
  primary: '#00561b',
  primaryDark: '#003f14',
  primarySoft: '#E6F2EA',
  primarySoftPressed: '#D7EADD',
  primaryBorder: '#B8D8C1',
  background: '#F3F8F4',
  surface: '#FFFFFF',
  surfaceAlt: '#F8FBF8',
  text: '#102016',
  textSoft: '#506457',
  textMuted: '#6F8073',
  border: '#DDE8E0',
  grid: '#E7EFE9',
  danger: '#B91C1C',
  dangerSoft: '#FEF2F2',
  dangerBorder: '#FECACA',
  success: '#0F7A36',
  successSoft: '#EAF7EF',
  successBorder: '#BDE5CA',
  placeholder: '#8D9B91',
  shadow: '#062A12',
};

const tintColorLight = AppTheme.primary;
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: AppTheme.text,
    background: AppTheme.background,
    tint: tintColorLight,
    icon: AppTheme.textMuted,
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
