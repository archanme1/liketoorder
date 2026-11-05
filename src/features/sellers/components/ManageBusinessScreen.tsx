import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  NavRow,
  Screen,
  Skeleton,
  Text,
} from '@/components/ui';
import { CuisineLabel } from '@/features/cuisines/components/CuisineLabel';
import { useMyMenu } from '@/features/menu/hooks/useMyMenu';
import { menuSummary, photosSummary } from '@/features/menu/photos';
import { useTheme } from '@/theme/useTheme';

import { useMyBusiness } from '../hooks/useMyBusiness';
import { getListingStatus, LISTING_STATUS_LABEL, typeLabel, type ListingStatus } from '../listing';
import { sellerErrorMessage } from '../messages';
import type { MyBusiness } from '../schema';

import { SellerLoading } from './SellerLoading';

// The Manage tab. Seller only (the tab layout's Tabs.Protected); the owner sees their own
// exact address here and nowhere else.
export function ManageBusinessScreen() {
  const { space } = useTheme();
  const router = useRouter();
  const business = useMyBusiness();

  let content;
  if (business.isPending) {
    content = <SellerLoading />;
  } else if (business.isError && business.data === undefined) {
    content = (
      <ErrorState
        message={sellerErrorMessage(business.error.code)}
        onRetry={() => void business.refetch()}
        retrying={business.isRefetching}
      />
    );
  } else if (!business.data) {
    content = (
      <EmptyState
        message="You don’t have a business yet."
        actionLabel="Start selling"
        onAction={() => router.push('/seller/onboarding')}
      />
    );
  } else {
    content = <BusinessSummary business={business.data} />;
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[styles.grow, { gap: space.lg, paddingVertical: space.xl }]}
      >
        <Text variant="h1" accessibilityRole="header">
          Manage Business
        </Text>
        {content}
      </ScrollView>
    </Screen>
  );
}

function BusinessSummary({ business }: { business: MyBusiness }) {
  const { space } = useTheme();
  const router = useRouter();
  const status = getListingStatus(business);

  return (
    <View style={{ gap: space.lg }}>
      <StatusChip status={status} />
      {status === 'no_location' ? (
        <Card style={{ gap: space.md }}>
          <Text>Your listing isn’t on the map yet. Add your address to go live.</Text>
          <Button title="Add address" onPress={() => router.push('/seller/address')} />
        </Card>
      ) : null}
      <Card style={{ gap: space.lg }}>
        <Detail label="Business name" value={business.name} />
        <Detail label="Type" value={typeLabel(business.type)} />
        <View style={{ gap: space.xs }}>
          <Text color="textMuted">Cuisine</Text>
          <CuisineLabel code={business.cuisine_code} variant="bodyLg" />
        </View>
        <Detail
          label="Address"
          value={business.location?.formatted_address ?? 'Not added yet'}
          note={
            business.type === 'homemade' && business.location
              ? 'Only you can see this. The map shows an approximate area.'
              : undefined
          }
        />
        {business.type === 'restaurant' ? (
          <Detail
            label="Table requests"
            value={business.accepts_table_requests ? 'Accepted' : 'Not accepted'}
          />
        ) : null}
      </Card>
      <Button title="Edit details" onPress={() => router.push('/seller/edit')} />
      <Button
        title="Change address"
        variant="secondary"
        onPress={() => router.push('/seller/address')}
      />
      <MenuRows businessId={business.id} />
    </View>
  );
}

// Spec 06: the Menu and Photos rows. Their summaries load on their own, so the business card
// never waits for the menu; on error the rows still open their screens.
function MenuRows({ businessId }: { businessId: string }) {
  const { space } = useTheme();
  const router = useRouter();
  const menu = useMyMenu(businessId);

  const loading = menu.isPending ? <Skeleton height={space.lg} width="60%" /> : undefined;
  const failed = menu.isError && menu.data === undefined ? 'Couldn’t load the summary' : undefined;

  return (
    <View style={{ gap: space.md }}>
      <NavRow
        label="Menu"
        value={menu.data ? menuSummary(menu.data) : failed}
        valueSlot={loading}
        onPress={() => router.push('/seller/menu')}
      />
      <NavRow
        label="Photos"
        value={menu.data ? photosSummary(menu.data) : failed}
        valueSlot={loading}
        onPress={() => router.push('/seller/photos')}
      />
    </View>
  );
}

function Detail({ label, value, note }: { label: string; value: string; note?: string }) {
  const { space } = useTheme();
  return (
    <View accessible style={{ gap: space.xs }}>
      <Text color="textMuted">{label}</Text>
      <Text variant="bodyLg">{value}</Text>
      {note ? (
        <Text variant="caption" color="textMuted">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

const STATUS_STYLE: Record<
  ListingStatus,
  { icon: 'checkmark-circle' | 'eye-off' | 'location'; color: 'success' | 'textMuted' | 'warning' }
> = {
  live: { icon: 'checkmark-circle', color: 'success' },
  hidden: { icon: 'eye-off', color: 'textMuted' },
  no_location: { icon: 'location', color: 'warning' },
};

// Icon + text, never color alone.
function StatusChip({ status }: { status: ListingStatus }) {
  const { colors, space, radius, type, weight } = useTheme();
  const { icon, color } = STATUS_STYLE[status];
  return (
    <View
      accessible
      accessibilityLabel={`Listing status: ${LISTING_STATUS_LABEL[status]}`}
      style={[
        styles.chip,
        {
          gap: space.sm,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderRadius: radius.pill,
          borderColor: colors[color],
          backgroundColor: colors.surface,
        },
      ]}
    >
      <Ionicons name={icon} size={type.bodyLg} color={colors[color]} />
      <Text style={{ fontWeight: weight.semibold }}>{LISTING_STATUS_LABEL[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
