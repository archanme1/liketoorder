import { zodResolver } from '@hookform/resolvers/zod';
import { Redirect, useRouter } from 'expo-router';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { View } from 'react-native';

import { Banner, Button, ErrorState, Text, TextField } from '@/components/ui';
import { CuisineField } from '@/features/cuisines/components/CuisineField';
import { useIsSeller } from '@/features/navigation/hooks/useIsSeller';
import { useTheme } from '@/theme/useTheme';

import { useCreateBusiness } from '../hooks/useCreateBusiness';
import { useMyBusiness } from '../hooks/useMyBusiness';
import { TABLE_REQUESTS_DESCRIPTION, TABLE_REQUESTS_LABEL } from '../listing';
import { sellerErrorMessage } from '../messages';
import {
  BUSINESS_NAME_MAX,
  onboardingFormSchema,
  type BusinessType,
  type OnboardingFormInput,
  type OnboardingFormValues,
} from '../schema';
import { getSellerRoute } from '../sellerRoutes';

import { AddressAutocomplete } from './AddressAutocomplete';
import { BusinessTypePicker } from './BusinessTypePicker';
import { LabelledSwitch } from './LabelledSwitch';
import { SellerLoading } from './SellerLoading';
import { SellerScreenFrame } from './SellerScreenFrame';

// Two steps: details (creates the business) → address (makes it live).
export function SellerOnboardingScreen() {
  const business = useMyBusiness();
  const isSeller = useIsSeller();
  const create = useCreateBusiness();

  // Once this screen has created the business, stay for step 2: the refetched business would
  // otherwise match the "already has a business" redirect below.
  const creating = create.isPending || create.isSuccess;

  let content;
  if (create.isSuccess) {
    content = <AddressStep businessType={create.variables.type} />;
  } else if (!creating && business.isPending) {
    content = <SellerLoading />;
  } else if (!creating && business.isError && business.data === undefined) {
    content = (
      <ErrorState
        message={sellerErrorMessage(business.error.code)}
        onRetry={() => void business.refetch()}
        retrying={business.isRefetching}
      />
    );
  } else {
    // Decision 14: redirect only after the business has loaded, from inside the screen.
    const redirect = creating
      ? null
      : getSellerRoute(business.data ?? null, isSeller, 'onboarding');
    if (redirect) return <Redirect href={redirect} />;
    content = <DetailsStep create={create} />;
  }

  return <SellerScreenFrame>{content}</SellerScreenFrame>;
}

function StepHeader({ step, title, subtitle }: { step: 1 | 2; title: string; subtitle: string }) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text color="textMuted">{`Step ${step} of 2`}</Text>
      <Text variant="h1" accessibilityRole="header">
        {title}
      </Text>
      <Text color="textMuted">{subtitle}</Text>
    </View>
  );
}

function DetailsStep({ create }: { create: ReturnType<typeof useCreateBusiness> }) {
  const { space } = useTheme();
  const router = useRouter();
  const { control, handleSubmit } = useForm<OnboardingFormInput, unknown, OnboardingFormValues>({
    resolver: zodResolver(onboardingFormSchema),
    defaultValues: { name: '', cuisine_code: '', accepts_table_requests: false },
  });
  const type = useWatch({ control, name: 'type' });

  const onSubmit = handleSubmit((values) => create.mutate(values));

  return (
    <View style={{ gap: space.lg }}>
      <StepHeader
        step={1}
        title="Start selling"
        subtitle="Tell customers what you make. You can change these later."
      />
      {create.error ? (
        <View style={{ gap: space.sm }}>
          <Banner message={sellerErrorMessage(create.error.code)} />
          {create.error.code === 'already_has_business' ? (
            <Button
              title="Go to Manage Business"
              variant="secondary"
              onPress={() => router.replace('/manage')}
            />
          ) : null}
        </View>
      ) : null}
      <Controller
        control={control}
        name="type"
        render={({ field, fieldState }) => (
          <BusinessTypePicker
            value={field.value ?? null}
            onChange={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
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
            autoComplete="organization"
            textContentType="organizationName"
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
      {type === 'restaurant' ? (
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
      <Button title="Continue" onPress={onSubmit} loading={create.isPending} />
    </View>
  );
}

function AddressStep({ businessType }: { businessType: BusinessType }) {
  const { space } = useTheme();
  const router = useRouter();
  return (
    <View style={{ gap: space.lg }}>
      <StepHeader
        step={2}
        title="Your address"
        subtitle="Pick your address from the suggestions. Your listing goes live once it’s saved."
      />
      <AddressAutocomplete
        businessType={businessType}
        onResolved={() => router.replace('/manage')}
      />
    </View>
  );
}
