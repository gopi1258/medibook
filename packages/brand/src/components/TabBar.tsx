import * as React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { tabBarStyles } from '../styles';
import { color, spacing } from '../tokens';

export type TabBarItem = {
  /** Route key, e.g. `index`, `discover`. */
  key: string;
  label: string;
  icon: IconName;
  /** Unread count rendered as a bubble. */
  badge?: number;
  /** Optional accessible hint, e.g. "3 unread alerts". */
  accessibilityHint?: string;
};

export type TabBarProps = {
  items: readonly TabBarItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  /** Accessibility label for the whole bar. */
  accessibilityLabel?: string;
  style?: ViewStyle;
};

/**
 * Floating/recessed bottom tab bar with 5 tabs and an emphasised active tab.
 * Passed to expo-router's `Tabs` via `tabBar` (see each app's
 * `components/app-tabs.tsx` adapter).
 */
export function TabBar({
  items,
  activeKey,
  onSelect,
  accessibilityLabel = 'Main navigation',
  style,
}: TabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[tabBarStyles.wrap, { marginBottom: Math.max(insets.bottom, spacing.sm) }, style]}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {items.map((item) => {
        const focused = item.key === activeKey;
        return (
          <Pressable
            key={item.key}
            accessible
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={item.badge ? `${item.label}, ${item.badge} unread` : item.label}
            accessibilityHint={item.accessibilityHint}
            onPress={() => onSelect(item.key)}
            style={({ pressed }) => [tabBarStyles.item, focused && tabBarStyles.itemActive, pressed && { opacity: 0.8 }]}
          >
            {focused ? <View style={tabBarStyles.activePill} /> : null}
            <Icon name={item.icon} size={22} color={focused ? color.primary : color.textMuted} />
            <Text
              variant={focused ? 'captionStrong' : 'caption'}
              style={{ color: focused ? color.primary : color.textMuted }}
              numberOfLines={1}
            >
              {item.label}
            </Text>
            {item.badge && item.badge > 0 ? (
              <View style={tabBarStyles.badge}>
                <Text variant="captionStrong" style={styles.badgeText}>
                  {item.badge > 9 ? '9+' : item.badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  badgeText: { color: color.white, fontSize: 10, lineHeight: 12 },
});
