import * as React from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { buttonStyles } from '../styles';
import { color, spacing } from '../tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<PressableProps, 'children' | 'style' | 'disabled'> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. */
  icon?: IconName;
  /** Trailing icon (rendered after the label). */
  iconRight?: IconName;
  /** Shows a spinner and blocks interaction. */
  loading?: boolean;
  disabled?: boolean;
  /** Full-width. Defaults to `true` — pill buttons in this app are usually block. */
  block?: boolean;
  onPress?: PressableProps['onPress'];
  style?: ViewStyle;
  testID?: string;
  /** Slot rendered before the label; useful for badges/counts. */
  accessibilityHint?: string;
};

const variantStyles: Record<ButtonVariant, { base: ViewStyle; pressed: ViewStyle; text: string; icon: string; border?: ViewStyle }> = {
  primary: {
    base: buttonStyles.primary,
    pressed: buttonStyles.primaryPressed,
    text: color.white,
    icon: color.white,
  },
  secondary: {
    base: buttonStyles.secondary,
    pressed: buttonStyles.secondaryPressed,
    text: color.primary,
    icon: color.primary,
  },
  ghost: {
    base: buttonStyles.ghost,
    pressed: buttonStyles.ghostPressed,
    text: color.dark,
    icon: color.dark,
  },
  destructive: {
    base: buttonStyles.destructive,
    pressed: buttonStyles.destructivePressed,
    text: color.white,
    icon: color.white,
  },
};

/**
 * Pill button. Primary pink / secondary outline / ghost / destructive, with
 * loading + disabled states and a guaranteed ≥44pt touch target.
 */
export function Button({
  label,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  disabled = false,
  block = true,
  onPress,
  style,
  testID,
  accessibilityHint,
  ...rest
}: ButtonProps) {
  const v = variantStyles[variant];
  const isInactive = disabled || loading;
  const iconSize = size === 'lg' ? 22 : 20;

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityState={{ disabled: isInactive, busy: loading }}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      disabled={isInactive}
      onPress={onPress}
      testID={testID}
      hitSlop={8}
      style={({ pressed }) => [
        buttonStyles.base,
        size === 'sm' && buttonStyles.sm,
        size === 'lg' && buttonStyles.lg,
        v.base,
        borderOverride[variant],
        block && buttonStyles.block,
        pressed && !isInactive && v.pressed,
        isInactive && buttonStyles.disabled,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'secondary' || variant === 'ghost' ? color.primary : color.white}
          style={buttonStyles.spinnerRow}
        />
      ) : null}
      {!loading && icon ? <Icon name={icon} size={iconSize} color={isInactive ? color.disabledText : v.icon} /> : null}
      <View style={styles.labelWrap}>
        <Text
          variant="button"
          numberOfLines={1}
          style={[styles.label, { color: isInactive ? color.disabledText : v.text }]}
        >
          {loading ? `${label}…` : label}
        </Text>
      </View>
      {!loading && iconRight ? (
        <Icon name={iconRight} size={iconSize} color={isInactive ? color.disabledText : v.icon} />
      ) : null}
    </Pressable>
  );
}

const borderOverride: Record<ButtonVariant, ViewStyle | undefined> = {
  primary: undefined,
  secondary: { borderColor: color.primary },
  ghost: { borderColor: 'transparent' },
  destructive: undefined,
};

const styles = StyleSheet.create({
  labelWrap: { flexShrink: 1, paddingHorizontal: spacing.xs / 2 },
  label: { textAlign: 'center' },
});

/** Compact icon-only action with a 44pt target. */
export type IconButtonProps = {
  name: IconName;
  accessibilityLabel: string;
  onPress?: () => void;
  color?: string;
  size?: number;
  disabled?: boolean;
  testID?: string;
};

export function IconButton({
  name,
  accessibilityLabel,
  onPress,
  color: tint = color.dark,
  size = 22,
  disabled,
  testID,
}: IconButtonProps) {
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      hitSlop={10}
      style={({ pressed }) => [
        iconButtonStyles.base,
        pressed && { backgroundColor: color.border },
        disabled && { opacity: 0.4 },
      ]}
    >
      <Icon name={name} size={size} color={tint} accessibilityLabel={accessibilityLabel} />
    </Pressable>
  );
}

const iconButtonStyles = StyleSheet.create({
  base: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
