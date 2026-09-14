/**
 * Weekly template editor (DOC-005) — create, edit and delete recurring windows.
 *
 * Two properties the PRD insists on are surfaced here:
 *  - overlapping windows on the same day are prevented by validation with a clear
 *    message rather than silently merged;
 *  - changing a future window is explicitly *forward-only*, and the screen says so,
 *    because existing bookings are never disturbed by a template edit.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import type { AvailabilityRule, ConsultType } from '@medibook/core';
import { minutesOfDay } from '@medibook/core';
import {
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  PolicyNote,
  Screen,
  ScreenHeader,
  SectionHeading,
  Sheet,
  Text,
  TextField,
  color,
  spacing,
} from '@medibook/brand';

import { useDeleteRule, useRules, useUpsertRule } from '../../src/lib/hooks';
import { describeError } from '../../src/lib/format';
import { ErrorState, InlineNotice, ListSkeleton } from '../../src/components/states';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SLOT_LENGTHS = [10, 15, 20, 30, 60];
const BUFFERS = [0, 5, 10, 15, 30];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

type Draft = {
  id?: string;
  weekday: number;
  start: string;
  end: string;
  slotMinutes: number;
  bufferMinutes: number;
  consultTypes: ConsultType[];
};

const emptyDraft = (weekday = 1): Draft => ({
  weekday,
  start: '10:00',
  end: '13:00',
  slotMinutes: 20,
  bufferMinutes: 5,
  consultTypes: ['in_person'],
});

export default function RulesScreen() {
  const router = useRouter();
  const rules = useRules();
  const upsert = useUpsertRule();
  const remove = useDeleteRule();

  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(emptyDraft());
  const [formError, setFormError] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<unknown>(null);

  const startEdit = (rule: AvailabilityRule) => {
    setDraft({
      id: rule.id,
      weekday: rule.weekday,
      start: rule.start_local_time,
      end: rule.end_local_time,
      slotMinutes: rule.slot_minutes,
      bufferMinutes: rule.buffer_minutes,
      consultTypes: [...rule.consult_types],
    });
    setFormError(null);
    setOpen(true);
  };

  const validate = (): string | null => {
    if (!TIME_PATTERN.test(draft.start) || !TIME_PATTERN.test(draft.end)) return 'Use 24-hour times like 09:30.';
    const start = minutesOfDay(draft.start);
    const end = minutesOfDay(draft.end);
    if (end <= start) return 'The end time must be after the start time.';
    if (draft.consultTypes.length === 0) return 'Pick at least one consultation type.';
    if (end - start < draft.slotMinutes) return 'The window is shorter than one slot.';

    const clash = (rules.data ?? []).find((rule) => {
      if (rule.id === draft.id) return false;
      if (rule.weekday !== draft.weekday) return false;
      const ruleStart = minutesOfDay(rule.start_local_time);
      const ruleEnd = minutesOfDay(rule.end_local_time);
      return start < ruleEnd && ruleStart < end;
    });
    if (clash) {
      return `This overlaps your existing ${WEEKDAYS[clash.weekday]} window ${clash.start_local_time}–${clash.end_local_time}.`;
    }
    return null;
  };

  const save = async () => {
    const error = validate();
    if (error) {
      setFormError(error);
      return;
    }
    setFailure(null);
    try {
      await upsert.mutateAsync({
        ...(draft.id ? { id: draft.id } : {}),
        weekday: draft.weekday,
        start_local_time: draft.start,
        end_local_time: draft.end,
        slot_minutes: draft.slotMinutes,
        buffer_minutes: draft.bufferMinutes,
        consult_types: draft.consultTypes,
        effective_from: new Date().toISOString().slice(0, 10),
      });
      setOpen(false);
      setDraft(emptyDraft(draft.weekday));
    } catch (caught) {
      setFailure(caught);
    }
  };

  return (
    <Screen
      scroll
      edges={['top']}
      contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}
      refreshing={rules.isRefetching && !rules.isLoading}
      onRefresh={() => void rules.refetch()}
    >
      <ScreenHeader
        title="Weekly template"
        subtitle="The recurring hours patients can book"
        onBack={() => router.back()}
        action={{ icon: 'plus', onPress: () => { setDraft(emptyDraft()); setFormError(null); setOpen(true); }, accessibilityLabel: 'Add window' }}
      />

      <PolicyNote
        tone="info"
        title="Wall-clock, DST-safe"
        body="Windows are stored as clinic-local wall time, so a 10:00 clinic stays 10:00 across a daylight-saving change instead of drifting to 09:00."
      />

      {rules.isLoading ? (
        <ListSkeleton count={3} />
      ) : rules.isError ? (
        <ErrorState error={rules.error} onRetry={() => void rules.refetch()} />
      ) : (rules.data ?? []).length === 0 ? (
        <EmptyState
          icon="clock"
          title="No working hours"
          description="Add at least one window per day you practise. Until then you publish no slots and patients cannot book you."
          actionLabel="Add a window"
          onAction={() => {
            setDraft(emptyDraft());
            setOpen(true);
          }}
        />
      ) : (
        WEEKDAYS.map((label, weekday) => {
          const dayRules = (rules.data ?? []).filter((rule) => rule.weekday === weekday);
          if (dayRules.length === 0) {
            return (
              <Card key={label} variant="flat" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Text variant="smallMedium" style={{ width: 96 }}>
                  {label}
                </Text>
                <Text variant="caption" style={{ flex: 1 }}>
                  Closed
                </Text>
                <Button
                  label="Add"
                  size="sm"
                  variant="ghost"
                  block={false}
                  onPress={() => {
                    setDraft(emptyDraft(weekday));
                    setFormError(null);
                    setOpen(true);
                  }}
                />
              </Card>
            );
          }
          return (
            <View key={label} style={{ gap: spacing.sm }}>
              <SectionHeading title={label} />
              {dayRules.map((rule) => (
                <Card key={rule.id} variant="flat" style={{ gap: spacing.sm }}>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Text variant="h3">
                      {rule.start_local_time}–{rule.end_local_time}
                    </Text>
                    <Badge label={`${rule.slot_minutes} min slots`} tone="neutral" icon="clock" />
                    <Badge label={`${rule.buffer_minutes} min buffer`} tone="neutral" icon="clock" />
                    {rule.consult_types.map((type) => (
                      <Badge
                        key={type}
                        label={type === 'video' ? 'Video' : 'In-clinic'}
                        tone={type === 'video' ? 'accent' : 'info'}
                        icon={type === 'video' ? 'video' : 'map-pin'}
                      />
                    ))}
                  </View>
                  <Text variant="caption">Effective from {rule.effective_from}</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Button label="Edit" size="sm" variant="secondary" block={false} onPress={() => startEdit(rule)} />
                    <Button
                      label="Delete"
                      size="sm"
                      variant="ghost"
                      block={false}
                      onPress={() => void remove.mutateAsync(rule.id).catch((error: unknown) => setFailure(error))}
                    />
                  </View>
                </Card>
              ))}
            </View>
          );
        })
      )}

      {failure ? <InlineNotice message={describeError(failure).message} /> : null}

      <PolicyNote
        tone="warning"
        title="Changes are forward-only"
        body="Deleting or shortening a window stops future slots from being offered. Appointments already booked inside that window are never touched — use Leaves & blocks if you need to resolve them explicitly."
      />

      <Button label="Add a window" icon="plus" variant="secondary" onPress={() => { setDraft(emptyDraft()); setFormError(null); setOpen(true); }} />

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={draft.id ? 'Edit window' : 'New window'}
        subtitle="Clinic-local time, with a buffer after each appointment"
        footer={
          <View style={{ gap: spacing.sm }}>
            <Button
              label={upsert.isPending ? 'Saving…' : draft.id ? 'Save window' : 'Add window'}
              loading={upsert.isPending}
              onPress={() => void save()}
            />
            <Button label="Cancel" variant="ghost" onPress={() => setOpen(false)} />
          </View>
        }
      >
        <View style={{ gap: spacing.lg }}>
          <Text variant="label">Day</Text>
          <ChipRow>
            {WEEKDAYS.map((label, weekday) => (
              <Chip
                key={label}
                label={label.slice(0, 3)}
                selected={draft.weekday === weekday}
                onPress={() => setDraft((current) => ({ ...current, weekday }))}
              />
            ))}
          </ChipRow>

          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <TextField
                label="Start"
                value={draft.start}
                onChangeText={(next) => setDraft((current) => ({ ...current, start: next }))}
                placeholder="10:00"
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextField
                label="End"
                value={draft.end}
                onChangeText={(next) => setDraft((current) => ({ ...current, end: next }))}
                placeholder="13:00"
              />
            </View>
          </View>

          <Text variant="label">Slot length</Text>
          <ChipRow>
            {SLOT_LENGTHS.map((length) => (
              <Chip
                key={length}
                label={`${length} min`}
                selected={draft.slotMinutes === length}
                onPress={() => setDraft((current) => ({ ...current, slotMinutes: length }))}
              />
            ))}
          </ChipRow>

          <Text variant="label">Buffer between patients</Text>
          <ChipRow>
            {BUFFERS.map((buffer) => (
              <Chip
                key={buffer}
                label={buffer === 0 ? 'None' : `${buffer} min`}
                selected={draft.bufferMinutes === buffer}
                onPress={() => setDraft((current) => ({ ...current, bufferMinutes: buffer }))}
              />
            ))}
          </ChipRow>

          <Text variant="label">Consultation types served</Text>
          <ChipRow>
            {(['in_person', 'video'] as const).map((type) => (
              <Chip
                key={type}
                label={type === 'video' ? 'Video' : 'In-clinic'}
                icon={type === 'video' ? 'video' : 'map-pin'}
                selected={draft.consultTypes.includes(type)}
                onPress={() =>
                  setDraft((current) => ({
                    ...current,
                    consultTypes: current.consultTypes.includes(type)
                      ? current.consultTypes.filter((entry) => entry !== type)
                      : [...current.consultTypes, type],
                  }))
                }
              />
            ))}
          </ChipRow>

          {formError ? <InlineNotice message={formError} tone="warning" /> : null}
          {failure ? <InlineNotice message={describeError(failure).message} /> : null}

          <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
            <Text variant="bodyStrong">Preview</Text>
            <Text variant="small">
              {WEEKDAYS[draft.weekday]} · {draft.start}–{draft.end} · {draft.slotMinutes} min slots with{' '}
              {draft.bufferMinutes} min buffers publishes roughly{' '}
              {Math.max(
                0,
                Math.floor((minutesOfDay(draft.end) - minutesOfDay(draft.start)) / (draft.slotMinutes + draft.bufferMinutes)),
              )}{' '}
              slots.
            </Text>
          </Card>
        </View>
      </Sheet>
    </Screen>
  );
}
