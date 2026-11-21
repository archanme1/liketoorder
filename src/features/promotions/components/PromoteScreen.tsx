import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { AccessibilityInfo, Alert, RefreshControl, View } from 'react-native';

import { Banner, Button, Card, ErrorState, Text } from '@/components/ui';
import { SellerLoading } from '@/features/sellers/components/SellerLoading';
import { SellerScreenFrame } from '@/features/sellers/components/SellerScreenFrame';
import { SellerScreenGate } from '@/features/sellers/components/SellerScreenGate';
import { useTheme } from '@/theme/useTheme';

import type { PromotionErrorCode } from '../api';
import { formatPromotionPrice, offerLine, phoneLocale } from '../format';
import { useCancelPromotion } from '../hooks/useCancelPromotion';
import { useMyPromotion } from '../hooks/useMyPromotion';
import { PAYMENT_NOTE, promotionErrorMessage } from '../messages';
import type { MyPromotion, Promotion, PromotionSettings } from '../schema';

import { PromoteForm } from './PromoteForm';
import { PromotionStatusCard } from './PromotionStatusCard';

const OPEN_STATES: readonly Promotion['state'][] = ['requested', 'scheduled', 'active'];

type Notice = { tone: 'success' | 'error'; message: string };

// Spec 16: the seller's own promotion, from Manage Business. Signed-in business owners only (the
// seller screen gate); the server answers only for the caller's business, so nothing here can show
// another business's campaign. Pull to refresh re-reads it: the clock or an admin may change it.
export function PromoteScreen() {
  const query = useMyPromotion();
  const [pulling, setPulling] = useState(false);
  const onRefresh = useCallback(() => {
    setPulling(true);
    void query.refetch().finally(() => setPulling(false));
  }, [query]);

  return (
    <SellerScreenFrame
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          onRefresh={onRefresh}
          accessibilityLabel="Refresh your promotion"
        />
      }
    >
      <SellerScreenGate screen="promote">
        {() => {
          if (query.isPending) return <SellerLoading label="Loading your promotion" />;
          // A failed background refetch keeps the loaded screen.
          if (query.isError && query.data === undefined) {
            return (
              <ErrorState
                message={promotionErrorMessage(query.error.code)}
                onRetry={() => void query.refetch()}
                retrying={query.isRefetching}
              />
            );
          }
          return <PromoteBody data={query.data} />;
        }}
      </SellerScreenGate>
    </SellerScreenFrame>
  );
}

function PromoteBody({ data }: { data: MyPromotion }) {
  const { space } = useTheme();
  const cancel = useCancelPromotion();
  const [composing, setComposing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const promotion = data.promotion;
  const open = promotion !== null && OPEN_STATES.includes(promotion.state);

  const tell = (next: Notice) => {
    setNotice(next);
    AccessibilityInfo.announceForAccessibility(next.message);
  };
  const showError = (code: PromotionErrorCode) =>
    tell({ tone: 'error', message: promotionErrorMessage(code) });

  const confirmCancel = (current: Promotion) => {
    const request = current.state === 'requested';
    const [title, message] = request
      ? ['Cancel this request?', "We won't review it."]
      : current.state === 'scheduled'
        ? ['Cancel this promotion?', "It won't start."]
        : ['Stop your promotion now?', 'It ends at once. Refunds are handled outside the app.'];
    const keep = request ? 'Keep request' : 'Keep promotion';
    const confirm = request ? 'Cancel request' : 'Cancel promotion';
    Alert.alert(title, message, [
      { text: keep, style: 'cancel' },
      {
        text: confirm,
        style: 'destructive',
        onPress: () =>
          cancel.mutate(current.id, {
            onSuccess: () =>
              tell({
                tone: 'success',
                message: request ? 'Request cancelled' : 'Promotion cancelled',
              }),
            onError: (error) => showError(error.code),
          }),
      },
    ]);
  };

  return (
    <View style={{ gap: space.lg }}>
      <Text variant="title" accessibilityRole="header">
        Promote your business
      </Text>
      {promotion ? <PromotionStatusCard promotion={promotion} /> : null}
      {notice ? <Banner tone={notice.tone} message={notice.message} /> : null}
      {promotion && open ? (
        <Button
          title={promotion.state === 'requested' ? 'Cancel request' : 'Cancel promotion'}
          variant="secondary"
          loading={cancel.isPending}
          onPress={() => confirmCancel(promotion)}
        />
      ) : null}
      {promotion && !open && !composing ? (
        <Button
          title="Promote again"
          onPress={() => {
            setNotice(null);
            setComposing(true);
          }}
        />
      ) : null}
      {promotion === null || (!open && composing) ? (
        <Invitation
          settings={data.settings}
          eligible={data.eligible}
          onSent={() => {
            setComposing(false);
            tell({ tone: 'success', message: 'Request sent' });
          }}
          onError={showError}
          onClose={promotion === null ? undefined : () => setComposing(false)}
        />
      ) : null}
    </View>
  );
}

type InvitationProps = {
  settings: PromotionSettings | null;
  eligible: boolean;
  onSent: () => void;
  onError: (code: PromotionErrorCode) => void;
  /** "Not now" after Promote again; absent when there was never a campaign. */
  onClose?: () => void;
};

// What a promotion does and costs, and the form. Seller only: customers never see this.
function Invitation({ settings, eligible, onSent, onError, onClose }: InvitationProps) {
  const { space } = useTheme();
  const router = useRouter();
  const notNow = onClose ? <Button title="Not now" variant="ghost" onPress={onClose} /> : null;

  if (settings === null) {
    return (
      <Card style={{ gap: space.md }}>
        <Text>{promotionErrorMessage('not_configured')}</Text>
        {notNow}
      </Card>
    );
  }
  if (!eligible) {
    return (
      <Card style={{ gap: space.md }}>
        <Text>{promotionErrorMessage('not_eligible')}</Text>
        {notNow ?? (
          <Button title="Back to Manage" variant="secondary" onPress={() => router.back()} />
        )}
      </Card>
    );
  }

  const price = offerLine(
    formatPromotionPrice(settings.price_cents, settings.currency_code, phoneLocale()),
    settings.length_days,
  );
  return (
    <View style={{ gap: space.lg }}>
      <Card style={{ gap: space.sm }}>
        <Text>
          A promotion gives your place a larger flag on the map and a card in the Offers list, both
          marked Sponsored.
        </Text>
        <Text variant="bodyLg">{price}</Text>
        <Text color="textMuted">{PAYMENT_NOTE}</Text>
      </Card>
      <PromoteForm onSent={onSent} onError={onError} />
      {notNow}
    </View>
  );
}
