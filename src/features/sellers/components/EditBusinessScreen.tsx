import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';

import { Banner, Button, Text, TextField } from '@/components/ui';
import { CuisineField } from '@/features/cuisines/components/CuisineField';
import { useTheme } from '@/theme/useTheme';

import { useUpdateBusiness } from '../hooks/useUpdateBusiness';
import { TABLE_REQUESTS_DESCRIPTION, TABLE_REQUESTS_LABEL, typeLabel } from '../listing';
import { sellerErrorMessage } from '../messages';
import { BUSINESS_NAME_MAX, editFormSchema, type EditFormValues, type MyBusiness } from '../schema';

import { LabelledSwitch } from './LabelledSwitch';
import { SellerScreenFrame } from './SellerScreenFrame';
import { SellerScreenGate } from './SellerScreenGate';

export function EditBusinessScreen() {
  return (
    <SellerScreenFrame>
      <SellerScreenGate screen="edit">
        {(business) => <EditBusinessForm business={business} />}
      </SellerScreenGate>
    </SellerScreenFrame>
  );
}

function EditBusinessForm({ business }: { business: MyBusiness }) {
  const { space } = useTheme();
  const router = useRouter();
  const update = useUpdateBusiness(business.id);
  const [banner, setBanner] = useState<string | null>(null);
  const { control, handleSubmit } = useForm<EditFormValues>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      name: business.name,
      cuisine_code: business.cuisine_code,
      accepts_table_requests: business.accepts_table_requests,
    },
  });
  // Opened from a deep link there is nothing to go back to, so fall back to Manage.
  const close = () => (router.canGoBack() ? router.back() : router.replace('/manage'));

  const onSubmit = handleSubmit((values) => {
    setBanner(null);
    update.mutate(
      {
        name: values.name,
        cuisine_code: values.cuisine_code,
        accepts_table_requests: business.type === 'restaurant' && values.accepts_table_requests,
      },
      { onSuccess: close, onError: (error) => setBanner(sellerErrorMessage(error.code)) },
    );
  });

  return (
    <View style={{ gap: space.lg }}>
      {banner ? <Banner message={banner} /> : null}
      {/* Type is fixed after creation (spec 05 Decision 11). */}
      <View accessible style={{ gap: space.xs }}>
        <Text color="textMuted">Business type</Text>
        <Text variant="bodyLg">{typeLabel(business.type)}</Text>
        <Text variant="caption" color="textMuted">
          The type can’t be changed.
        </Text>
      </View>
      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <TextField
            label="Business name"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            maxLength={BUSINESS_NAME_MAX}
          />
        )}
      />
      <Controller
        control={control}
        name="cuisine_code"
        render={({ field, fieldState }) => (
          <CuisineField
            value={field.value || null}
            onChange={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      {business.type === 'restaurant' ? (
        <Controller
          control={control}
          name="accepts_table_requests"
          render={({ field }) => (
            <LabelledSwitch
              label={TABLE_REQUESTS_LABEL}
              description={TABLE_REQUESTS_DESCRIPTION}
              value={field.value}
              onValueChange={field.onChange}
            />
          )}
        />
      ) : null}
      <Button title="Save" onPress={onSubmit} loading={update.isPending} />
      <Button
        title="Cancel"
        variant="secondary"
        accessibilityHint="Discards your changes"
        onPress={close}
        disabled={update.isPending}
      />
    </View>
  );
}
