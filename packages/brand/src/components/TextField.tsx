import * as React from 'react';
import {
  Pressable,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { fieldStyles } from '../styles';
import { color, fontFamily, fontSize, spacing } from '../tokens';

export type TextFieldProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  label?: string;
  /** Helper text under the field. Hidden while an error is shown. */
  helper?: string;
  error?: string;
  leadingIcon?: IconName;
  /** Suffix node, e.g. a "Change" link or unit. */
  trailing?: React.ReactNode;
  /** Pressable suffix icon. */
  trailingIcon?: { name: IconName; onPress: () => void; accessibilityLabel: string };
  disabled?: boolean;
  /** Renders a large, letter-spaced single-line input (OTP). */
  otp?: boolean;
  containerStyle?: ViewStyle;
  /** Forwarded to the input for a11y grouping. */
  accessibilityLabel?: string;
};

/**
 * Labelled text input with focus ring, error state and 44pt+ touch height.
 * Use `react-hook-form`'s `Controller` around it — it stays a dumb component.
 */
export const TextField = React.forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    label,
    helper,
    error,
    leadingIcon,
    trailing,
    trailingIcon,
    disabled = false,
    otp = false,
    containerStyle,
    accessibilityLabel,
    editable,
    multiline,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const [focused, setFocused] = React.useState(false);
  const isEditable = editable !== false && !disabled;
  const hasError = Boolean(error);

  return (
    <View style={[fieldStyles.wrap, containerStyle]}>
      {label ? (
        <View style={fieldStyles.labelRow}>
          <Text variant="label" style={fieldStyles.label}>
            {label}
          </Text>
        </View>
      ) : null}

      <View
        style={[
          fieldStyles.inputWrap,
          focused && fieldStyles.inputWrapFocused,
          hasError && fieldStyles.inputWrapError,
          !isEditable && fieldStyles.inputWrapDisabled,
        ]}
      >
        {leadingIcon ? <Icon name={leadingIcon} size={18} color={color.textMuted} /> : null}
        <TextInput
          ref={ref}
          editable={isEditable}
          multiline={multiline}
          placeholderTextColor={color.textMuted}
          accessibilityLabel={accessibilityLabel ?? label ?? rest.placeholder}
          accessibilityState={{ disabled: !isEditable }}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            fieldStyles.input,
            {
              fontFamily: fontFamily.body,
              fontSize: fontSize.body,
              color: color.dark,
            },
            multiline ? fieldStyles.multiline : null,
            otp ? fieldStyles.otp : null,
          ]}
          {...rest}
        />
        {trailing}
        {trailingIcon ? (
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel={trailingIcon.accessibilityLabel}
            onPress={trailingIcon.onPress}
            hitSlop={10}
          >
            <Icon name={trailingIcon.name} size={20} color={color.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {hasError ? (
        <Text variant="small" style={fieldStyles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : helper ? (
        <Text variant="small" style={fieldStyles.helper}>
          {helper}
        </Text>
      ) : null}
      <View style={{ height: spacing.xs / 2 }} />
    </View>
  );
});

/** Multi-line note field with a live character counter (booking notes, reviews). */
export function TextArea({
  maxLength = 500,
  value,
  ...rest
}: TextFieldProps & { maxLength?: number }) {
  const used = typeof value === 'string' ? value.length : 0;
  return (
    <TextField
      multiline
      numberOfLines={4}
      maxLength={maxLength}
      value={value}
      helper={`${used}/${maxLength} characters`}
      {...rest}
    />
  );
}
