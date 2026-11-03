import { EmptyState, Screen, Text } from '@/components/ui';

type ComingSoonProps = {
  title: string;
  message: string;
};

// Placeholder tab until its feature spec ships. No data, so only the success state.
export function ComingSoon({ title, message }: ComingSoonProps) {
  return (
    <Screen>
      <Text variant="h1" accessibilityRole="header">
        {title}
      </Text>
      <EmptyState message={message} />
    </Screen>
  );
}
