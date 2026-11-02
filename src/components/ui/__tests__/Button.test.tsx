import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Button } from '@/components/ui';
import { colors, size } from '@/theme/tokens';

describe('Button', () => {
  it('renders its title', async () => {
    await render(<Button title="Order now" onPress={jest.fn()} />);
    expect(screen.getByText('Order now')).toBeTruthy();
  });

  it('calls onPress when pressed', async () => {
    const onPress = jest.fn();
    await render(<Button title="Order now" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is busy and blocked while loading', async () => {
    const onPress = jest.fn();
    await render(<Button title="Order now" onPress={onPress} loading />);
    const button = screen.getByRole('button', { name: 'Order now' });
    expect(button).toBeBusy();
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('is disabled and blocked when disabled', async () => {
    const onPress = jest.fn();
    await render(<Button title="Order now" onPress={onPress} disabled />);
    const button = screen.getByRole('button', { name: 'Order now' });
    expect(button).toBeDisabled();
    expect(button).not.toBeBusy();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('exposes accessibilityRole button', async () => {
    await render(<Button title="Order now" onPress={jest.fn()} />);
    expect(screen.getByLabelText('Order now').props.accessibilityRole).toBe('button');
  });

  it('defaults accessibilityLabel to the title', async () => {
    await render(<Button title="Order now" onPress={jest.fn()} />);
    expect(screen.getByRole('button').props.accessibilityLabel).toBe('Order now');
  });

  it('allows overriding accessibilityLabel', async () => {
    await render(<Button title="Go" accessibilityLabel="Place your order" onPress={jest.fn()} />);
    expect(screen.getByRole('button').props.accessibilityLabel).toBe('Place your order');
    expect(screen.queryByLabelText('Go')).toBeNull();
  });

  it('has a touch target of at least 44pt', async () => {
    expect(size.touch).toBeGreaterThanOrEqual(44);
    await render(<Button title="Order now" onPress={jest.fn()} />);
    const style = StyleSheet.flatten(screen.getByRole('button').props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  });

  it.each([
    ['primary', colors.primary],
    ['secondary', colors.surface],
    ['ghost', 'transparent'],
  ] as const)('renders the %s variant with its background', async (variant, background) => {
    await render(<Button title="Variant" variant={variant} onPress={jest.fn()} />);
    expect(screen.getByText('Variant')).toBeTruthy();
    const style = StyleSheet.flatten(screen.getByRole('button').props.style);
    expect(style.backgroundColor).toBe(background);
  });
});
