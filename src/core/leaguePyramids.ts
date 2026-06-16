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

export const getLeagueCountry = (countryId?: string) => {
  const found = LEAGUE_COUNTRIES.find(country => country.id === (countryId || DEFAULT_COUNTRY_ID));
  return found || LEAGUE_COUNTRIES[0] || { id: 'england', label: 'England', reelHint: '', divisions: [] as Division[] };
};

export const getLeagueCountryIndex = (countryId?: string) => (
  LEAGUE_COUNTRIES.findIndex(country => country.id === (countryId || DEFAULT_COUNTRY_ID))
);
