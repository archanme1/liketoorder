import { Redirect } from 'expo-router';

// "/" has no screen of its own; the root guard sends blocked users elsewhere first.
export default function Index() {
  return <Redirect href="/restaurants" />;
}
