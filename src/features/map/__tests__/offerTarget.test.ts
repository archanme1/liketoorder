import { offerTargetParams, parseOfferTarget } from '../offerTarget';

const ID = '00000000-0000-4000-8000-000000001701';

describe('parseOfferTarget', () => {
  it('reads the business id and its public point', () => {
    expect(parseOfferTarget({ business: ID, lat: '43.8971', lng: '-78.8658' })).toEqual({
      business: ID,
      lat: 43.8971,
      lng: -78.8658,
    });
  });

  it('round-trips through the params an Offers card sends', () => {
    const target = { business: ID, lat: 43.90137, lng: -78.86229 };
    expect(parseOfferTarget(offerTargetParams(target))).toEqual(target);
    const tiny = { business: ID, lat: 1e-7, lng: -1e-7 };
    expect(parseOfferTarget(offerTargetParams(tiny))).toEqual(tiny);
  });

  it.each([
    ['no params', {}],
    ['no business', { lat: '43.9', lng: '-78.85' }],
    ['no point', { business: ID }],
    ['a business id that is not a uuid', { business: 'b1', lat: '43.9', lng: '-78.85' }],
    ['a latitude out of range', { business: ID, lat: '91', lng: '0' }],
    ['a longitude out of range', { business: ID, lat: '0', lng: '-180.5' }],
    ['a number that is not a number', { business: ID, lat: 'NaN', lng: '0' }],
    ['an empty number', { business: ID, lat: '', lng: '0' }],
    ['a number with junk', { business: ID, lat: '43.9abc', lng: '0' }],
    ['a repeated param', { business: [ID, ID], lat: '43.9', lng: '-78.85' }],
  ])('ignores %s', (_, params) => {
    expect(parseOfferTarget(params)).toBeNull();
  });
});
