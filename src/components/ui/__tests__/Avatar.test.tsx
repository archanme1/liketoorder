import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Avatar, getInitials } from '@/components/ui';
import { size } from '@/theme/tokens';

describe('getInitials', () => {
  it.each([
    ['Archan Me', null, 'AM'],
    ['archan', null, 'A'],
    ['  Ana  Maria  Lopez ', null, 'AL'],
    ['archan me', undefined, 'AM'],
    ['', 'zed', 'Z'],
    ['   ', 'zed', 'Z'],
    [null, 'zed', 'Z'],
    [undefined, 'zed', 'Z'],
    [null, null, '?'],
    [undefined, undefined, '?'],
    ['', '', '?'],
  ] as const)('getInitials(%j, %j) -> %s', (displayName, username, expected) => {
    expect(getInitials(displayName, username)).toBe(expected);
  });

  it('prefers display name over username', () => {
    expect(getInitials('Archan Me', 'zed')).toBe('AM');
  });
});

describe('Avatar', () => {
  it('renders initials with an image role and a label', async () => {
    await render(<Avatar displayName="Archan Me" username="archan" />);
    expect(screen.getByText('AM')).toBeTruthy();
    const avatar = screen.getByRole('image');
    expect(avatar.props.accessibilityLabel).toBe("Archan Me's profile picture");
  });

  it('renders a single initial for a single word', async () => {
    await render(<Avatar displayName="archan" />);
    expect(screen.getByText('A')).toBeTruthy();
  });

  it('falls back to the username for label and initial', async () => {
    await render(<Avatar displayName={null} username="zed" />);
    expect(screen.getByText('Z')).toBeTruthy();
    expect(screen.getByLabelText("zed's profile picture")).toBeTruthy();
  });

  it('falls back to ? and "User"', async () => {
    await render(<Avatar />);
    expect(screen.getByText('?')).toBeTruthy();
    expect(screen.getByLabelText("User's profile picture")).toBeTruthy();
  });

  it('trims the display name in the label', async () => {
    await render(<Avatar displayName="  Archan Me  " />);
    expect(screen.getByLabelText("Archan Me's profile picture")).toBeTruthy();
  });

  it('is not touchable', async () => {
    await render(<Avatar displayName="Archan Me" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('image').props.onPress).toBeUndefined();
  });

  it.each([
    ['sm', size.avatarSm, 40],
    ['md', size.avatarMd, 64],
    ['lg', size.avatarLg, 96],
  ] as const)('uses the %s diameter from tokens', async (variant, token, px) => {
    expect(token).toBe(px);
    await render(<Avatar displayName="Archan Me" size={variant} />);
    const style = StyleSheet.flatten(screen.getByRole('image').props.style);
    expect(style.width).toBe(token);
    expect(style.height).toBe(token);
  });
});
