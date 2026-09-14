import * as React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Avatar } from './Avatar';
import { Badge } from './Badge';
import { IconButton } from './Button';
import { Card } from './Card';
import { Icon } from './Icon';
import { StarRating } from './StarRating';
import { Text } from './Text';
import { color, radius, spacing } from '../tokens';

export type DoctorCardData = {
  id: string;
  /** Display name including honorific, e.g. `Dr. Arjun Mehta`. */
  name: string;
  /** Primary specialty first, e.g. `['Dermatologist','Cosmetologist']`. */
  specialties: string[];
  experienceYears: number;
  /** Average rating, 0 when there are no reviews yet. */
  rating: number;
  reviewCount: number;
  feeMinor: number;
  currency: string;
  /** Human location, e.g. `Bandra West, Mumbai`. */
  area: string;
  languages: string[];
  /** PRD R10 — unverified doctors are never listed, but the card still shows the badge. */
  verified: boolean;
  /** e.g. `Today, 6:30 PM` — null when no open slots in the window. */
  nextSlotLabel?: string | null;
  consultationTypes: readonly ('video' | 'in_person')[];
  isFavorite?: boolean;
};

export type DoctorCardProps = {
  doctor: DoctorCardData;
  onPress?: () => void;
  onToggleFavorite?: () => void;
  /** Dense horizontal variant used on the Home screen. */
  compact?: boolean;
  /** Hides the fee column (used in the rebook shortcut row). */
  hideFee?: boolean;
  style?: ViewStyle;
};

function formatFee(minor: number, currency: string): string {
  const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '';
  const major = minor / 100;
  const body = Number.isInteger(major) ? `${major}` : major.toFixed(2);
  return symbol ? `${symbol}${body}` : `${body} ${currency}`;
}

/**
 * Doctor result row: rounded avatar on a peach backdrop, name, specialty,
 * rating, fees, next slot, area and the verified badge.
 */
export function DoctorCard({
  doctor,
  onPress,
  onToggleFavorite,
  compact = false,
  hideFee = false,
  style,
}: DoctorCardProps) {
  const primarySpecialty = doctor.specialties[0] ?? 'Specialist';
  const supportsVideo = doctor.consultationTypes.includes('video');
  const supportsInPerson = doctor.consultationTypes.includes('in_person');

  const accessibilityLabel = [
    doctor.name,
    primarySpecialty,
    `${doctor.experienceYears} years experience`,
    doctor.rating > 0 ? `rated ${doctor.rating.toFixed(1)} from ${doctor.reviewCount} reviews` : 'no reviews yet',
    hideFee ? null : `fee from ${formatFee(doctor.feeMinor, doctor.currency)}`,
    doctor.nextSlotLabel ? `next available ${doctor.nextSlotLabel}` : 'no open slots',
    doctor.area,
    doctor.verified ? 'verified' : null,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Card onPress={onPress} accessibilityLabel={accessibilityLabel} style={style}>
      <View style={styles.row}>
        <View style={styles.avatarBackdrop}>
          <Avatar name={doctor.name} size={compact ? 'md' : 'lg'} tone="peach" />
        </View>

        <View style={styles.body}>
          <View style={styles.nameRow}>
            <Text variant={compact ? 'h4' : 'h3'} numberOfLines={1} style={styles.name}>
              {doctor.name}
            </Text>
            {onToggleFavorite ? (
              <IconButton
                name={doctor.isFavorite ? 'heart-filled' : 'heart'}
                accessibilityLabel={doctor.isFavorite ? `Remove ${doctor.name} from saved doctors` : `Save ${doctor.name}`}
                color={doctor.isFavorite ? color.primary : color.textMuted}
                size={20}
                onPress={onToggleFavorite}
              />
            ) : null}
          </View>

          <Text variant="small" numberOfLines={1}>
            {primarySpecialty}
            {doctor.specialties.length > 1 ? ` · +${doctor.specialties.length - 1}` : ''}
            {` · ${doctor.experienceYears} yrs`}
          </Text>

          <View style={styles.ratingRow}>
            <StarRating value={doctor.rating} size={14} />
            <Text variant="caption" style={{ color: color.textSecondary }}>
              {doctor.rating > 0 ? `${doctor.rating.toFixed(1)} (${doctor.reviewCount})` : 'New on MediBook'}
            </Text>
          </View>

          {!compact ? (
            <View style={styles.tagsRow}>
              {supportsVideo ? <Badge label="Video" tone="accent" icon="video" /> : null}
              {supportsInPerson ? <Badge label="In-clinic" tone="info" icon="building" /> : null}
              {doctor.languages.length > 0 ? (
                <Badge label={doctor.languages.slice(0, 2).join(', ')} tone="neutral" icon="globe" />
              ) : null}
            </View>
          ) : null}

          <View style={styles.metaRow}>
            <Icon name="map-pin" size={14} color={color.textMuted} />
            <Text variant="caption" numberOfLines={1} style={styles.metaText}>
              {doctor.area}
            </Text>
          </View>
        </View>

        <View style={styles.rightCol}>
          {!hideFee ? (
            <View style={styles.feeBox}>
              <Text variant="caption" style={{ color: color.textMuted }}>
                Fee
              </Text>
              <Text variant="h4" style={{ color: color.primary }}>
                {formatFee(doctor.feeMinor, doctor.currency)}
              </Text>
            </View>
          ) : null}
          <View
            style={[
              styles.nextSlot,
              doctor.nextSlotLabel ? styles.nextSlotOpen : styles.nextSlotClosed,
            ]}
          >
            <Text variant="caption" style={{ color: doctor.nextSlotLabel ? color.success : color.textMuted }}>
              {doctor.nextSlotLabel ?? 'No slots'}
            </Text>
          </View>
        </View>
      </View>

      {doctor.verified ? (
        <View style={styles.verifiedRow}>
          <Badge label="Verified doctor" tone="verified" />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  avatarBackdrop: {
    padding: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: color.surfaceAlt,
  },
  body: { flex: 1, gap: spacing.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { flex: 1 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  metaText: { flex: 1 },
  rightCol: { alignItems: 'flex-end', gap: spacing.sm, minWidth: 76 },
  feeBox: { alignItems: 'flex-end' },
  nextSlot: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  nextSlotOpen: { backgroundColor: color.mint },
  nextSlotClosed: { backgroundColor: color.border },
  verifiedRow: { marginTop: spacing.md },
});
