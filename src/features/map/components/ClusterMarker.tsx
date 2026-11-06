import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';

import type { ClusterItem } from '../clustering';

import { useTracksViewChanges } from '../hooks/useTracksViewChanges';

type ClusterMarkerProps = {
  cluster: ClusterItem;
  onPress: (clusterId: number) => void;
};

export function clusterLabel(count: number): string {
  return `${count} places, double tap to zoom in`;
}

// 36 to 48 by count; a bigger group gets a bigger circle.
export function clusterDiameter(
  count: number,
  sizes: { clusterSm: number; clusterMd: number; clusterLg: number },
): number {
  if (count < 10) return sizes.clusterSm;
  if (count < 100) return sizes.clusterMd;
  return sizes.clusterLg;
}

function ClusterMarkerBase({ cluster, onPress }: ClusterMarkerProps) {
  const { colors, size, radius, weight } = useTheme();
  const diameter = clusterDiameter(cluster.count, size);
  const { count } = cluster;
  const tracksViewChanges = useTracksViewChanges(String(count));

  return (
    <Marker
      coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
      onPress={() => onPress(cluster.clusterId)}
      tracksViewChanges={tracksViewChanges}
      accessible
      accessibilityRole="button"
      accessibilityLabel={clusterLabel(count)}
    >
      <View
        testID="cluster-hit"
        style={[
          styles.hit,
          { width: Math.max(size.touch, diameter), height: Math.max(size.touch, diameter) },
        ]}
      >
        <View
          testID="cluster-circle"
          style={[
            styles.circle,
            {
              width: diameter,
              height: diameter,
              borderRadius: radius.pill,
              backgroundColor: colors.primary,
              borderColor: colors.surface,
            },
          ]}
        >
          <Text color="primaryText" style={{ fontWeight: weight.bold }}>
            {count}
          </Text>
        </View>
      </View>
    </Marker>
  );
}

export const ClusterMarker = memo(ClusterMarkerBase);

const styles = StyleSheet.create({
  hit: { alignItems: 'center', justifyContent: 'center' },
  circle: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
});
