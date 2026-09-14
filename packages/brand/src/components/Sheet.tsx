import * as React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from './Button';
import { Text } from './Text';
import { sheetStyles } from '../styles';
import { color, spacing } from '../tokens';

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Sheet title rendered in the header row. */
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Pin content below the scroll area (e.g. a primary action). */
  footer?: React.ReactNode;
  /** Caps the sheet height so long content scrolls internally. */
  maxHeightRatio?: number;
  /** Show the grabber handle. Defaults to `true`. */
  grabber?: boolean;
  /** Close when the scrim is tapped. Defaults to `true`. */
  dismissOnBackdropPress?: boolean;
  testID?: string;
};

/**
 * Bottom sheet modal used for booking, filters, reschedule, cancel and reason
 * pickers. Tapping the scrim or the close button dismisses it.
 */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxHeightRatio = 0.92,
  grabber = true,
  dismissOnBackdropPress = true,
  testID,
}: SheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
      testID={testID}
    >
      <View style={sheetStyles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessible={false}
          onPress={dismissOnBackdropPress ? onClose : undefined}
          accessibilityLabel="Close"
          accessibilityRole="button"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ width: '100%' }}
        >
          <View style={[sheetStyles.panel, { maxHeight: `${Math.round(maxHeightRatio * 100)}%` }]}>
            {grabber ? <View style={sheetStyles.grabber} /> : null}
            {title ? (
              <View style={sheetStyles.headerRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="h2" accessibilityRole="header">
                    {title}
                  </Text>
                  {subtitle ? <Text variant="small">{subtitle}</Text> : null}
                </View>
                <IconButton name="close" accessibilityLabel="Close" onPress={onClose} />
              </View>
            ) : null}
            <ScrollView
              style={sheetStyles.scroll}
              contentContainerStyle={sheetStyles.body}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
            {footer ? (
              <View
                style={{
                  paddingTop: spacing.lg,
                  paddingBottom: Math.max(insets.bottom, spacing.sm),
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: color.border,
                  marginTop: spacing.md,
                  gap: spacing.sm,
                }}
              >
                {footer}
              </View>
            ) : (
              <View style={{ height: Math.max(insets.bottom, spacing.md) }} />
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/** Thin wrapper used inside sheets for a label/value summary row. */
export function SheetRow({
  label,
  value,
  emphasis = false,
  tone = 'default',
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: 'default' | 'muted' | 'danger' | 'success';
}) {
  const valueColor =
    tone === 'danger'
      ? color.danger
      : tone === 'success'
        ? color.success
        : tone === 'muted'
          ? color.textSecondary
          : color.dark;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.lg }}>
      <Text variant="small" style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <Text variant={emphasis ? 'bodyStrong' : 'smallMedium'} style={{ color: valueColor, flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}
