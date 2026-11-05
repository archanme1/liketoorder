import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';

import { Banner, Button, EmptyState, ErrorState, NavRow, Text } from '@/components/ui';
import { useSignedUrls } from '@/features/media/hooks/useSignedUrls';
import { SellerLoading } from '@/features/sellers/components/SellerLoading';
import { SellerScreenFrame } from '@/features/sellers/components/SellerScreenFrame';
import { SellerScreenGate } from '@/features/sellers/components/SellerScreenGate';
import type { MyBusiness } from '@/features/sellers/schema';
import { useTheme } from '@/theme/useTheme';

import type { MoveDirection } from '../api';
import { deviceLocale, useCurrencies, useSuggestedCurrency } from '../hooks/useCurrencies';
import {
  useMoveMenuItem,
  useSetItemAvailable,
  useSetMenuCurrency,
} from '../hooks/useMenuItemMutations';
import { useMyMenu } from '../hooks/useMyMenu';
import { usePhotoCleanup } from '../hooks/usePhotoCleanup';
import { CURRENCY_LOCKED_REASON, ITEM_LIMIT_REASON, menuErrorMessage } from '../messages';
import { groupPhotos, MEDIA_BUCKET, slotPhoto } from '../photos';
import { ITEM_LIMIT, MENU_PHOTO_LIMIT, type Menu, type MenuItem } from '../schema';

import { currencyLabel, CurrencyPicker } from './CurrencyPicker';
import { MenuItemRow } from './MenuItemRow';

export function MenuScreen() {
  return (
    <SellerScreenFrame>
      <SellerScreenGate screen="menu">
        {(business) => <MenuBody business={business} />}
      </SellerScreenGate>
    </SellerScreenFrame>
  );
}

// Loads only after the business (Decision 14), with its own loading and error states.
function MenuBody({ business }: { business: MyBusiness }) {
  usePhotoCleanup();
  const menu = useMyMenu(business.id);

  if (menu.isPending) return <SellerLoading label="Loading your menu" />;
  if (menu.isError && menu.data === undefined) {
    return (
      <ErrorState
        message={menuErrorMessage(menu.error.code)}
        onRetry={() => void menu.refetch()}
        retrying={menu.isRefetching}
      />
    );
  }
  return <MenuEditor business={business} menu={menu.data} />;
}

function MenuEditor({ business, menu }: { business: MyBusiness; menu: Menu }) {
  const { space } = useTheme();
  const router = useRouter();
  const currencies = useCurrencies();
  const suggested = useSuggestedCurrency(currencies.data);
  const setCurrency = useSetMenuCurrency();
  const move = useMoveMenuItem(business.id);
  const setAvailable = useSetItemAvailable(business.id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const locale = deviceLocale();

  const currency = currencies.data?.find((c) => c.code === business.currency_code) ?? null;
  const hasPrices = menu.items.some((item) => item.price_minor !== null);
  const sections = useMemo(() => groupPhotos(menu.photos), [menu.photos]);
  const itemPhotoPaths = useMemo(
    () => [...sections.byItem.values()].flat().map((photo) => photo.path),
    [sections],
  );
  const urls = useSignedUrls(MEDIA_BUCKET, itemPhotoPaths);

  const items = menu.items;
  const count = items.length;
  const full = count >= ITEM_LIMIT;

  const onEdit = useCallback((item: MenuItem) => router.push(`/seller/menu/${item.id}`), [router]);
  const onMove = useCallback(
    (item: MenuItem, direction: MoveDirection) => {
      setBanner(null);
      const from = items.findIndex((row) => row.id === item.id);
      const to = direction === 'up' ? from - 1 : from + 1;
      if (from < 0 || to < 0 || to >= items.length) return;
      // The position is announced only once the server accepts the move; a rejected move rolls the
      // order back, so the seller hears the failure instead.
      move.mutate(
        { itemId: item.id, direction },
        {
          onSuccess: () =>
            AccessibilityInfo.announceForAccessibility(
              `${item.name} moved to position ${to + 1} of ${items.length}`,
            ),
          onError: (error) => {
            const message = menuErrorMessage(error.code);
            setBanner(message);
            AccessibilityInfo.announceForAccessibility(`Couldn’t move ${item.name}. ${message}`);
          },
        },
      );
    },
    [items, move],
  );
  const onToggleAvailable = useCallback(
    (item: MenuItem, isAvailable: boolean) => {
      setBanner(null);
      setAvailable.mutate(
        { item, isAvailable },
        { onError: (error) => setBanner(menuErrorMessage(error.code)) },
      );
    },
    [setAvailable],
  );
  const onExpired = useCallback((path: string) => void urls.renew(path), [urls]);

  const currencyValue = currency
    ? currencyLabel(currency)
    : business.currency_code
      ? business.currency_code
      : 'Not set';

  return (
    <View style={{ gap: space.lg }}>
      {banner ? <Banner message={banner} /> : null}
      <NavRow
        label="Currency"
        value={currencyValue}
        onPress={() => setPickerOpen(true)}
        disabledReason={hasPrices ? CURRENCY_LOCKED_REASON : undefined}
        accessibilityHint="Opens the currency list"
      />
      <CurrencyPicker
        visible={pickerOpen}
        value={business.currency_code ?? suggested}
        onClose={() => setPickerOpen(false)}
        onSelect={(code) => {
          setPickerOpen(false);
          if (code === business.currency_code) return;
          setBanner(null);
          setCurrency.mutate(code, { onError: (error) => setBanner(menuErrorMessage(error.code)) });
        }}
      />

      {count === 0 && sections.menu.length === 0 ? (
        <EmptyState message="No menu items yet. Add your first item, or upload menu photos instead." />
      ) : null}

      {count > 0 ? (
        <View style={{ gap: space.sm }}>
          <Text variant="title" accessibilityRole="header">
            Items ({count})
          </Text>
          {items.map((item, index) => {
            const photo = slotPhoto(sections.byItem.get(item.id), urls.urlFor);
            return (
              <MenuItemRow
                key={item.id}
                item={item}
                index={index + 1}
                count={count}
                currency={
                  currency ? { code: currency.code, minorUnits: currency.minor_units } : null
                }
                locale={locale}
                photo={photo ? { path: photo.path, uri: urls.urlFor(photo.path) } : undefined}
                onExpired={onExpired}
                onEdit={onEdit}
                onMove={onMove}
                onToggleAvailable={onToggleAvailable}
              />
            );
          })}
        </View>
      ) : null}

      <View style={{ gap: space.xs }}>
        <Button
          title="Add item"
          onPress={() => router.push('/seller/menu/new')}
          disabled={full}
          accessibilityHint={full ? ITEM_LIMIT_REASON : undefined}
        />
        {full ? (
          <Text variant="caption" color="textMuted">
            {ITEM_LIMIT_REASON}
          </Text>
        ) : null}
      </View>
      <NavRow
        label={`Menu photos (${sections.menu.length}/${MENU_PHOTO_LIMIT})`}
        onPress={() => router.push({ pathname: '/seller/photos', params: { section: 'menu' } })}
        accessibilityHint="Opens the photos screen at Menu photos"
      />
    </View>
  );
}
