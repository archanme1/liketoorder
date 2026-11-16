import type { ReactElement, ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type RefreshControlProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/useTheme';

type FoodLogFrameProps = {
  /** Primary actions, kept on screen in the fixed part above the content. */
  top?: ReactNode;
  children: ReactNode;
  /** False when the content scrolls itself (the list's FlatList). */
  scroll?: boolean;
  /** Pull to refresh on the scrolling content (Your year, spec 14). */
  refreshControl?: ReactElement<RefreshControlProps>;
};

// The /food-log/* screens. The food log Stack's header covers the top inset and the title, so
// only the bottom inset is applied here.
export function FoodLogFrame({ top, children, scroll = true, refreshControl }: FoodLogFrameProps) {
  const { colors, space } = useTheme();
  return (
    <SafeAreaView edges={['bottom']} style={[styles.flex, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {top ? (
          <View style={{ gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.lg }}>
            {top}
          </View>
        ) : null}
        {scroll ? (
          <ScrollView
            testID="food-log-scroll"
            keyboardShouldPersistTaps="handled"
            refreshControl={refreshControl}
            contentContainerStyle={{ gap: space.lg, padding: space.lg, paddingBottom: space.xxl }}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.flex, { paddingHorizontal: space.lg }]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
