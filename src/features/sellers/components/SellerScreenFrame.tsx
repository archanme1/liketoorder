import type { ReactElement, ReactNode, RefObject } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  type RefreshControlProps,
  type ScrollViewInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/useTheme';

type SellerScreenFrameProps = {
  children: ReactNode;
  /** For screens that scroll to a section (e.g. Photos → Menu photos). */
  scrollRef?: RefObject<ScrollViewInstance | null>;
  /** Pull to refresh, for screens whose state can change elsewhere (e.g. Promote). */
  refreshControl?: ReactElement<RefreshControlProps>;
};

// Scrollable, keyboard-aware body for the /seller/* screens. The seller Stack's header covers the
// top inset and the title, so only the bottom inset is applied here.
export function SellerScreenFrame({ children, scrollRef, refreshControl }: SellerScreenFrameProps) {
  const { colors, space } = useTheme();
  return (
    <SafeAreaView edges={['bottom']} style={[styles.flex, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: space.lg, padding: space.lg, paddingBottom: space.xxl }}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
