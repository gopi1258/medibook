/**
 * Patient context (DOC-015) — everything a doctor may know about the person in
 * front of them, and nothing more.
 *
 * The API enforces the scope (visits with this doctor only, masked phone); the
 * screen restates the boundary so the doctor understands what they are *not*
 * seeing rather than assuming the record is complete.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  Avatar,
  Badge,
  Card,
  PolicyNote,
  Sheet,
  SheetRow,
  Text,
  color,
  spacing,
} from '@medibook/brand';

import { usePatientContext } from '../../../src/lib/hooks';
import { useClinicTimeZone } from '../../../src/lib/session';
import { ageLabel, consultTypeLabel, describeError, genderLabel, relativeTimeLabel } from '../../../src/lib/format';
import { InlineNotice, ListSkeleton } from '../../../src/components/states';

export default function PatientContextScreen() {
  const router = useRouter();
  const { appointmentId } = useLocalSearchParams<{ appointmentId?: string }>();
  const clinicTz = useClinicTimeZone();
  const context = usePatientContext(appointmentId);
  const data = context.data;

  return (
    <Sheet
      visible
      onClose={() => router.back()}
      title={data ? data.display_name : 'Patient context'}
      subtitle="Scoped to visits with you"
      footer={
        <Text variant="caption">
          No diagnosis, prescription or attachment data exists anywhere in MediBook. Clinical records stay in your own
          system.
        </Text>
      }
    >
      {context.isLoading ? (
        <ListSkeleton count={3} />
      ) : context.isError || !data ? (
        <InlineNotice message={describeError(context.error).message} />
      ) : (
        <View style={{ gap: spacing.lg }}>
          <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
            <Avatar name={data.display_name} size="lg" tone={data.dependent_id ? 'mint' : 'peach'} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="h3">{data.display_name}</Text>
              <Text variant="small">
                {ageLabel(data.age)} · {genderLabel(data.gender)}
              </Text>
              {data.relationship ? <Text variant="caption">Relationship to account holder: {data.relationship}</Text> : null}
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            <Badge label={`${data.completed_count_with_doctor} completed with you`} tone="verified" icon="check-circle" />
            <Badge
              label={data.no_show_count_with_doctor > 0 ? `${data.no_show_count_with_doctor} no-show` : 'No no-shows'}
              tone={data.no_show_count_with_doctor > 0 ? 'danger' : 'neutral'}
              icon="alert-circle"
            />
            {data.dependent_id ? <Badge label="Family member" tone="info" icon="users" /> : null}
          </View>

          <Card variant="flat" style={{ gap: spacing.md }}>
            <SheetRow label="Phone" value={data.phone_masked ?? 'Not shared'} tone="muted" />
            <SheetRow label="Appointment note" value={data.note ?? 'No note left'} />
          </Card>

          <View style={{ gap: spacing.sm }}>
            <Text variant="label">Visit history with you</Text>
            {data.visits_with_doctor.length === 0 ? (
              <Text variant="small">This is the first appointment with you.</Text>
            ) : (
              data.visits_with_doctor.map((visit) => (
                <Card key={visit.appointment_id} variant="flat" style={{ gap: spacing.xs }}>
                  <Text variant="smallMedium">
                    {relativeTimeLabel(Date.parse(visit.start_utc), clinicTz)} · {visit.status.replace(/_/g, ' ')}
                  </Text>
                  <Text variant="caption">
                    {consultTypeLabel(visit.consult_type)}
                    {visit.note ? ` · note: ${visit.note}` : ''}
                  </Text>
                </Card>
              ))
            )}
          </View>

          <PolicyNote
            tone="info"
            title="Why the list stops here"
            body="You see this patient’s history with you only. Visits with other clinicians, their records, and their family’s bookings are not visible — access is scoped per record, not per role."
          />

          <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
            <Text variant="bodyStrong">Before the consultation</Text>
            <Text variant="small">
              Check the appointment note for context, confirm identity verbally, and remember that a family member’s
              booking shows the guardian as the account holder — the patient in front of you is the person named above.
            </Text>
          </Card>
        </View>
      )}
    </Sheet>
  );
}
