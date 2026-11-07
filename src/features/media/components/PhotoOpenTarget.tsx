import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

type PhotoOpenTargetProps = {
  children: ReactNode;
  /** Spoken name, e.g. "Nonna Rosa's Table, photo 1 of 4. Opens photo viewer." */
  accessibilityLabel: string;
  onPress: () => void;
};

// Makes a photo tile open the viewer without changing the tile itself: the tile keeps its own
// "photo n of m" image label, and a transparent button the size of the tile sits on top of it.
export function PhotoOpenTarget({ children, accessibilityLabel, onPress }: PhotoOpenTargetProps) {
  return (
    <View>
      {children}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
