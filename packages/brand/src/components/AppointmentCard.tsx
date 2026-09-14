import * as React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Avatar } from './Avatar';
import { Badge, type BadgeTone } from './Badge';
import { Button, IconButton } from './Button';
import { Card } from './Card';
import { Icon } from './Icon';
import { Text } from './Text';
import { color, radius, spacing } from '../tokens';

export type AppointmentStatus =
  | 'held'
  | 'pending_approval'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'rescheduled';

export type ConsultType = 'video' | 'in_person';

/**
 * View model for `AppointmentCard`. `@medibook/core` provides
 * `toAppointmentCard()` so screens never hand-assemble these.
 */
export type AppointmentCardData = {
  id: string;
  /** Human code shown on the confirmation screen, e.g. `MB-8H2K4`. */
  code: string;
  doctorName: string;
  doctorSpecialty: string;
  /** Person the appointment is for (self or dependent). */
  patientName: string;
  patientIsDependent: boolean;
  consultType: ConsultType;
  status: AppointmentStatus;
  /** ISO-8601 UTC start. */
  startUtc: string;
  /** Localised e.g. `Today · 6:30 PM`. */
  timeLabel: string;
  /** Localised e.g. `Sun, 20 Sep`. */
  dateLabel: string;
  /** Always shown so cross-timezone bookings are unambiguous (PRD R9). */
  tzLabel: string;
  locationLabel?: string | null;
  /** True while the T-5m → T+grace join window is open (video only). */
  joinWindowOpen?: boolean;
  feeMinor?: number;
  currency?: string;
  /** Shown on rescheduled chains. */
  rescheduleCount?: number;
  conflictNote?: string | null;
};

export type AppointmentCardProps = {
  appointment: AppointmentCardData;
  /** Which side is viewing — changes the visible actions. */
  viewer?: 'patient' | 'doctor';
  onPress?: () => void;
  onJoin?: () => void;
  onReschedule?: () => void;
  onCancel?: () => void;
  onDirections?: () => void;
  onRate?: () => void;
  onAccept?: () => void;
  onDecline?: () => void;
  onComplete?: () => void;
  onMarkNoShow?: () => void;
  /** Dense variant for the doctor's Today timeline. */
  compact?: boolean;
  style?: ViewStyle;
};

type StatusMeta = { label: string; tone: BadgeTone; accent: string };

const STATUS_META: Record<AppointmentStatus, StatusMeta> = {
  held: { label: 'On hold', tone: 'warning', accent: color.star },
  pending_approval: { label: 'Awaiting approval', tone: 'warning', accent: color.star },
  confirmed: { label: 'Confirmed', tone: 'verified', accent: color.success },
  in_progress: { label: 'In progress', tone: 'accent', accent: color.accent },
  completed: { label: 'Completed', tone: 'neutral', accent: color.textMuted },
  cancelled: { label: 'Cancelled', tone: 'danger', accent: color.danger },
  no_show: { label: 'No show', tone: 'danger', accent: color.danger },
  rescheduled: { label: 'Rescheduled', tone: 'info', accent: color.info },
};

/** Human label + tone for an appointment status. Shared by both apps. */
export function appointmentStatusMeta(status: AppointmentStatus): StatusMeta {
  return STATUS_META[status] ?? STATUS_META.confirmed;
}

function formatMoney(minor: number | undefined, currency: string | undefined): string | null {
  if (minor === undefined) return null;
  const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '';
  const major = minor / 100;
  const body = Number.isInteger(major) ? `${major}` : major.toFixed(2);
  return symbol ? `${symbol}${body}` : `${body} ${currency ?? ''}`.trim();
}

/**
 * Appointment summary card. Renders the doctor avatar, who the visit is for,
 * the timezone-explicit time and the per-state action set.
 */
export function AppointmentCard({
  appointment,
  viewer = 'patient',
  onPress,
  onJoin,
  onReschedule,
  onCancel,
  onDirections,
  onRate,
  onAccept,
  onDecline,
  onComplete,
  onMarkNoShow,
  compact = false,
  style,
}: AppointmentCardProps) {
  const meta = appointmentStatusMeta(appointment.status);
  const money = formatMoney(appointment.feeMinor, appointment.currency);
  const isVideo = appointment.consultType === 'video';

  const actions: React.ReactNode[] = [];

  if (viewer === 'patient') {
    if (appointment.joinWindowOpen && isVideo && onJoin) {
      actions.push(
        <Button key="join" label="Join video" icon="video" size="sm" onPress={onJoin} block={false} />,
      );
    }
    if (appointment.status === 'confirmed' || appointment.status === 'pending_approval') {
      if (onReschedule) {
        actions.push(
          <Button
            key="reschedule"
            label="Reschedule"
            variant="secondary"
            size="sm"
            onPress={onReschedule}
            block={false}
          />,
        );
      }
      if (onCancel) {
        actions.push(
          <Button key="cancel" label="Cancel" variant="ghost" size="sm" onPress={onCancel} block={false} />,
        );
      }
    }
    if (appointment.status === 'completed' && onRate) {
      actions.push(
        <Button key="rate" label="Rate visit" icon="star" size="sm" onPress={onRate} block={false} />,
      );
    }
    if (isVideo ? appointment.status !== 'completed' : Boolean(appointment.locationLabel) && onDirections) {
      actions.push(
        <Button
          key="directions"
          label={isVideo ? 'How to join' : 'Directions'}
          variant="ghost"
          size="sm"
          icon={isVideo ? 'help' : 'map-pin'}
          onPress={onDirections}
          block={false}
        />,
      );
    }
  } else {
    // Doctor view
    if (appointment.status === 'pending_approval') {
      if (onAccept) {
        actions.push(<Button key="accept" label="Accept" size="sm" onPress={onAccept} block={false} />);
      }
      if (onDecline) {
        actions.push(
          <Button key="decline" label="Decline" variant="ghost" size="sm" onPress={onDecline} block={false} />,
        );
      }
    }
    if (appointment.status === 'confirmed') {
      if (onComplete) {
        actions.push(
          <Button
            key="complete"
            label="Mark completed"
            variant="secondary"
            size="sm"
            onPress={onComplete}
            block={false}
          />,
        );
      }
      if (onJoin && isVideo && appointment.joinWindowOpen) {
        actions.push(<Button key="join" label="Start" icon="video" size="sm" onPress={onJoin} block={false} />);
      }
    }
    if (appointment.status === 'in_progress' && onComplete) {
      actions.push(
        <Button key="end" label="End consult" size="sm" onPress={onComplete} block={false} />,
      );
    }
  }

  if (onMarkNoShow && viewer === 'doctor' && appointment.status === 'confirmed') {
    actions.push(
      <Button key="noshow" label="No show" variant="ghost" size="sm" onPress={onMarkNoShow} block={false} />,
    );
  }

  const accessibilityLabel = [
    `${appointment.doctorName}, ${appointment.doctorSpecialty}`,
    `for ${appointment.patientName}`,
    `${appointment.dateLabel} ${appointment.timeLabel}`,
    meta.label,
  ].join('. ');

  return (
    <Card onPress={onPress} accessibilityLabel={accessibilityLabel} style={style}>
      <View style={styles.headerRow}>
        <Avatar name={viewer === 'patient' ? appointment.doctorName : appointment.patientName} size={compact ? 'sm' : 'md'} />
        <View style={styles.headerText}>
          <Text variant="h4" numberOfLines={1}>
            {viewer === 'patient' ? appointment.doctorName : appointment.patientName}
          </Text>
          <Text variant="small" numberOfLines={1}>
            {viewer === 'patient' ? appointment.doctorSpecialty : `${appointment.patientIsDependent ? 'Dependent' : 'Self'} · ${appointment.code}`}
          </Text>
        </View>
        <View style={styles.statusCol}>
          <Badge label={meta.label} tone={meta.tone} />
          {money ? (
            <Text variant="smallMedium" style={{ color: color.dark }}>
              {money}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.metaBlock}>
        <View style={styles.metaRow}>
          <Icon name="calendar" size={16} color={color.textSecondary} />
          <Text variant="smallMedium" style={styles.flexText}>
            {appointment.dateLabel} · {appointment.timeLabel}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Icon name={isVideo ? 'video' : 'building'} size={16} color={color.textSecondary} />
          <Text variant="small" style={styles.flexText}>
            {isVideo ? 'Video consultation' : appointment.locationLabel ?? 'In-clinic'}
          </Text>
        </View>
        {/* Timezone label is mandatory — PRD R9 / X4. */}
        <View style={styles.metaRow}>
          <Icon name="globe" size={16} color={color.textMuted} />
          <Text variant="caption" style={styles.flexText}>
            {appointment.tzLabel}
          </Text>
        </View>
        {viewer === 'patient' && appointment.patientIsDependent ? (
          <View style={styles.metaRow}>
            <Icon name="users" size={16} color={color.textMuted} />
            <Text variant="caption" style={styles.flexText}>
              For {appointment.patientName}
            </Text>
          </View>
        ) : null}
      </View>

      {appointment.conflictNote ? (
        <View style={styles.conflict}>
          <Icon name="alert-triangle" size={16} color="#B45309" />
          <Text variant="small" style={[styles.flexText, { color: '#B45309' }]}>
            {appointment.conflictNote}
          </Text>
        </View>
      ) : null}

      {actions.length > 0 ? <View style={styles.actions}>{actions}</View> : null}

      {onPress ? (
        <View style={styles.chevron}>
          <IconButton name="chevron-right" accessibilityLabel="Open appointment details" onPress={onPress} size={18} />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerText: { flex: 1, gap: 2 },
  statusCol: { alignItems: 'flex-end', gap: spacing.xs },
  metaBlock: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
    gap: spacing.sm,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flexText: { flex: 1 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  conflict: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: color.starTint,
  },
  chevron: { position: 'absolute', right: spacing.sm, top: '52%' },
});
