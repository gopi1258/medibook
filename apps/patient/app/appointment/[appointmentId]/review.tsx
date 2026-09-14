/**
 * Rate & review (J8 / APT-011, R15, REV-001) — one review per **completed**
 * appointment, editable for 24 hours.
 *
 * The API rejects reviews for anything that did not happen
 * (`APT_REVIEW_NOT_ALLOWED`) and duplicates (`APT_REVIEW_EXISTS`); this screen
 * shows why before the user types anything, and surfaces those exact codes.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { reviewWindow } from '@medibook/core';
import {
  Button,
  Card,
  PolicyNote,
  Sheet,
  StarRating,
  Text,
  TextArea,
  color,
  spacing,
} from '@medibook/brand';

import { patientApi } from '../../../src/lib/api';
import { useAppointment } from '../../../src/lib/hooks';
import { useViewerTimeZone } from '../../../src/lib/session';
import { appointmentTimeLabel, consultTypeLabel, describeError } from '../../../src/lib/format';
import { InlineNotice, ListSkeleton } from '../../../src/components/states';

const RATING_HINTS: Record<number, string> = {
  1: 'Poor — the visit did not help.',
  2: 'Below expectations.',
  3: 'Fine, nothing special.',
  4: 'Good — I would come back.',
  5: 'Excellent — highly recommended.',
};

export default function ReviewScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { appointmentId } = useLocalSearchParams<{ appointmentId?: string }>();
  const viewerTz = useViewerTimeZone();

  const appointment = useAppointment(appointmentId);
  const [rating, setRating] = React.useState(0);
  const [comment, setComment] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);
  const [done, setDone] = React.useState(false);

  const data = appointment.data;
  const completed = data ? ['completed', 'no_show'].includes(data.status) : false;
  const window = data ? reviewWindow(data.updated_at, Date.now()) : null;

  const submit = async () => {
    if (!appointmentId || rating < 1) return;
    setSubmitting(true);
    setFailure(null);
    try {
      await patientApi.submitReview(appointmentId, {
        rating: rating as 1 | 2 | 3 | 4 | 5,
        comment: comment.trim().length > 0 ? comment.trim() : null,
      });
      setDone(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['appointment'] }),
        queryClient.invalidateQueries({ queryKey: ['appointments'] }),
        queryClient.invalidateQueries({ queryKey: ['doctor'] }),
      ]);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      visible
      onClose={() => router.back()}
      title={done ? 'Thank you' : 'Rate your visit'}
      subtitle={data ? `${data.doctor_name} · ${data.code}` : 'Loading…'}
      footer={
        done ? (
          <View style={{ gap: spacing.sm }}>
            <Button label="Back to appointment" onPress={() => router.replace(`/appointment/${data?.id ?? ''}`)} />
            <Button label="Done" variant="ghost" onPress={() => router.back()} />
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Button
              label={submitting ? 'Submitting…' : 'Submit review'}
              loading={submitting}
              disabled={rating < 1 || !completed || submitting}
              onPress={() => void submit()}
            />
            <Button label="Not now" variant="ghost" onPress={() => router.back()} />
          </View>
        )
      }
    >
      {appointment.isLoading ? (
        <ListSkeleton count={2} />
      ) : !data ? (
        <InlineNotice message={describeError(appointment.error).message} />
      ) : done ? (
        <View style={{ gap: spacing.lg }}>
          <PolicyNote
            tone="success"
            title="Your review is live"
            body="It appears on the doctor’s profile with a verified-visit badge. You can edit it once within 24 hours; after that it is locked."
          />
          <Text variant="small">
            Reviews are only accepted from patients who completed a visit, which is what makes the rating trustworthy.
          </Text>
        </View>
      ) : !completed ? (
        <View style={{ gap: spacing.lg }}>
          <PolicyNote
            tone="warning"
            title="Review opens after the visit"
            body="You can rate a consultation once the doctor marks it complete. Nothing to do now — we will prompt you two hours after the visit."
          />
          <Button label="Back" variant="secondary" onPress={() => router.back()} />
        </View>
      ) : data.review_id ? (
        <View style={{ gap: spacing.lg }}>
          <PolicyNote
            tone="info"
            title="You already reviewed this visit"
            body="One review per completed appointment. If something changed, contact support and we can reopen the edit window."
          />
        </View>
      ) : (
        <View style={{ gap: spacing.lg }}>
          <Card variant="flat" style={{ gap: spacing.sm }}>
            <Text variant="label">The visit</Text>
            <Text variant="bodyStrong">{appointmentTimeLabel(data, viewerTz)}</Text>
            <Text variant="small">
              {consultTypeLabel(data.consult_type)} · for {data.for_name}
            </Text>
          </Card>

          <View style={{ gap: spacing.md, alignItems: 'center' }}>
            <Text variant="h3">How was it?</Text>
            <StarRating value={rating} onChange={setRating} size={36} />
            <Text variant="small" color={rating > 0 ? color.dark : color.textMuted}>
              {rating > 0 ? RATING_HINTS[rating] : 'Tap a star to rate'}
            </Text>
          </View>

          <TextArea
            label="Tell other patients what to expect (optional)"
            value={comment}
            onChangeText={setComment}
            placeholder="Was the doctor on time? Did they explain the plan clearly?"
            maxLength={500}
          />

          {window ? (
            <Text variant="caption">
              Editable until {window.closesAtUtc.slice(0, 16).replace('T', ' ')} UTC, then locked.
            </Text>
          ) : null}

          <PolicyNote
            tone="info"
            title="Reviews are published straight away"
            body="There is no pre-moderation in the MVP: reviews auto-publish with a verified-visit badge and can be reported for moderation. Doctors cannot delete them."
          />

          {failure ? <InlineNotice message={describeError(failure).message} /> : null}
        </View>
      )}
    </Sheet>
  );
}
