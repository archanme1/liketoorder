import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ErrorState, Skeleton, Text } from '@/components/ui';
import { useSignedUrls } from '@/features/media/hooks/useSignedUrls';
import { useTheme } from '@/theme/useTheme';

import { nextDay, nothingLogged, previousDay } from '../activity';
import { formatLocalDate } from '../date';
import { useFoodLogDay } from '../hooks/useFoodLogDay';
import { foodLogErrorMessage } from '../messages';
import type { FoodLog } from '../schema';
import { FOOD_LOG_BUCKET } from '../shared';

import { DayPanelRow } from './DayPanelRow';
import { FoodLogRefreshError } from './FoodLogRefreshError';

type DayPanelProps = {
  date: string;
  /** The grid's range: Previous and Next day stay inside it. */
  from: string;
  today: string;
  onChangeDate: (date: string) => void;
};

// The chosen day's uploads, oldest first, under the grid (spec 14 Decision 3). Previous / Next day
// and the rows are 44 pt, so every action a 14 pt grid square offers is reachable without one
// (Decision 11). Each row opens the existing detail page.
export function DayPanel({ date, from, today, onChangeDate }: DayPanelProps) {
  const router = useRouter();
  const { space, size } = useTheme();
  const query = useFoodLogDay(date);
  const logs = useMemo(() => query.data?.items ?? [], [query.data]);
  const paths = useMemo(() => logs.flatMap((log) => (log.path ? [log.path] : [])), [logs]);
  const { urlFor, renew } = useSignedUrls(FOOD_LOG_BUCKET, paths);
  const previous = previousDay(date, from);
  const next = nextDay(date, today);

  const open = useCallback(
    (log: FoodLog) => router.push({ pathname: '/food-log/[id]', params: { id: log.id } }),
    [router],
  );
  const onExpired = useCallback((path: string) => void renew(path), [renew]);

  return (
    <View style={{ gap: space.md }}>
      <Text variant="bodyLg" accessibilityRole="header">
        {formatLocalDate(date)}
      </Text>
      <View style={[styles.nav, { gap: space.sm }]}>
        <DayNavButton
          testID="day-previous"
          title="Previous day"
          onPress={previous ? () => onChangeDate(previous) : null}
        />
        <DayNavButton
          testID="day-next"
          title="Next day"
          onPress={next ? () => onChangeDate(next) : null}
        />
      </View>
      {previous === null ? <Text color="textMuted">First day of this range</Text> : null}
      {next === null ? <Text color="textMuted">Last day of this range</Text> : null}

      {query.isPending ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Loading this day's photos"
          style={{ gap: space.sm }}
        >
          <Skeleton height={size.photoMini} rounded="md" />
          <Skeleton height={size.photoMini} rounded="md" />
        </View>
      ) : query.isError && query.data === undefined ? (
        <ErrorState
          message={foodLogErrorMessage(query.error.code)}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : (
        <View style={{ gap: space.sm }}>
          {query.isRefetchError ? (
            <FoodLogRefreshError
              message={foodLogErrorMessage(query.error.code)}
              onRetry={() => void query.refetch()}
              retrying={query.isFetching}
              retryLabel="Try loading this day again"
            />
          ) : null}
          {logs.length === 0 ? (
            <Text color="textMuted">{nothingLogged(date)}</Text>
          ) : (
            logs.map((log) => (
              <DayPanelRow
                key={log.id}
                log={log}
                uri={log.path ? urlFor(log.path) : null}
                onExpired={onExpired}
                onPress={open}
              />
            ))
          )}
        </View>
      )}
    </View>
  );
}

type DayNavButtonProps = {
  testID: string;
  title: string;
  /** null at the edge of the range: the button is disabled. */
  onPress: (() => void) | null;
};

function DayNavButton({ testID, title, onPress }: DayNavButtonProps) {
  const { colors, space, size, radius, opacity } = useTheme();
  const disabled = onPress === null;
  return (
    <Pressable
      testID={testID}
      onPress={onPress ?? undefined}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.navButton,
        {
          minHeight: size.touch,
          minWidth: size.touch,
          paddingHorizontal: space.lg,
          borderRadius: radius.md,
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: disabled ? opacity.disabled : pressed ? opacity.pressed : 1,
        },
      ]}
    >
      <Text color="primary">{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row' },
  navButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
