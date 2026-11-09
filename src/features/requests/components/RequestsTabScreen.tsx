import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner, Button, Text } from '@/components/ui';
import { useIsSeller } from '@/features/navigation/hooks/useIsSeller';
import { useMyBusiness } from '@/features/sellers/hooks/useMyBusiness';
import { maxFontMultiplier } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { requestKeys } from '../hooks/keys';
import { useRequestsCounts } from '../hooks/useRequestsBadge';
import { SENT_EMPTY, BUSINESS_CHECK_ERROR } from '../messages';
import type { PickupRequest, SellerRequest } from '../schema';
import type { TimeOptions } from '../time';

import { MyRequestsList } from './MyRequestsList';
import { RequestsSwitch, type RequestsSide } from './RequestsSwitch';
import { SellerRequestsScreen } from './SellerRequestsScreen';

type RequestsTabScreenProps = TimeOptions & {
  /** The tab is the one on screen. Reading the lists as seen, and refetching, follow this. */
  focused: boolean;
  onOpenSent: (request: PickupRequest) => void;
  onOpenReceived: (request: SellerRequest) => void;
};

// The Requests tab. A customer sees the requests they sent. Anyone who owns a business (whatever
// the seller mode) also gets Received / Sent at the top: Received is the seller inbox, Sent is
// their own requests as a customer. It opens on Received with seller mode on and on Sent with it
// off, until the person picks (local state: a cold start begins again). Both lists stay mounted
// and the one not shown is hidden, so a switch never loses scroll or loaded pages. Opening Sent
// marks what is there as seen (it clears the Sent number); coming back to the tab re-reads.
export function RequestsTabScreen({
  focused,
  onOpenSent,
  onOpenReceived,
  timeZone,
  locale,
}: RequestsTabScreenProps) {
  const { space } = useTheme();
  const queryClient = useQueryClient();
  const isSeller = useIsSeller();
  const business = useMyBusiness();
  const counts = useRequestsCounts();
  const [picked, setPicked] = useState<RequestsSide | null>(null);

  // Seller mode on means a business exists, so the switches need not wait for the business query.
  const isOwner = business.isSuccess ? business.data !== null : isSeller ? true : undefined;
  const side: RequestsSide = isOwner ? (picked ?? (isSeller ? 'received' : 'sent')) : 'sent';
  const sentShown = side === 'sent';

  const { markSentSeen } = counts;
  useEffect(() => {
    if (focused && sentShown) markSentSeen();
  }, [focused, sentShown, markSentSeen]);

  // Coming back to the tab: the lists and the waiting number are read again (not on first focus).
  const wasFocused = useRef(focused);
  useEffect(() => {
    if (focused && !wasFocused.current) {
      void queryClient.invalidateQueries({ queryKey: requestKeys.mine });
      void queryClient.invalidateQueries({ queryKey: requestKeys.inboxAll });
      void queryClient.invalidateQueries({ queryKey: requestKeys.waitingCount });
    }
    wasFocused.current = focused;
  }, [focused, queryClient]);

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.md }}>
        <Text variant="title" accessibilityRole="header" maxFontSizeMultiplier={maxFontMultiplier}>
          Requests
        </Text>
        {business.isError && !isOwner ? (
          <View style={{ gap: space.sm }}>
            <Banner message={BUSINESS_CHECK_ERROR} />
            <Button
              title="Try again"
              variant="secondary"
              accessibilityLabel="Try checking your business again"
              onPress={() => void business.refetch()}
              loading={business.isFetching}
            />
          </View>
        ) : null}
        {isOwner ? (
          <RequestsSwitch
            value={side}
            onChange={setPicked}
            receivedCount={counts.received}
            sentCount={counts.sent}
          />
        ) : null}
      </View>
      <View style={styles.panes}>
        {isOwner ? (
          <Pane hidden={side !== 'received'}>
            <SellerRequestsScreen onOpen={onOpenReceived} timeZone={timeZone} locale={locale} />
          </Pane>
        ) : null}
        <Pane hidden={side !== 'sent'}>
          <View style={[styles.sent, { paddingHorizontal: space.lg }]}>
            <MyRequestsList
              onOpen={onOpenSent}
              emptyMessage={SENT_EMPTY}
              timeZone={timeZone}
              locale={locale}
            />
          </View>
        </Pane>
      </View>
    </SafeAreaView>
  );
}

// The side not shown stays mounted (its scroll and pages are kept) but is out of sight and out of
// reach of the screen reader.
function Pane({ hidden, children }: { hidden: boolean; children: React.ReactNode }) {
  return (
    <View
      testID={hidden ? 'pane-hidden' : 'pane-shown'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      style={hidden ? styles.hidden : styles.pane}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  panes: { flex: 1 },
  pane: { flex: 1 },
  hidden: { display: 'none' },
  sent: { flex: 1 },
});
