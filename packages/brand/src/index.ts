/**
 * @medibook/brand — MediBook design system.
 *
 * Tokens → typography → primitives → domain components. Both apps render
 * exclusively through this package so the two products stay visually identical.
 */

/* tokens & theme */
export * from './tokens';
export * from './theme';

/* fonts */
export { brandFontMap, useBrandFonts, type BrandFontsState } from './fonts';

/* primitives */
export { Text, Typography, textColor, type TextProps } from './components/Text';
export { Screen, type ScreenProps } from './components/Screen';
export { ScreenHeader, HeaderIcon, type ScreenHeaderProps } from './components/ScreenHeader';
export {
  Button,
  IconButton,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  type IconButtonProps,
} from './components/Button';
export { Card, SectionHeading, type CardProps, type CardVariant } from './components/Card';
export { Chip, ChipRow, type ChipProps } from './components/Chip';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from './components/SegmentedControl';
export { Avatar, initialsOf, type AvatarProps, type AvatarSize, type AvatarTone } from './components/Avatar';
export { Badge, VerifiedBadge, CountBubble, type BadgeProps, type BadgeTone } from './components/Badge';
export { StarRating, RatingDistribution, type StarRatingProps } from './components/StarRating';
export { TextField, TextArea, type TextFieldProps } from './components/TextField';
export { Sheet, SheetRow, type SheetProps } from './components/Sheet';
export { EmptyState, type EmptyStateProps } from './components/EmptyState';
export {
  Skeleton,
  SkeletonCard,
  SkeletonChips,
  SkeletonSlotGrid,
  type SkeletonProps,
} from './components/Skeleton';
export { ListRow, ListCard } from './components/ListRow';
export { CountdownPill, PolicyNote } from './components/Countdown';

/* domain components */
export {
  AppointmentCard,
  appointmentStatusMeta,
  type AppointmentCardData,
  type AppointmentCardProps,
  type AppointmentStatus,
  type ConsultType,
} from './components/AppointmentCard';
export { DoctorCard, type DoctorCardData, type DoctorCardProps } from './components/DoctorCard';
export { SlotGrid, type SlotGridProps, type SlotStatus, type SlotView } from './components/SlotGrid';
export { DayStrip, type DayStripProps, type DayView } from './components/DayStrip';
export { TabBar, type TabBarItem, type TabBarProps } from './components/TabBar';

/* logo */
export { Logo, LogoMark, BrandHero, type LogoProps } from './components/Logo';

/* icons */
export { Icon, iconNames, type IconName, type IconProps } from './components/Icon';

/* styles (exposed for advanced composition in screens) */
export * as styleSheets from './styles';
