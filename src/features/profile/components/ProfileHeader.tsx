import { View } from 'react-native';

import { Avatar, EmptyState, ErrorState, Skeleton, Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import { useMyProfile } from '../hooks/useMyProfile';
import { profileErrorMessage } from '../messages';

// The signed-in user's profile: Avatar, display name, @username, bio, city.
export function ProfileHeader() {
  const { space, size, type } = useTheme();
  const query = useMyProfile();

  if (query.isPending) {
    return (
      <View accessible accessibilityLabel="Loading profile" style={{ gap: space.md }}>
        <Skeleton width={size.avatarLg} height={size.avatarLg} rounded="pill" />
        <Skeleton width="60%" height={type.title} />
        <Skeleton width="40%" height={type.body} />
      </View>
    );
  }

  if (query.isError) {
    return (
      <ErrorState
        message={profileErrorMessage(query.error.code)}
        onRetry={() => void query.refetch()}
        retrying={query.isRefetching}
      />
    );
  }

  const profile = query.data;
  if (!profile) {
    return (
      <EmptyState
        message="We couldn’t find your profile."
        actionLabel="Try again"
        onAction={() => void query.refetch()}
      />
    );
  }

  return (
    <View style={{ gap: space.sm }}>
      <Avatar displayName={profile.display_name} username={profile.username} size="lg" />
      <Text variant="title" accessibilityRole="header">
        {profile.display_name ?? ''}
      </Text>
      {profile.username ? <Text color="textMuted">{`@${profile.username}`}</Text> : null}
      {profile.bio ? <Text>{profile.bio}</Text> : null}
      {profile.city ? <Text color="textMuted">{profile.city}</Text> : null}
    </View>
  );
}
