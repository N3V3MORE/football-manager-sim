import { Division } from '../models/types';
import { DIVISION_ORDER } from './leagueUtils';

export interface LeagueCountryPyramid {
  id: string;
  label: string;
  reelHint: string;
  divisions: Division[];
}

export const LEAGUE_COUNTRIES: LeagueCountryPyramid[] = [
  {
    id: 'england',
    label: 'England',
    reelHint: 'Swipe left for countries, then scroll down through the pyramid',
    divisions: DIVISION_ORDER,
  },
];

export const DEFAULT_COUNTRY_ID = LEAGUE_COUNTRIES[0]?.id ?? 'england';

export const getLeagueCountry = (countryId?: string) => (
  LEAGUE_COUNTRIES.find(country => country.id === (countryId || DEFAULT_COUNTRY_ID)) || LEAGUE_COUNTRIES[0]
);

export const getLeagueCountryIndex = (countryId?: string) => (
  Math.max(0, LEAGUE_COUNTRIES.findIndex(country => country.id === (countryId || DEFAULT_COUNTRY_ID)))
);
