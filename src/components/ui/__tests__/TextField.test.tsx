import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { TextField } from '@/components/ui';

describe('TextField', () => {
  it('renders the label and uses it as the input accessibilityLabel', async () => {
    await render(<TextField label="Email" value="" onChangeText={jest.fn()} />);
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });

  it('shows the hint', async () => {
    await render(<TextField label="Email" hint="We never share it" value="" />);
    expect(screen.getByText('We never share it')).toBeTruthy();
  });

  it('shows the error as text with a warning prefix, not by color alone', async () => {
    await render(<TextField label="Email" error="Enter a valid email" value="" />);
    expect(screen.getByText('⚠ Enter a valid email')).toBeTruthy();
  });

  it('shows no error text when there is no error', async () => {
    await render(<TextField label="Email" value="" />);
    expect(screen.queryByText(/⚠/)).toBeNull();
  });

  it('forwards value, onChangeText and onBlur (react-hook-form contract)', async () => {
    const onChangeText = jest.fn();
    const onBlur = jest.fn();
    await render(<TextField label="Email" value="a" onChangeText={onChangeText} onBlur={onBlur} />);
    const input = screen.getByLabelText('Email');
    expect(input.props.value).toBe('a');
    await fireEvent.changeText(input, 'ab');
    expect(onChangeText).toHaveBeenCalledWith('ab');
    await fireEvent(input, 'blur');
    expect(onBlur).toHaveBeenCalled();
  });

  it('forwards other TextInput props', async () => {
    await render(
      <TextField label="Email" value="" keyboardType="email-address" autoCapitalize="none" />,
    );
    const input = screen.getByLabelText('Email');
    expect(input.props.keyboardType).toBe('email-address');
    expect(input.props.autoCapitalize).toBe('none');
  });

  it('has no show/hide toggle without secureTextEntry', async () => {
    await render(<TextField label="Email" value="" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  describe('secureTextEntry', () => {
    it('renders a labelled toggle that flips the input between hidden and shown', async () => {
      await render(<TextField label="Password" value="secret" secureTextEntry />);
      expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);

      await fireEvent.press(screen.getByRole('button', { name: 'Show password' }));
      expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(false);

      await fireEvent.press(screen.getByRole('button', { name: 'Hide password' }));
      expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
    });

    it('lowercases the label in the toggle name', async () => {
      await render(<TextField label="Confirm password" value="" secureTextEntry />);
      expect(screen.getByRole('button', { name: 'Show confirm password' })).toBeTruthy();
    });

    it('has a toggle touch target of at least 44pt', async () => {
      await render(<TextField label="Password" value="" secureTextEntry />);
      const style = StyleSheet.flatten(screen.getByRole('button').props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
      expect(style.minWidth).toBeGreaterThanOrEqual(44);
    });

    it('exposes accessibilityRole button on the toggle', async () => {
      await render(<TextField label="Password" value="" secureTextEntry />);
      expect(screen.getByLabelText('Show password').props.accessibilityRole).toBe('button');
    });
  });
});
