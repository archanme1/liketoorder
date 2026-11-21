// Spec 16 Offers: where the list looks when the person's location is not used and no recent map
// view is available (Resolved Q14). One constant, so moving the launch city is a one-line change.
//
// PLACEHOLDER: the centre of Oshawa, Ontario (the same point as the local seed's Oshawa area). The
// real launch city is still to be decided (docs/product/v1.md section 15 Q5 and section 16).
export const LAUNCH_AREA = {
  name: 'Oshawa',
  latitude: 43.8971,
  longitude: -78.8658,
} as const;
