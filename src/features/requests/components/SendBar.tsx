import { StyleSheet, View } from 'react-native';

import { Banner, Button, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { NO_PRICE_NOTE } from '../messages';

type SendBarProps = {
  /** The seller's name, for the spoken label of the button. */
  businessName: string;
  /** The formatted estimated total, or null (the default) when there is none to show. */
  total?: string | null;
  /** The total leaves out items that have no price. */
  excludesUnpriced?: boolean;
  /** What is being sent; it is spoken in the button's label. A pickup unless told otherwise. */
  noun?: 'pickup' | 'table';
  /** The one thing to tell the person right now (a time, an order or a server problem). */
  error: string | null;
  sending: boolean;
  onSend: () => void;
};

// The fixed bar under the title: Send beside the estimated total. It sits OUTSIDE the scrolling
// form, so Send is always on screen, and any problem is shown right under the button. There are no
// fixed heights: at the largest text size the total takes its own line and Send drops below it.
export function SendBar({
  businessName,
  total = null,
  excludesUnpriced = false,
  noun = 'pickup',
  error,
  sending,
  onSend,
}: SendBarProps) {
  const { space, size } = useTheme();
  return (
    <View testID="send-bar" style={{ gap: space.sm, paddingVertical: space.sm }}>
      <View style={[styles.row, { gap: space.md }]}>
        {total ? (
          <View style={[styles.total, { gap: space.xs, minWidth: size.photoThumb }]}>
            <Text>{`Estimated total: ${total}`}</Text>
            {excludesUnpriced ? (
              <Text variant="caption" color="textMuted">
                {NO_PRICE_NOTE}
              </Text>
            ) : null}
          </View>
        ) : null}
        <View style={[styles.send, { minWidth: size.photoThumb }]}>
          <Button
            title="Send request"
            accessibilityLabel={`Send ${noun} request to ${businessName}`}
            onPress={onSend}
            loading={sending}
            disabled={sending}
          />
        </View>
      </View>
      {error ? <Banner message={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  total: { flexGrow: 1, flexShrink: 1 },
  send: { flexGrow: 1 },
});
