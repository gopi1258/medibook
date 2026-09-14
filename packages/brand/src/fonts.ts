import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import { useFonts } from 'expo-font';

/**
 * Font assets bundled from `@expo-google-fonts/*` npm packages.
 *
 * They are shipped inside the app binary (no runtime fetch), which is required
 * because the apps must render offline.
 */
export const brandFontMap = {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} as const;

export type BrandFontsState = {
  loaded: boolean;
  error: Error | null;
};

/**
 * Loads Poppins + Inter. Call once from the root layout; combine with
 * `expo-splash-screen` to avoid a flash of fallback type.
 */
export function useBrandFonts(): BrandFontsState {
  const [loaded, error] = useFonts(brandFontMap);
  return { loaded, error: error ?? null };
}
