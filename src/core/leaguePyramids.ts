import { LeagueId } from '../models/types';
import { DEFAULT_COUNTRY_ID, LEAGUE_ORDER, LEAGUE_DEFINITIONS } from './domainRegistry';

export interface LeagueCountryPyramid {
  id: string;
  label: string;
  reelHint: string;
  divisions: LeagueId[];
}

export const LEAGUE_COUNTRIES: LeagueCountryPyramid[] = [
  {
    id: DEFAULT_COUNTRY_ID,
    label: 'England',
    reelHint: 'Swipe left for countries, then scroll down through the pyramid',
    divisions: LEAGUE_ORDER.filter(leagueId => LEAGUE_DEFINITIONS[leagueId]?.countryId === DEFAULT_COUNTRY_ID),
  },
];

export { DEFAULT_COUNTRY_ID };

export const getLeagueCountry = (countryId?: string) => (
  LEAGUE_COUNTRIES.find(country => country.id === (countryId || DEFAULT_COUNTRY_ID)) || LEAGUE_COUNTRIES[0]
);

export const getLeagueCountryIndex = (countryId?: string) => (
  Math.max(0, LEAGUE_COUNTRIES.findIndex(country => country.id === (countryId || DEFAULT_COUNTRY_ID)))
);
