import { StyleSheet, useWindowDimensions } from 'react-native';

import { color, radius, shadow, spacing, TOUCH_TARGET } from './tokens';

/* --------------------------------------------------------------- Text */

/** Provided by `Text`. Exported so screens can build on the same scale. */
export const textStyles = StyleSheet.create({
  base: {
    // Keeps Android from adding extra leading on top of our lineHeight.
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  center: { textAlign: 'center' },
  right: { textAlign: 'right' },
  truncate: { flexShrink: 1 },
});

/* ------------------------------------------------------------- Screen */

export const screenStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: spacing.xl },
  center: { alignItems: 'center', justifyContent: 'center' },
});

/* ------------------------------------------------------------- Button */

export const buttonStyles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: TOUCH_TARGET,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xxl,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sm: {
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
  },
  lg: {
    minHeight: 54,
    paddingHorizontal: spacing.xxxl,
  },
  block: { alignSelf: 'stretch' },
  primary: { backgroundColor: color.primary, ...shadow.sm },
  primaryPressed: { backgroundColor: color.primaryStrong },
  secondary: { backgroundColor: color.surface, borderColor: color.primary },
  secondaryPressed: { backgroundColor: color.primaryTint },
  ghost: { backgroundColor: 'transparent' },
  ghostPressed: { backgroundColor: color.border },
  destructive: { backgroundColor: color.danger, ...shadow.sm },
  destructivePressed: { backgroundColor: '#DC2626' },
  disabled: {
    backgroundColor: color.disabled,
    borderColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
  },
  spinnerRow: { marginHorizontal: spacing.xs },
});

/* --------------------------------------------------------------- Card */

export const cardStyles = StyleSheet.create({
  base: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.sm,
  },
  flat: { shadowOpacity: 0, elevation: 0 },
  peach: { backgroundColor: color.surfaceAlt },
  dark: { backgroundColor: color.dark },
  mint: { backgroundColor: color.mint },
  pressed: { opacity: 0.92 },
});

/* --------------------------------------------------------------- Chip */

export const chipStyles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  selected: { backgroundColor: color.primary, borderColor: color.primary },
  unselectedText: { color: color.textSecondary },
  selectedText: { color: color.white },
});

/* ---------------------------------------------------- SegmentedControl */

export const segmentedStyles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: color.border,
    borderRadius: radius.pill,
    padding: spacing.xs,
    minHeight: TOUCH_TARGET + spacing.sm,
  },
  segment: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
  },
  active: { backgroundColor: color.surface, ...shadow.sm },
});

/* ------------------------------------------------------------- Avatar */

export const avatarStyles = StyleSheet.create({
  wrap: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});

/* -------------------------------------------------------------- Badge */

export const badgeStyles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  verified: { backgroundColor: color.mint },
  neutral: { backgroundColor: color.border },
  accent: { backgroundColor: color.accentTint },
  warning: { backgroundColor: color.starTint },
  danger: { backgroundColor: color.dangerTint },
  info: { backgroundColor: color.infoTint },
});

/* --------------------------------------------------------- StarRating */

export const starStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  hit: {
    minWidth: TOUCH_TARGET * 0.6,
    minHeight: TOUCH_TARGET * 0.6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/* ---------------------------------------------------------- TextField */

export const fieldStyles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  label: { color: color.textSecondary },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: TOUCH_TARGET + 8,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  inputWrapFocused: { borderColor: color.primary },
  inputWrapError: { borderColor: color.danger },
  inputWrapDisabled: { backgroundColor: color.border, opacity: 0.7 },
  input: {
    flex: 1,
    paddingVertical: spacing.md,
    color: color.dark,
    minHeight: TOUCH_TARGET,
  },
  multiline: { minHeight: TOUCH_TARGET * 2, textAlignVertical: 'top' },
  helper: { color: color.textMuted },
  error: { color: color.danger },
  adornment: { color: color.textMuted },
  otp: { letterSpacing: 8, textAlign: 'center' },
});

/* ---------------------------------------------------------------- Sheet */

export const sheetStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: color.scrim,
    justifyContent: 'flex-end',
  },
  panel: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    maxHeight: '92%',
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: color.border,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  scroll: { flexGrow: 0 },
  body: { gap: spacing.lg },
});

/* ---------------------------------------------------------- EmptyState */

export const emptyStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.huge,
    paddingHorizontal: spacing.xxl,
    gap: spacing.md,
  },
  art: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.primaryTint,
  },
});

/* ----------------------------------------------------------- Skeleton */

export const skeletonStyles = StyleSheet.create({
  base: { backgroundColor: color.border, borderRadius: radius.sm },
  row: { flexDirection: 'row', gap: spacing.md },
  col: { gap: spacing.sm },
});

/* --------------------------------------------------------- SlotGrid */

export const slotGridStyles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cell: {
    minWidth: '30%',
    flexGrow: 1,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
    paddingHorizontal: spacing.sm,
  },
  cellAvailable: { borderColor: color.primaryTint },
  cellSelected: {
    backgroundColor: color.primary,
    borderColor: color.primary,
    ...shadow.md,
  },
  cellTaken: { backgroundColor: color.border, borderColor: color.border },
  cellMine: { backgroundColor: color.mint, borderColor: color.success },
  cellUnavailableText: { color: color.textMuted, textDecorationLine: 'line-through' },
  empty: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    alignItems: 'center',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
});

/* --------------------------------------------------------- DayStrip */

export const dayStripStyles = StyleSheet.create({
  list: { gap: spacing.sm, paddingVertical: spacing.xs },
  day: {
    minWidth: 68,
    minHeight: TOUCH_TARGET + 20,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  daySelected: { backgroundColor: color.primary, borderColor: color.primary, ...shadow.md },
  dayToday: { borderColor: color.primary },
  dayDisabled: { opacity: 0.45 },
});

/* ---------------------------------------------------------- TabBar */

export const tabBarStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderRadius: radius.xl,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    minHeight: 64,
    ...shadow.lg,
  },
  item: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: spacing.xs,
  },
  itemActive: {},
  activePill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: radius.lg,
    backgroundColor: color.primaryTint,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: '18%',
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
