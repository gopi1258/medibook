/**
 * Booking policy (DOC-007 / R1, R3, R5, R7, R13) — min notice, booking window,
 * approval mode, no-show grace and buffers.
 *
 * Two product rules are written into the UI rather than left implicit:
 *  - policy changes never invalidate existing bookings, only future availability;
 *  - switching to manual approval adds a decision queue with an auto-decline
 *    window, which is a staffing commitment, not just a toggle.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { defaultPlatformConfig, formatDuration } from '@medibook/core';
import type { ApprovalMode } from '@medibook/core';
import {
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  PolicyNote,
  Screen,
  ScreenHeader,
  SectionHeading,
  Text,
  color,
  spacing,
} from '@medibook/brand';

import { usePolicy, useUpdatePolicy } from '../../src/lib/hooks';
import { describeError } from '../../src/lib/format';
import { ErrorState, InlineNotice, ListSkeleton } from '../../src/components/states';

const NOTICE_OPTIONS = [30, 60, 120, 240, 1440];
const WINDOW_OPTIONS = [7, 14, 30, 60, 90];
const RESCHEDULE_OPTIONS = [0, 1, 2, 3];
const RESCHEDULE_HOURS = [2, 4, 12, 24];
const GRACE_OPTIONS = [5, 10, 15, 20, 30];
const BUFFER_OPTIONS = [0, 5, 10, 15, 30];
const DECLINE_OPTIONS = [5, 10, 15, 30, 60];

export default function PolicyScreen() {
  const router = useRouter();
  const policy = usePolicy();
  const update = useUpdatePolicy();
  const [failure, setFailure] = React.useState<unknown>(null);

  const [draft, setDraft] = React.useState<{
    min_notice_minutes: number;
    booking_window_days: number;
    reschedule_min_hours: number;
    max_reschedules: number;
    approval_mode: ApprovalMode;
    approval_auto_decline_minutes: number;
    no_show_grace_minutes_video: number;
    no_show_grace_minutes_clinic: number;
    buffer_minutes: number;
  } | null>(null);

  React.useEffect(() => {
    if (draft === null && policy.data) setDraft({ ...policy.data });
  }, [draft, policy.data]);

  const save = async (patch: Partial<NonNullable<typeof draft>>) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    setFailure(null);
    try {
      await update.mutateAsync(patch);
    } catch (caught) {
      setFailure(caught);
      if (policy.data) setDraft({ ...policy.data });
    }
  };

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}>
      <ScreenHeader title="Booking policy" subtitle="Applies to future availability only" onBack={() => router.back()} />

      {policy.isLoading || draft === null ? (
        <ListSkeleton count={4} />
      ) : policy.isError ? (
        <ErrorState error={policy.error} onRetry={() => void policy.refetch()} />
      ) : (
        <>
          {failure ? <InlineNotice message={describeError(failure).message} /> : null}
          {update.isPending ? <InlineNotice tone="info" message="Saving…" /> : null}

          <PolicyNote
            tone="info"
            title="Existing bookings are safe"
            body="Changing these values affects what patients can book from now on. Appointments already on your calendar keep their time, their fee and their reminders."
          />

          <View style={{ gap: spacing.sm }}>
            <SectionHeading title="Minimum notice" />
            <Text variant="caption">
              How soon before a slot a patient may still book it. Higher notice protects you from same-hour surprises.
            </Text>
            <ChipRow>
              {NOTICE_OPTIONS.map((minutes) => (
                <Chip
                  key={minutes}
                  label={formatDuration(minutes)}
                  selected={draft.min_notice_minutes === minutes}
                  onPress={() => void save({ min_notice_minutes: minutes })}
                />
              ))}
            </ChipRow>
          </View>

          <View style={{ gap: spacing.sm }}>
            <SectionHeading title="Booking window" />
            <Text variant="caption">How far ahead patients can see and book your slots.</Text>
            <ChipRow>
              {WINDOW_OPTIONS.map((days) => (
                <Chip
                  key={days}
                  label={`${days} days`}
                  selected={draft.booking_window_days === days}
                  onPress={() => void save({ booking_window_days: days })}
                />
              ))}
            </ChipRow>
          </View>

          <View style={{ gap: spacing.sm }}>
            <SectionHeading title="Approval mode" />
            <Text variant="caption">
              Auto-confirm fills your day with no administration. Manual approval gives you a decision queue with an
              auto-decline window.
            </Text>
            <ChipRow>
              <Chip
                label="Auto-confirm"
                icon="check-circle"
                selected={draft.approval_mode === 'auto'}
                onPress={() => void save({ approval_mode: 'auto' })}
              />
              <Chip
                label="I approve each request"
                icon="check"
                selected={draft.approval_mode === 'manual'}
                onPress={() => void save({ approval_mode: 'manual' })}
              />
            </ChipRow>
            {draft.approval_mode === 'manual' ? (
              <>
                <Text variant="caption">
                  Requests you do not answer within the window are declined automatically and refunded in full.
                </Text>
                <ChipRow>
                  {DECLINE_OPTIONS.map((minutes) => (
                    <Chip
                      key={minutes}
                      label={`${minutes} min`}
                      selected={draft.approval_auto_decline_minutes === minutes}
                      onPress={() => void save({ approval_auto_decline_minutes: minutes })}
                    />
                  ))}
                </ChipRow>
                <PolicyNote
                  tone="warning"
                  title="Manual mode needs attention"
                  body="Every request waits for you. If you are in theatre or asleep, the slot is declined and the patient is refunded — that is a lost booking, not just a lost notification."
                />
              </>
            ) : null}
          </View>

          <View style={{ gap: spacing.sm }}>
            <SectionHeading title="No-show grace" />
            <Text variant="caption">
              How long you wait before marking a patient absent. Video consults usually need less waiting than a clinic.
            </Text>
            <Text variant="label">Video</Text>
            <ChipRow>
              {GRACE_OPTIONS.map((minutes) => (
                <Chip
                  key={`video-${minutes}`}
                  label={`${minutes} min`}
                  selected={draft.no_show_grace_minutes_video === minutes}
                  onPress={() => void save({ no_show_grace_minutes_video: minutes })}
                />
              ))}
            </ChipRow>
            <Text variant="label">In-clinic</Text>
            <ChipRow>
              {GRACE_OPTIONS.map((minutes) => (
                <Chip
                  key={`clinic-${minutes}`}
                  label={`${minutes} min`}
                  selected={draft.no_show_grace_minutes_clinic === minutes}
                  onPress={() => void save({ no_show_grace_minutes_clinic: minutes })}
                />
              ))}
            </ChipRow>
          </View>

          <View style={{ gap: spacing.sm }}>
            <SectionHeading title="Buffer between patients" />
            <Text variant="caption">
              Applied on <Text variant="captionStrong">both</Text> sides of every appointment during slot generation, so
              nothing is offered back-to-back.
            </Text>
            <ChipRow>
              {BUFFER_OPTIONS.map((minutes) => (
                <Chip
                  key={minutes}
                  label={minutes === 0 ? 'None' : `${minutes} min`}
                  selected={draft.buffer_minutes === minutes}
                  onPress={() => void save({ buffer_minutes: minutes })}
                />
              ))}
            </ChipRow>
          </View>

          <View style={{ gap: spacing.sm }}>
            <SectionHeading title="Patient reschedules" />
            <Text variant="caption">
              How many times a patient may move an appointment, and how close to the start they may still do it.
            </Text>
            <ChipRow>
              {RESCHEDULE_OPTIONS.map((count) => (
                <Chip
                  key={count}
                  label={count === 0 ? 'Not allowed' : `${count}×`}
                  selected={draft.max_reschedules === count}
                  onPress={() => void save({ max_reschedules: count })}
                />
              ))}
            </ChipRow>
            <ChipRow>
              {RESCHEDULE_HOURS.map((hours) => (
                <Chip
                  key={hours}
                  label={`≥ ${hours} h`}
                  selected={draft.reschedule_min_hours === hours}
                  onPress={() => void save({ reschedule_min_hours: hours })}
                />
              ))}
            </ChipRow>
          </View>

          <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.sm }}>
            <Text variant="bodyStrong">Policy in context</Text>
            <Text variant="small">
              Platform defaults are {formatDuration(defaultPlatformConfig.min_notice_minutes)} notice, a{' '}
              {defaultPlatformConfig.booking_window_days}-day window, {defaultPlatformConfig.buffer_minutes}-minute buffers
              and auto-confirm. Anything you override here is stored per doctor and audited.
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
              <Badge label={`Notice ${formatDuration(draft.min_notice_minutes)}`} tone="neutral" icon="clock" />
              <Badge label={`Window ${draft.booking_window_days} d`} tone="neutral" icon="calendar" />
              <Badge
                label={draft.approval_mode === 'manual' ? 'Manual approval' : 'Auto-confirm'}
                tone={draft.approval_mode === 'manual' ? 'warning' : 'verified'}
                icon="check"
              />
              <Badge label={`Buffer ${draft.buffer_minutes} min`} tone="neutral" icon="clock" />
            </View>
          </Card>

          <Button label="Back to schedule" variant="ghost" onPress={() => router.back()} />
        </>
      )}
    </Screen>
  );
}
