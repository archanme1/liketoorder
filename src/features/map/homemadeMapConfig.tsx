import type { BusinessMapConfig } from './businessMapConfig';
import { HomemadeMarker } from './components/HomemadeMarker';
import { HomemadeSheetDetails } from './components/HomemadeSheetDetails';
import { HomemadeSheetActions } from './components/SheetActions';
import { HOMEMADE_THINGS } from './homemadeText';
import { useHomemadeInBounds } from './hooks/useHomemadeInBounds';
import { HOMEMADE_REGION_KEY } from './lastRegion';

// The Homemade tab: the shared map screen with homemade data, flag-in-a-circle markers and the
// homemade sheet body.
export const homemadeMapConfig: BusinessMapConfig = {
  mapLabel: 'Homemade map',
  regionKey: HOMEMADE_REGION_KEY,
  promptThings: 'restaurants and homemade cooks',
  texts: {
    things: HOMEMADE_THINGS,
    zoomIn: 'Zoom in to see homemade cooks',
    emptyTitle: 'No homemade cooks here yet',
    listHint: 'Opens a list of the homemade cooks on the map',
    listEmpty: 'No homemade cooks shown here. Zoom in or move the map.',
    placesTitle: 'Homemade cooks in this area',
    detailsLabel: 'Homemade cook details',
  },
  usePins: useHomemadeInBounds,
  renderMarker: (props) => <HomemadeMarker {...props} />,
  DetailsBody: HomemadeSheetDetails,
  Actions: HomemadeSheetActions,
};
