/**
 * Shared navigation constants.
 *
 * The tab bar is rendered by `@medibook/brand` inside the tab navigator, so the
 * navigator's own bar is hidden and the scene background is set to the blush app
 * background instead of the default theme white.
 */
import type { ViewStyle } from 'react-native';

import { color } from '@medibook/brand';

export const THEME_SCREEN_OPTIONS = {
  contentStyle: { backgroundColor: color.bg } as ViewStyle,
} as const;

/** Deep-link targets used by notification payloads (TRD §4.2). */
export function resolveDeepLink(target: string | null): string | null {
  if (!target) return null;
  return target.startsWith('/') ? target : `/${target}`;
}
