import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Alert, View } from 'react-native';

import { Banner, Button, EmptyState, ErrorState, NavRow, Text, TextField } from '@/components/ui';
import { PhotoTile } from '@/features/media/components/PhotoTile';
import { useSignedUrls } from '@/features/media/hooks/useSignedUrls';
import { pickImage } from '@/features/media/pickImage';
import { LabelledSwitch } from '@/features/sellers/components/LabelledSwitch';
import { SellerLoading } from '@/features/sellers/components/SellerLoading';
import { SellerScreenFrame } from '@/features/sellers/components/SellerScreenFrame';
import { SellerScreenGate } from '@/features/sellers/components/SellerScreenGate';
import type { MyBusiness } from '@/features/sellers/schema';
import { useTheme } from '@/theme/useTheme';

import { useCurrencies, useSuggestedCurrency } from '../hooks/useCurrencies';
import {
  useCreateMenuItem,
  useDeleteMenuItem,
  useSetMenuCurrency,
  useUpdateMenuItem,
} from '../hooks/useMenuItemMutations';
import { useMyMenu } from '../hooks/useMyMenu';
import { useDeleteBusinessPhoto, useUploadBusinessPhoto } from '../hooks/usePhotoMutations';
import { ITEM_LIMIT_REASON, menuErrorMessage, photoErrorMessage } from '../messages';
import { groupPhotos, MEDIA_BUCKET, photoNames, slotPhoto } from '../photos';
import { formatPriceInput } from '../price';
import {
  ITEM_DESCRIPTION_MAX,
  ITEM_LIMIT,
  ITEM_NAME_MAX,
  itemFormSchema,
  type Currency,
  type ItemFormInput,
  type ItemFormValues,
  type Menu,
  type MenuItem,
} from '../schema';

import { currencyLabel, CurrencyPicker } from './CurrencyPicker';
import { PriceField } from './PriceField';

const PHOTO_SAVE_FAILED =
  'The item was saved, but its photo didn’t upload. Add the photo again below.';

type MenuItemFormScreenProps = { mode: 'new' | 'edit' };

export function MenuItemFormScreen({ mode }: MenuItemFormScreenProps) {
  return (
    <SellerScreenFrame>
      <SellerScreenGate screen="menu-item">
        {(business) => <ItemFormBody business={business} mode={mode} />}
      </SellerScreenGate>
    </SellerScreenFrame>
  );
}

function ItemFormBody({ business, mode }: { business: MyBusiness; mode: 'new' | 'edit' }) {
  const router = useRouter();
  const { itemId } = useLocalSearchParams<{ itemId?: string }>();
  const menu = useMyMenu(business.id);
  const currencies = useCurrencies();
  // Opened from a deep link there is nothing to go back to, so fall back to the menu.
  const close = () => (router.canGoBack() ? router.back() : router.replace('/seller/menu'));

  if (menu.isPending || currencies.isPending) return <SellerLoading label="Loading your menu" />;
  if (menu.isError && menu.data === undefined) {
    return (
      <ErrorState
        message={menuErrorMessage(menu.error.code)}
        onRetry={() => void menu.refetch()}
        retrying={menu.isRefetching}
      />
    );
  }
  if (currencies.isError && currencies.data === undefined) {
    return (
      <ErrorState
        message={menuErrorMessage(currencies.error.code)}
        onRetry={() => void currencies.refetch()}
        retrying={currencies.isRefetching}
      />
    );
  }

  const item = mode === 'edit' ? menu.data.items.find((row) => row.id === itemId) : undefined;
  if (mode === 'edit' && !item) {
    return <EmptyState message="This item no longer exists" actionLabel="Back" onAction={close} />;
  }
  return (
    <ItemForm
      // A new form per item, so its defaults always match the item being edited.
      key={item?.id ?? 'new'}
      business={business}
      menu={menu.data}
      currencies={currencies.data}
      item={item}
      onDone={close}
    />
  );
}

type ItemFormProps = {
  business: MyBusiness;
  menu: Menu;
  currencies: Currency[];
  item: MenuItem | undefined;
  onDone: () => void;
};

function ItemForm({ business, menu, currencies, item, onDone }: ItemFormProps) {
  const { space, weight } = useTheme();
  const router = useRouter();
  const { photoError } = useLocalSearchParams<{ photoError?: string }>();
  const suggested = useSuggestedCurrency(currencies);
  const setCurrency = useSetMenuCurrency();
  const create = useCreateMenuItem(business.id);
  const update = useUpdateMenuItem(business.id);
  const deleteItem = useDeleteMenuItem(business.id);
  const upload = useUploadBusinessPhoto(business.id);
  const deletePhoto = useDeleteBusinessPhoto(business.id);
  const [banner, setBanner] = useState<string | null>(photoError ? PHOTO_SAVE_FAILED : null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // New items: the photo is chosen now and uploaded once the item exists.
  const [pendingPhotoUri, setPendingPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const minorUnitsFor = useMemo(() => {
    const byCode = new Map(currencies.map((c) => [c.code, c.minor_units]));
    return (code: string | null) => (code ? (byCode.get(code) ?? null) : null);
  }, [currencies]);
  const businessCurrency = business.currency_code;

  const { control, handleSubmit } = useForm<ItemFormInput, unknown, ItemFormValues>({
    resolver: zodResolver(itemFormSchema(minorUnitsFor)),
    defaultValues: {
      name: item?.name ?? '',
      description: item?.description ?? '',
      price:
        item && businessCurrency
          ? formatPriceInput(item.price_minor, minorUnitsFor(businessCurrency) ?? 0)
          : '',
      currency_code: businessCurrency ?? suggested,
      is_available: item?.is_available ?? true,
    },
  });
  const price = useWatch({ control, name: 'price' });
  const chosenCurrency = useWatch({ control, name: 'currency_code' });
  // Decision 12: with no menu currency yet, typing a price asks for one (pre-filled).
  const needsCurrency = !businessCurrency && price.trim() !== '';
  const fieldCurrency = businessCurrency ?? (needsCurrency ? chosenCurrency : null);

  const isNew = item === undefined;
  const full = isNew && menu.items.length >= ITEM_LIMIT;

  const sections = useMemo(() => groupPhotos(menu.photos), [menu.photos]);
  const itemPhotos = item ? sections.byItem.get(item.id) : undefined;
  const urls = useSignedUrls(MEDIA_BUCKET, itemPhotos?.map((photo) => photo.path) ?? []);
  const photo = slotPhoto(itemPhotos, urls.urlFor);

  const onSubmit = handleSubmit(async (values) => {
    setBanner(null);
    setSaving(true);
    try {
      // Saving sets the currency first, then saves the item.
      if (values.price_minor !== null && !businessCurrency && values.currency_code) {
        await setCurrency.mutateAsync(values.currency_code);
      }
      const input = {
        name: values.name,
        description: values.description,
        price_minor: values.price_minor,
        is_available: values.is_available,
      };
      if (item) {
        await update.mutateAsync({ itemId: item.id, input });
        onDone();
        return;
      }
      const id = await create.mutateAsync(input);
      if (pendingPhotoUri) {
        try {
          await upload.mutateAsync({ kind: 'item', menuItemId: id, sourceUri: pendingPhotoUri });
        } catch {
          // Keep the item; reopen it as an edit so the photo can be added again.
          router.replace({
            pathname: '/seller/menu/[itemId]',
            params: { itemId: id, photoError: '1' },
          });
          return;
        }
      }
      onDone();
    } catch (error) {
      setBanner(photoErrorMessage(error));
    } finally {
      setSaving(false);
    }
  });

  const confirmDeleteItem = () => {
    if (!item) return;
    Alert.alert('Delete this item?', `“${item.name}” and its photo will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteItem.mutate(item.id, {
            onSuccess: onDone,
            onError: (error) => setBanner(menuErrorMessage(error.code)),
          }),
      },
    ]);
  };

  const addOrReplacePhoto = async () => {
    setBanner(null);
    if (!item) {
      try {
        const uri = await pickImage();
        if (uri) setPendingPhotoUri(uri);
      } catch (error) {
        setBanner(photoErrorMessage(error));
      }
      return;
    }
    upload.mutate(
      { kind: 'item', menuItemId: item.id },
      { onError: (error) => setBanner(photoErrorMessage(error)) },
    );
  };

  const confirmRemovePhoto = () => {
    if (!item || !photo) {
      setPendingPhotoUri(null);
      return;
    }
    Alert.alert('Remove this photo?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          deletePhoto.mutate(photo.id, { onError: (error) => setBanner(photoErrorMessage(error)) }),
      },
    ]);
  };

  const currentCurrency = currencies.find((c) => c.code === chosenCurrency);
  const hasPhoto = item ? photo !== undefined : pendingPhotoUri !== null;
  const busy = saving || deleteItem.isPending;

  return (
    <View style={{ gap: space.lg }}>
      {banner ? <Banner message={banner} /> : null}
      {full ? <Banner tone="info" message={ITEM_LIMIT_REASON} /> : null}
      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <TextField
            label="Name"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            maxLength={ITEM_NAME_MAX}
          />
        )}
      />
      <Controller
        control={control}
        name="description"
        render={({ field, fieldState }) => (
          <TextField
            label="Description"
            hint="Optional"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            maxLength={ITEM_DESCRIPTION_MAX}
            multiline
          />
        )}
      />
      <Controller
        control={control}
        name="price"
        render={({ field, fieldState }) => (
          <PriceField
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            currencyCode={fieldCurrency}
            minorUnits={minorUnitsFor(fieldCurrency)}
            error={fieldState.error?.message}
          />
        )}
      />
      {needsCurrency ? (
        <Controller
          control={control}
          name="currency_code"
          render={({ field, fieldState }) => (
            <View style={{ gap: space.xs }}>
              <NavRow
                label="Currency"
                value={currentCurrency ? currencyLabel(currentCurrency) : 'Not chosen'}
                onPress={() => setPickerOpen(true)}
                accessibilityHint="Opens the currency list. Used for every price on your menu."
              />
              <Text variant="caption" color="textMuted">
                One currency for your whole menu. It can’t change while items have prices.
              </Text>
              {fieldState.error?.message ? (
                <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
                  {`⚠ ${fieldState.error.message}`}
                </Text>
              ) : null}
              <CurrencyPicker
                visible={pickerOpen}
                value={field.value}
                onClose={() => setPickerOpen(false)}
                onSelect={(code) => {
                  field.onChange(code);
                  setPickerOpen(false);
                }}
              />
            </View>
          )}
        />
      ) : null}
      <Controller
        control={control}
        name="is_available"
        render={({ field }) => (
          <LabelledSwitch
            label="Available"
            description="Turn off to show the item as unavailable without deleting it."
            value={field.value}
            onValueChange={field.onChange}
          />
        )}
      />

      <View style={{ gap: space.sm }}>
        <Text style={{ fontWeight: weight.semibold }}>Photo</Text>
        {item && photo ? (
          <PhotoTile
            path={photo.path}
            uri={urls.urlFor(photo.path)}
            accessibilityLabel={photoNames.item(item.name)}
            onExpired={(path) => void urls.renew(path)}
          />
        ) : null}
        {!item && pendingPhotoUri ? (
          <PhotoTile
            path={pendingPhotoUri}
            uri={pendingPhotoUri}
            accessibilityLabel="Chosen photo, uploads when you save"
            onExpired={() => setPendingPhotoUri(null)}
          />
        ) : null}
        <Button
          title={upload.isPending ? 'Uploading…' : hasPhoto ? 'Replace photo' : 'Add photo'}
          variant="secondary"
          onPress={() => void addOrReplacePhoto()}
          disabled={upload.isPending || busy}
        />
        {hasPhoto ? (
          <Button
            title="Remove photo"
            variant="ghost"
            onPress={confirmRemovePhoto}
            disabled={upload.isPending || deletePhoto.isPending || busy}
          />
        ) : null}
      </View>

      <Button title="Save" onPress={() => void onSubmit()} loading={saving} disabled={full} />
      <Button
        title="Cancel"
        variant="secondary"
        accessibilityHint="Discards your changes"
        onPress={onDone}
        disabled={busy}
      />
      {item ? (
        <Button
          title="Delete item"
          variant="ghost"
          onPress={confirmDeleteItem}
          loading={deleteItem.isPending}
          disabled={saving}
        />
      ) : null}
    </View>
  );
}
