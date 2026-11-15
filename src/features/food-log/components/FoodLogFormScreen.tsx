import { zodResolver } from '@hookform/resolvers/zod';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Banner, Button, ErrorState, Skeleton, Text, TextField } from '@/components/ui';
import { CuisineField } from '@/features/cuisines/components/CuisineField';
import { AddPhotoButton } from '@/features/media/components/AddPhotoButton';
import { PhotoTile } from '@/features/media/components/PhotoTile';
import { useSignedUrls } from '@/features/media/hooks/useSignedUrls';
import { pickImage } from '@/features/media/pickImage';
import { LabelledSwitch } from '@/features/sellers/components/LabelledSwitch';
import { useTheme } from '@/theme/useTheme';

import { FoodLogAppError } from '../api';
import { useFoodLog } from '../hooks/useFoodLog';
import { useCreateFoodLog, useUpdateFoodLog } from '../hooks/useFoodLogMutations';
import {
  CUISINE_REQUIRED_REASON,
  DESCRIPTION_HINT,
  foodLogErrorMessage,
  foodLogFlowMessage,
  PHOTO_REQUIRED_REASON,
  PUBLIC_OFF,
  PUBLIC_ON,
} from '../messages';
import { descriptionMessage, foodLogFormSchema, type FoodLog, type FoodLogForm } from '../schema';
import { charCount, checkDescription, MAX_DESCRIPTION_CHARS, normalizeDescription } from '../text';
import { FOOD_LOG_BUCKET } from '../uploadFoodLog';

import { FoodLogFrame } from './FoodLogFrame';
import { FoodLogNotFound } from './FoodLogNotFound';

export type FoodLogFormScreenProps = { mode: 'create' } | { mode: 'edit'; id: string };

/** Add photo (create) or Edit photo (edit: the photo itself can't change, Decision 8). */
export function FoodLogFormScreen(props: FoodLogFormScreenProps) {
  if (props.mode === 'edit') return <EditFoodLog id={props.id} />;
  return <FoodLogFormBody log={null} />;
}

function EditFoodLog({ id }: { id: string }) {
  const router = useRouter();
  const { space, size } = useTheme();
  const query = useFoodLog(id);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/food-log'));

  if (query.isPending) {
    return (
      <FoodLogFrame>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Loading photo"
          style={{ gap: space.md }}
        >
          <Skeleton height={size.photoLarge} rounded="md" />
          <Skeleton height={size.touch} rounded="md" />
          <Skeleton height={size.touch} rounded="md" />
        </View>
      </FoodLogFrame>
    );
  }
  if (query.isError) {
    return (
      <FoodLogFrame>
        {query.error.code === 'not_found' ? (
          <FoodLogNotFound onBack={back} />
        ) : (
          <ErrorState
            message={foodLogErrorMessage(query.error.code)}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        )}
      </FoodLogFrame>
    );
  }
  return <FoodLogFormBody log={query.data} />;
}

function FoodLogFormBody({ log }: { log: (FoodLog & { path: string }) | null }) {
  const router = useRouter();
  const { colors, space, radius } = useTheme();
  const { width } = useWindowDimensions();
  const photoSize = Math.max(width - space.lg * 2, 0);
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const saving = useRef(false);
  const create = useCreateFoodLog();
  const update = useUpdateFoodLog(log?.id ?? '');
  const { urlFor, renew } = useSignedUrls(FOOD_LOG_BUCKET, log ? [log.path] : []);

  const { control, handleSubmit, setError } = useForm<FoodLogForm>({
    resolver: zodResolver(foodLogFormSchema),
    defaultValues: {
      cuisine_code: log?.cuisine_code ?? '',
      description: log?.description ?? '',
      is_public: log?.is_public ?? true,
    },
  });
  const cuisineCode = useWatch({ control, name: 'cuisine_code' });
  const description = useWatch({ control, name: 'description' });

  const reason =
    log === null && pickedUri === null
      ? PHOTO_REQUIRED_REASON
      : cuisineCode === ''
        ? CUISINE_REQUIRED_REASON
        : undefined;
  const pending = create.isPending || update.isPending;

  function close() {
    if (log) {
      router.back();
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/food-log');
    }
  }

  async function submit(values: FoodLogForm) {
    const check = checkDescription(values.description);
    if (!check.ok) {
      setError('description', { message: descriptionMessage(check.code) });
      return;
    }
    const fields = {
      cuisineCode: values.cuisine_code,
      description: check.value,
      isPublic: values.is_public,
    };
    setBanner(null);
    try {
      if (log) {
        await update.mutateAsync(fields);
      } else if (pickedUri) {
        await create.mutateAsync({ sourceUri: pickedUri, ...fields });
      } else {
        return;
      }
      close();
    } catch (error) {
      if (
        error instanceof FoodLogAppError &&
        (error.code === 'invalid_text' || error.code === 'contact_info')
      ) {
        setError('description', { message: descriptionMessage(error.code) });
      } else {
        setBanner(foodLogFlowMessage(error));
      }
    }
  }

  // One save at a time: the ref turns a second tap away before the first one's state renders.
  function save() {
    if (saving.current || reason !== undefined) return;
    saving.current = true;
    void handleSubmit(submit)().finally(() => {
      saving.current = false;
    });
  }

  async function choosePhoto() {
    setBanner(null);
    try {
      const uri = await pickImage();
      if (uri) setPickedUri(uri);
    } catch (error) {
      setBanner(foodLogFlowMessage(error));
    }
  }

  const count = charCount(description);

  return (
    <FoodLogFrame
      top={
        <>
          <Button
            title="Save"
            onPress={save}
            loading={pending}
            disabled={reason !== undefined}
            accessibilityHint={reason}
          />
          {reason ? (
            <Text color="textMuted" accessibilityElementsHidden importantForAccessibility="no">
              {reason}
            </Text>
          ) : null}
        </>
      }
    >
      {banner ? <Banner message={banner} /> : null}
      {log ? (
        <View style={{ gap: space.xs }}>
          <PhotoTile
            path={log.path}
            uri={urlFor(log.path)}
            accessibilityLabel="Food photo"
            onExpired={(path) => void renew(path)}
            size={photoSize}
            width="100%"
          />
          <Text color="textMuted">The photo can&apos;t be changed.</Text>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          {pickedUri ? (
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel="Chosen photo"
              style={[
                styles.preview,
                { borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
              ]}
            >
              <Image
                source={{ uri: pickedUri }}
                contentFit="cover"
                style={StyleSheet.absoluteFill}
                accessible={false}
              />
            </View>
          ) : null}
          <AddPhotoButton
            label={pickedUri ? 'Change photo' : 'Choose photo'}
            onPress={() => void choosePhoto()}
            disabledReason={pending ? 'Saving the photo.' : undefined}
          />
        </View>
      )}
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
      <Controller
        control={control}
        name="description"
        render={({ field, fieldState }) => (
          <View style={{ gap: space.xs }}>
            <TextField
              label="Description"
              hint={DESCRIPTION_HINT}
              value={field.value}
              onChangeText={(text) => field.onChange(normalizeDescription(text))}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              multiline
            />
            <Text
              color={count > MAX_DESCRIPTION_CHARS ? 'danger' : 'textMuted'}
              accessibilityLabel={`${count} of ${MAX_DESCRIPTION_CHARS} characters`}
            >
              {`${count}/${MAX_DESCRIPTION_CHARS}`}
            </Text>
          </View>
        )}
      />
      <Controller
        control={control}
        name="is_public"
        render={({ field }) => (
          <LabelledSwitch
            label="Public"
            description={field.value ? PUBLIC_ON : PUBLIC_OFF}
            value={field.value}
            onValueChange={field.onChange}
          />
        )}
      />
    </FoodLogFrame>
  );
}

const styles = StyleSheet.create({
  preview: { width: '100%', aspectRatio: 1, overflow: 'hidden' },
});
