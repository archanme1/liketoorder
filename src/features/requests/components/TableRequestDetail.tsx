import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Banner, Button, Card, Text } from '@/components/ui';
import { deviceLocale } from '@/features/menu/hooks/useCurrencies';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { useCancelTableRequest } from '../hooks/useCancelTableRequest';
import { requestErrorMessage } from '../messages';
import type { TableRequest } from '../schema';
import { statusSentence } from '../status';
import { formatDateTime, formatDateTimeWithZone, type TimeOptions } from '../time';

import { AnswerLines } from './AnswerLines';
import { partyText } from './RequestRow';
import { RequestStatusChip } from './RequestStatusChip';

type TableRequestDetailProps = TimeOptions & {
  request: TableRequest;
};

// One table request: the server's status as a word, the table time WITH its zone name, the party,
// the note, the seller's answer, and (pending only) a Cancel with a confirm step. Cancelling after
// an acceptance is not possible in v1.
export function TableRequestDetail({
  request,
  timeZone,
  locale = deviceLocale(),
}: TableRequestDetailProps) {
  const { space } = useTheme();
  const cancel = useCancelTableRequest();
  const [confirming, setConfirming] = useState(false);

  const options = { timeZone, locale };
  const status = request.display_status;
  const cancelError = cancel.error ? requestErrorMessage(cancel.error.code) : null;

  return (
    <ScrollView contentContainerStyle={{ gap: space.lg, paddingBottom: space.xxl }}>
      <View style={{ gap: space.sm }}>
        <Text variant="title" accessibilityRole="header" maxFontSizeMultiplier={maxFontMultiplier}>
          {request.business_name}
        </Text>
        <RequestStatusChip status={status} />
        <Text variant="bodyLg">{statusSentence(status, request.business_name)}</Text>
        <AnswerLines request={request} variant="bodyLg" />
        {status === 'pending' ? (
          <Text color="textMuted">
            {`If there is no answer by ${formatDateTime(request.expires_at, options)}, this request expires.`}
          </Text>
        ) : null}
      </View>

      <Card style={{ gap: space.sm }}>
        <Text accessibilityRole="header">Table</Text>
        <Text>{formatDateTimeWithZone(request.table_at, options)}</Text>
        <Text>{partyText(request.party_size)}</Text>
        <Text color="textMuted">{`Sent ${formatDateTime(request.created_at, options)}`}</Text>
        {request.note ? (
          <View style={{ gap: space.xs }}>
            <Text accessibilityRole="header">Your note</Text>
            <Text>{request.note}</Text>
          </View>
        ) : null}
      </Card>

      {cancelError ? <Banner message={cancelError} /> : null}

      {status === 'pending' ? (
        confirming ? (
          <Card style={{ gap: space.md }}>
            <Text accessibilityRole="header">Cancel this request?</Text>
            <Text color="textMuted">{`${request.business_name} will not see it any more.`}</Text>
            <Button
              title="Yes, cancel request"
              onPress={() =>
                cancel.cancelRequest(request.id, { onSettled: () => setConfirming(false) })
              }
              loading={cancel.isPending}
              disabled={cancel.isPending}
            />
            <Button
              title="Keep request"
              variant="secondary"
              onPress={() => setConfirming(false)}
              disabled={cancel.isPending}
            />
          </Card>
        ) : (
          <Button
            title="Cancel request"
            variant="secondary"
            onPress={() => {
              cancel.reset();
              setConfirming(true);
            }}
          />
        )
      ) : null}
    </ScrollView>
  );
}
