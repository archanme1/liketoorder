import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/ui';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { useTheme } from '@/theme/useTheme';

import { DEFAULT_OFFER_FILTERS, type OfferFilters as Filters } from '../schema';

import { OfferFilters } from './OfferFilters';

export const FILTERS_TITLE = 'Filters';
export const CLOSE_FILTERS_LABEL = 'Close filters';
export const CLEAR_ALL_LABEL = 'Clear all';
export const SHOW_OFFERS_LABEL = 'Show offers';

type FiltersPanelProps = {
  /** The filters the list uses now: the panel's draft starts from them. */
  applied: Filters;
  /** "Show offers": the draft becomes the list's filters. */
  onApply: (next: Filters) => void;
  /** Close without applying (x, the back gesture, a tap outside): the draft is thrown away. */
  onClose: () => void;
};

// Spec 16 Offers: the one Filters panel (a bottom panel like Change area). It is mounted only while
// open, so every opening starts a fresh draft from the applied filters. Chips change the draft
// only; nothing is asked of the server until "Show offers". With Reduce Motion it appears without
// sliding.
export function FiltersPanel({ applied, onApply, onClose }: FiltersPanelProps) {
  const { colors, space, radius, size, scrim, opacity } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [draft, setDraft] = useState<Filters>(applied);

  return (
    <Modal
      visible
      transparent
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, { backgroundColor: scrim }]}>
        {/* A tap above the panel closes it, like the x. Not a separate stop for screen readers. */}
        <Pressable
          testID="filters-backdrop"
          style={styles.flex}
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
        />
        <View
          accessibilityViewIsModal
          testID="filters-panel"
          style={[
            styles.panel,
            {
              paddingTop: space.lg,
              paddingBottom: space.lg + insets.bottom,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              backgroundColor: colors.bg,
            },
          ]}
        >
          <View style={[styles.header, { paddingHorizontal: space.lg }]}>
            <Text variant="title" accessibilityRole="header" style={styles.flex}>
              {FILTERS_TITLE}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={CLOSE_FILTERS_LABEL}
              style={({ pressed }) => [
                styles.close,
                { width: size.touch, height: size.touch, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <Ionicons name="close" size={size.tabIcon} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={{ padding: space.lg }}
            keyboardShouldPersistTaps="handled"
          >
            <OfferFilters value={draft} onChange={setDraft} />
          </ScrollView>
          <View style={[styles.actions, { gap: space.sm, paddingHorizontal: space.lg }]}>
            <View style={styles.flex}>
              <Button
                title={CLEAR_ALL_LABEL}
                variant="secondary"
                onPress={() => setDraft(DEFAULT_OFFER_FILTERS)}
                accessibilityHint="Sets every filter back to its default. Nothing changes until Show offers."
              />
            </View>
            <View style={styles.flex}>
              <Button title={SHOW_OFFERS_LABEL} onPress={() => onApply(draft)} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  panel: { maxHeight: '90%' },
  header: { flexDirection: 'row', alignItems: 'center' },
  close: { alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
});
