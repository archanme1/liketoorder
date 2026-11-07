import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { LoadingPinsIndicator } from '../components/MapNotices';

describe('LoadingPinsIndicator', () => {
  it('is a labelled progress indicator with a hairline border (no hardcoded width)', async () => {
    await render(<LoadingPinsIndicator />);
    const node = screen.getByRole('progressbar', { name: 'Loading restaurants' });
    expect(StyleSheet.flatten(node.props.style as never).borderWidth).toBe(
      StyleSheet.hairlineWidth,
    );
  });
});
