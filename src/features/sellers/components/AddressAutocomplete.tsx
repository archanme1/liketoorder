import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Banner, Button, Text, TextField } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { usePlaceAutocomplete } from '../hooks/usePlaceAutocomplete';
import { useResolvePlace } from '../hooks/useResolvePlace';
import { ADDRESS_PRIVACY_NOTE, sellerErrorMessage } from '../messages';
import {
  PLACES_INPUT_MAX,
  type BusinessType,
  type MyBusiness,
  type PlaceSuggestion,
} from '../schema';

type AddressAutocompleteProps = {
  businessType: BusinessType;
  onResolved: (business: MyBusiness) => void;
};

// Picking a suggestion sends only its place ID; the server resolves the coordinates and, for
// homemade, the approximate map point. Nothing here logs or stores the typed address.
export function AddressAutocomplete({ businessType, onResolved }: AddressAutocompleteProps) {
  const { colors, space } = useTheme();
  const [text, setText] = useState('');
  const places = usePlaceAutocomplete(text);
  const resolve = useResolvePlace();

  const pick = (suggestion: PlaceSuggestion) => {
    if (resolve.isPending) return;
    resolve.mutate(
      { placeId: suggestion.placeId, sessionToken: places.sessionToken },
      {
        onSuccess: (business) => {
          places.renewSession();
          onResolved(business);
        },
        // The details call ends the billed session whether or not the save succeeds, so the
        // next search always starts a new one. Keep the list so the user can pick another.
        onError: () => places.renewSession({ keepSearch: true }),
      },
    );
  };

  let results = null;
  if (places.error) {
    results =
      places.error.code === 'rate_limited' ? (
        <Banner message={sellerErrorMessage('rate_limited')} />
      ) : (
        <View style={{ gap: space.sm }}>
          <Banner message={sellerErrorMessage(places.error.code)} />
          <Button title="Try again" variant="secondary" onPress={places.retry} />
        </View>
      );
  } else if (places.isSearching || places.isDebouncing) {
    results = (
      <View accessible accessibilityLabel="Searching addresses" style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  } else if (places.suggestions && places.suggestions.length === 0) {
    results = (
      <Text color="textMuted" accessibilityLiveRegion="polite">
        No matching addresses
      </Text>
    );
  } else if (places.suggestions) {
    results = (
      <View style={{ gap: space.xs }}>
        {places.suggestions.map((suggestion) => (
          <SuggestionRow
            key={suggestion.placeId}
            suggestion={suggestion}
            disabled={resolve.isPending}
            onPress={() => pick(suggestion)}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={{ gap: space.md }}>
      {businessType === 'homemade' ? <Banner tone="info" message={ADDRESS_PRIVACY_NOTE} /> : null}
      <TextField
        label="Address"
        value={text}
        onChangeText={setText}
        placeholder="Start typing your address"
        hint="Type at least 3 characters, then pick your address from the list."
        maxLength={PLACES_INPUT_MAX}
        autoCorrect={false}
        autoComplete="street-address"
        textContentType="fullStreetAddress"
        editable={!resolve.isPending}
      />
      {resolve.error ? <Banner message={sellerErrorMessage(resolve.error.code)} /> : null}
      {resolve.isPending ? (
        <View accessible accessibilityLabel="Saving address" style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        results
      )}
      {places.suggestions !== undefined || places.searchable ? (
        <Text variant="caption" color="textMuted">
          Powered by Google
        </Text>
      ) : null}
    </View>
  );
}

type SuggestionRowProps = {
  suggestion: PlaceSuggestion;
  disabled: boolean;
  onPress: () => void;
};

function SuggestionRow({ suggestion, disabled, onPress }: SuggestionRowProps) {
  const { colors, space, radius, size, weight, opacity } = useTheme();
  const label = [suggestion.primaryText, suggestion.secondaryText].filter(Boolean).join(', ');
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Saves this as your address"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: size.touch,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderRadius: radius.md,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          opacity: disabled ? opacity.disabled : pressed ? opacity.pressed : 1,
        },
      ]}
    >
      <Text style={{ fontWeight: weight.semibold }}>{suggestion.primaryText}</Text>
      {suggestion.secondaryText ? (
        <Text variant="caption" color="textMuted">
          {suggestion.secondaryText}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center' },
  row: { justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
});
