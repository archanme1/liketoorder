import { useRouter } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, Alert, RefreshControl, View } from 'react-native';

import { Banner, Button, Card, ErrorState, Text } from '@/components/ui';
import { SellerLoading } from '@/features/sellers/components/SellerLoading';
import { SellerScreenFrame } from '@/features/sellers/components/SellerScreenFrame';
import { SellerScreenGate } from '@/features/sellers/components/SellerScreenGate';
import { useTheme } from '@/theme/useTheme';

import type { PromotionErrorCode } from '../api';
import { invitationText } from '../format';
import { useCancelPromotion } from '../hooks/useCancelPromotion';
import { useMyPromotion } from '../hooks/useMyPromotion';
import { CONTACT_TO_CANCEL_TEXT, promotionErrorMessage, REVIEW_NOTE } from '../messages';
import type { MyPromotion, Promotion, PromotionSettings } from '../schema';

import { PromoteForm } from './PromoteForm';
import { PromotionStatusCard } from './PromotionStatusCard';

// Open: the server refuses a new request (already_open), so there is no Promote again.
const OPEN_STATES: readonly Promotion['state'][] = [
  'requested',
  'awaiting_payment',
  'scheduled',
  'active',
];
// Waiting for review or for the money: cancelled like a request (spec 16b).
const REQUEST_STATES: readonly Promotion['state'][] = ['requested', 'awaiting_payment'];

// A paid campaign cannot be ended from the app (the server answers contact_support), so it gets no
// cancel button, only the plain "Contact us to cancel." line (text, not a button: the app has no
// support contact until spec 18). A free campaign keeps spec 16 behaviour.
function isRunningOrScheduled(promotion: Promotion): boolean {
  return promotion.state === 'scheduled' || promotion.state === 'active';
}

function canCancel(promotion: Promotion): boolean {
  return (
    REQUEST_STATES.includes(promotion.state) ||
    (isRunningOrScheduled(promotion) && promotion.is_free)
  );
}

function mustContactToCancel(promotion: Promotion): boolean {
  return isRunningOrScheduled(promotion) && !promotion.is_free;
}

// A success notice belongs to the state it reports (`signature`): once the screen shows another
// state it is hidden, so "Request sent" never sits above "Promoted until ...". A pull to refresh
// clears every notice.
type Notice = { tone: 'success' | 'error'; message: string; signature?: string };

function stateSignature(promotion: Promotion | null): string {
  return promotion ? `${promotion.id}:${promotion.state}` : 'none';
}

// Spec 16: the seller's own promotion, from Manage Business. Signed-in business owners only (the
// seller screen gate); the server answers only for the caller's business, so nothing here can show
// another business's campaign. Pull to refresh re-reads it: the clock or an admin may change it.
export function PromoteScreen() {
  const query = useMyPromotion();
  const [pulling, setPulling] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  // A plain function: the React Compiler memoizes it. Destructuring `refetch` for a useCallback left
  // the screen on Loading in the tests (the query only re-renders for the fields read in render).
  const onRefresh = () => {
    setNotice(null);
    setPulling(true);
    void query.refetch().finally(() => setPulling(false));
  };

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
          return <PromoteBody data={query.data} notice={notice} setNotice={setNotice} />;
        }}
      </SellerScreenGate>
    </SellerScreenFrame>
  );
}

type PromoteBodyProps = {
  data: MyPromotion;
  notice: Notice | null;
  setNotice: (notice: Notice | null) => void;
};

function PromoteBody({ data, notice, setNotice }: PromoteBodyProps) {
  const { space } = useTheme();
  const cancel = useCancelPromotion();
  const [composing, setComposing] = useState(false);
  const promotion = data.promotion;
  const shown =
    notice && (notice.signature === undefined || notice.signature === stateSignature(promotion))
      ? notice
      : null;
  const open = promotion !== null && OPEN_STATES.includes(promotion.state);

  const tell = (next: Notice) => {
    setNotice(next);
    AccessibilityInfo.announceForAccessibility(next.message);
  };
  const showError = (code: PromotionErrorCode) =>
    tell({ tone: 'error', message: promotionErrorMessage(code) });

  const confirmCancel = (current: Promotion) => {
    const request = REQUEST_STATES.includes(current.state);
    const [title, message] = request
      ? [
          'Cancel this request?',
          current.state === 'requested' ? "We won't review it." : "Your promotion won't go ahead.",
        ]
      : current.state === 'scheduled'
        ? ['Cancel this promotion?', "It won't start."]
        : ['Stop your promotion now?', 'It ends at once.'];
    const keep = request ? 'Keep request' : 'Keep promotion';
    const confirm = request ? 'Cancel request' : 'Cancel promotion';
    Alert.alert(title, message, [
      { text: keep, style: 'cancel' },
      {
        text: confirm,
        style: 'destructive',
        onPress: () =>
          cancel.mutate(current.id, {
            onSuccess: (answer) =>
              tell({
                tone: 'success',
                message: request ? 'Request cancelled' : 'Promotion cancelled',
                signature: stateSignature(answer.promotion),
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
      {promotion && mustContactToCancel(promotion) ? (
        <Text color="textMuted">{CONTACT_TO_CANCEL_TEXT}</Text>
      ) : null}
      {shown ? <Banner tone={shown.tone} message={shown.message} /> : null}
      {promotion && open && canCancel(promotion) ? (
        <Button
          title={REQUEST_STATES.includes(promotion.state) ? 'Cancel request' : 'Cancel promotion'}
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
          onSent={(answer) => {
            setComposing(false);
            tell({
              tone: 'success',
              message: 'Request sent',
              signature: stateSignature(answer.promotion),
            });
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
  onSent: (answer: MyPromotion) => void;
  onError: (code: PromotionErrorCode) => void;
  /** "Not now" after Promote again; absent when there was never a campaign. */
  onClose?: () => void;
};

// What a promotion does and how long it runs, and the form. No price (spec 16b, Store rules).
// Seller only: customers never see this.
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

  return (
    <View style={{ gap: space.lg }}>
      <Card style={{ gap: space.sm }}>
        <Text variant="bodyLg">{invitationText(settings.length_days)}</Text>
        <Text color="textMuted">{REVIEW_NOTE}</Text>
      </Card>
      <PromoteForm onSent={onSent} onError={onError} />
      {notNow}
    </View>
  );
}
