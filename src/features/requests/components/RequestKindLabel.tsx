import { Text } from '@/components/ui';

import { kindLabel, type RequestKind } from '../kind';

/** A small word on a list row: "Pickup" (spec 11 adds "Table"). Hidden from the screen reader because the row speaks it as its accessibility value. */
export function RequestKindLabel({ kind }: { kind: RequestKind }) {
  return (
    <Text
      variant="caption"
      color="textMuted"
      accessibilityElementsHidden
      importantForAccessibility="no"
      maxFontSizeMultiplier={1.6}
    >
      {kindLabel(kind)}
    </Text>
  );
}
