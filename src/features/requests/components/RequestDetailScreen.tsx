import { StyleSheet, View } from 'react-native';

import { Button, ErrorState, Screen, Skeleton, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { useCustomerRequest } from '../hooks/useCustomerRequest';
import type { RequestKind } from '../kind';
import { loadErrorMessage } from '../messages';
import type { TimeOptions } from '../time';

import { RequestDetail } from './RequestDetail';

type RequestDetailScreenProps = TimeOptions & {
  /** The request id, or null when the link had no valid id. */
  requestId: string | null;
  /** The kind the list row carried: a hint for which read to use, never an authority. */
  kind?: RequestKind | null;
  onBack: () => void;
};

// Request detail: loading, "not found" (unknown, someone else's, or a bad link: one calm answer),
// error with Retry, or the request.
export function RequestDetailScreen({ requestId, onBack, ...time }: RequestDetailScreenProps) {
  return (
    <Screen>
      <View style={styles.back}>
        <Button title="Back" variant="ghost" accessibilityLabel="Back" onPress={onBack} />
      </View>
      {requestId ? (
        <Loaded requestId={requestId} onBack={onBack} {...time} />
      ) : (
        <NotFound onBack={onBack} />
      )}
    </Screen>
  );
}

function NotFound({ onBack }: { onBack: () => void }) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.md }}>
      <Text accessibilityRole="alert">{"We couldn't find that request."}</Text>
      <Button title="Close" variant="secondary" onPress={onBack} />
    </View>
  );
}

function Loaded({
  requestId,
  kind = null,
  onBack,
  timeZone,
  locale,
}: RequestDetailScreenProps & { requestId: string }) {
  const { space, type } = useTheme();
  const query = useCustomerRequest(requestId, kind);

  if (query.isPending) {
    return (
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Loading request"
        style={{ gap: space.md }}
      >
        <Skeleton height={type.title} width="60%" />
        <Skeleton height={type.bodyLg} />
        <Skeleton height={type.bodyLg} />
        <Skeleton height={type.bodyLg} />
      </View>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        message={loadErrorMessage(query.error.code)}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  if (query.data.request === null) return <NotFound onBack={onBack} />;
  return <RequestDetail request={query.data.request} timeZone={timeZone} locale={locale} />;
}

const styles = StyleSheet.create({
  back: { alignItems: 'flex-start' },
});
