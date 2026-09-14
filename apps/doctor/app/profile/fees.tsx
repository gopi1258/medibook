/**
 * Consultation config (DOC-004) — per type: enabled, fee, duration.
 *
 * The consequences the PRD calls out are shown next to the controls: fee changes
 * apply to **future bookings only**, a duration must respect the 10–120 minute
 * range, and a type with no fee is a legitimate free consultation rather than an
 * error state.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import type { ConsultFee, ConsultType } from '@medibook/core';
import { formatMoney } from '@medibook/core';
import {
  Badge,
  Button,
  Card,
  Icon,
  PolicyNote,
  Screen,
  ScreenHeader,
  SectionHeading,
  Text,
  TextField,
  color,
  spacing,
} from '@medibook/brand';

import { useConsultationConfig, useUpdateConsultationConfig } from '../../src/lib/hooks';
import { consultTypeIcon, consultTypeLabel, describeError } from '../../src/lib/format';
import { ErrorState, InlineNotice, ListSkeleton } from '../../src/components/states';

const DURATIONS = [10, 15, 20, 30, 45, 60, 90, 120];

export default function FeesScreen() {
  const router = useRouter();
  const config = useConsultationConfig();
  const update = useUpdateConsultationConfig();

  const [draft, setDraft] = React.useState<ConsultFee[] | null>(null);
  const [feeInputs, setFeeInputs] = React.useState<Record<string, string>>({});
  const [failure, setFailure] = React.useState<unknown>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (draft !== null || !config.data) return;
    setDraft(config.data.fees.map((fee) => ({ ...fee })));
    setFeeInputs(
      Object.fromEntries(config.data.fees.map((fee) => [fee.consult_type, String(fee.fee_minor / 100)])),
    );
  }, [config.data, draft]);

  const commit = async (next: ConsultFee[]) => {
    setDraft(next);
    setSaved(false);
    setFailure(null);
    try {
      await update.mutateAsync({ fees: next });
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
      if (config.data) setDraft(config.data.fees.map((fee) => ({ ...fee })));
    }
  };

  const patch = (consultType: ConsultType, changes: Partial<ConsultFee>) => {
    if (!draft) return;
    void commit(draft.map((fee) => (fee.consult_type === consultType ? { ...fee, ...changes } : fee)));
  };

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}>
      <ScreenHeader
        title="Consultation types & fees"
        subtitle="What you offer, how long, and at what price"
        onBack={() => router.back()}
      />

      {config.isLoading || draft === null ? (
        <ListSkeleton count={3} />
      ) : config.isError ? (
        <ErrorState error={config.error} onRetry={() => void config.refetch()} />
      ) : (
        <>
          {saved ? <InlineNotice tone="success" message="Saved. New bookings use these values immediately." /> : null}
          {failure ? <InlineNotice message={describeError(failure).message} /> : null}

          {draft.map((fee) => (
            <Card key={fee.consult_type} style={{ gap: spacing.md, opacity: fee.enabled ? 1 : 0.7 }}>
              <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: fee.enabled ? color.primaryTint : color.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon
                    name={consultTypeIcon(fee.consult_type)}
                    size={20}
                    color={fee.enabled ? color.primary : color.textMuted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="h3">{consultTypeLabel(fee.consult_type)}</Text>
                  <Text variant="caption">
                    {fee.enabled
                      ? `${fee.duration_minutes} minutes · ${formatMoney(fee.fee_minor, fee.currency)}`
                      : 'Not offered — patients cannot book this type'}
                  </Text>
                </View>
                <Badge
                  label={fee.enabled ? 'Offered' : 'Off'}
                  tone={fee.enabled ? 'verified' : 'neutral'}
                  icon={fee.enabled ? 'check-circle' : 'close'}
                />
              </View>

              <Button
                label={fee.enabled ? 'Turn this type off' : 'Offer this type'}
                variant={fee.enabled ? 'ghost' : 'secondary'}
                size="sm"
                block={false}
                onPress={() => patch(fee.consult_type, { enabled: !fee.enabled })}
              />

              {fee.enabled ? (
                <>
                  <TextField
                    label={`Fee in ${fee.currency} (major units)`}
                    value={feeInputs[fee.consult_type] ?? ''}
                    onChangeText={(next) => setFeeInputs((current) => ({ ...current, [fee.consult_type]: next }))}
                    onBlur={() => {
                      const parsed = Number((feeInputs[fee.consult_type] ?? '').replace(/[^0-9.]/g, ''));
                      if (!Number.isFinite(parsed) || parsed < 0) {
                        patch(fee.consult_type, {});
                        return;
                      }
                      patch(fee.consult_type, { fee_minor: Math.round(parsed * 100) });
                    }}
                    keyboardType="decimal-pad"
                    helper="Enter 0 for a free consultation — those skip payment entirely."
                  />

                  <Text variant="label">Duration</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    {DURATIONS.map((minutes) => (
                      <Badge
                        key={minutes}
                        label={`${minutes} min`}
                        tone={fee.duration_minutes === minutes ? 'verified' : 'neutral'}
                        icon={fee.duration_minutes === minutes ? 'check-circle' : 'clock'}
                      />
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                    {DURATIONS.map((minutes) => (
                      <Button
                        key={minutes}
                        label={`Set ${minutes}`}
                        size="sm"
                        variant={fee.duration_minutes === minutes ? 'primary' : 'secondary'}
                        block={false}
                        onPress={() => patch(fee.consult_type, { duration_minutes: minutes })}
                      />
                    ))}
                  </View>

                  {fee.consult_type === 'video' ? (
                    <PolicyNote
                      tone="info"
                      title="Video needs a camera"
                      body="Patients without a working camera can still be seen in-clinic — keep that type enabled as a fallback if you offer both."
                    />
                  ) : null}
                </>
              ) : null}
            </Card>
          ))}

          <PolicyNote
            tone="warning"
            title="Fee changes are forward-only"
            body="Patients who already booked keep the price they paid, and their receipt is unchanged. Only bookings made after this save use the new fee."
          />

          <SectionHeading title="Summary" />
          <Card variant="flat" style={{ gap: spacing.sm }}>
            {draft.map((fee) => (
              <View key={fee.consult_type} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                <Text variant="small">{consultTypeLabel(fee.consult_type)}</Text>
                <Text variant="smallMedium">
                  {fee.enabled
                    ? `${formatMoney(fee.fee_minor, fee.currency)} · ${fee.duration_minutes} min`
                    : 'Not offered'}
                </Text>
              </View>
            ))}
          </Card>

          <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
            <Text variant="bodyStrong">How this affects availability</Text>
            <Text variant="small">
              Durations and buffers are applied during slot generation, so changing a duration here changes how many slots
              your existing weekly windows publish.
            </Text>
          </Card>

          <Button label="Back to profile" variant="ghost" onPress={() => router.back()} />
        </>
      )}
    </Screen>
  );
}
