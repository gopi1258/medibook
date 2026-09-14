import * as React from 'react';
import {
  RefreshControl,
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { color, spacing } from '../tokens';

export type ScreenProps = {
  children: React.ReactNode;
  /** Wrap content in a vertical ScrollView. Defaults to `false`. */
  scroll?: boolean;
  /** Remove horizontal padding (e.g. for full-bleed carousels). */
  edgeToEdge?: boolean;
  /** Apply the blush app background. Defaults to `true`. */
  background?: boolean;
  /** Which safe-area edges to protect. Defaults to top only. */
  edges?: readonly Edge[];
  contentContainerStyle?: ViewStyle;
  style?: ViewStyle;
  /** Enables pull-to-refresh on the scroll container. */
  refreshing?: boolean;
  onRefresh?: () => void;
  scrollProps?: Omit<ScrollViewProps, 'children' | 'contentContainerStyle' | 'refreshControl'>;
  testID?: string;
};

/**
 * Screen shell: safe area + brand background + consistent padding rhythm.
 * Both apps render every screen inside this.
 */
export function Screen({
  children,
  scroll = false,
  edgeToEdge = false,
  background = true,
  edges = ['top'],
  contentContainerStyle,
  style,
  refreshing,
  onRefresh,
  scrollProps,
  testID,
}: ScreenProps) {
  const pad = edgeToEdge ? undefined : { paddingHorizontal: spacing.xl };
  const rootStyle: ViewStyle[] = [
    styles.root,
    background ? { backgroundColor: color.bg } : null,
    style,
  ].filter(Boolean) as ViewStyle[];

  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.scrollContent, pad, contentContainerStyle]}
      refreshControl={
        onRefresh
          ? (
              <RefreshControl
                refreshing={refreshing === true}
                onRefresh={onRefresh}
                tintColor={color.primary}
                colors={[color.primary]}
              />
            )
          : undefined
      }
      {...scrollProps}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, pad, contentContainerStyle]}>{children}</View>
  );

  return (
    <SafeAreaView style={rootStyle} edges={edges} testID={testID}>
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxxl, gap: spacing.lg },
});
