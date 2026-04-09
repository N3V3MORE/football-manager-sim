import { LeagueId } from '../models/types';
import { COUNTRY_DEFINITIONS, DEFAULT_COUNTRY_ID, getCountryLeagues } from './domainRegistry';

export interface LeagueCountryPyramid {
  id: string;
  label: string;
  reelHint: string;
  divisions: LeagueId[];
}

export const LEAGUE_COUNTRIES: LeagueCountryPyramid[] = [
  ...Object.values(COUNTRY_DEFINITIONS)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.displayName.localeCompare(right.displayName))
    .map(country => ({
      id: country.id,
      label: country.displayName,
      reelHint: country.reelHint,
      divisions: getCountryLeagues(country.id),
    })),
];

export { DEFAULT_COUNTRY_ID };

export const getLeagueCountry = (countryId?: string) => (
  LEAGUE_COUNTRIES.find(country => country.id === (countryId || DEFAULT_COUNTRY_ID)) || LEAGUE_COUNTRIES[0]
);

export const getLeagueCountryIndex = (countryId?: string) => (
  Math.max(0, LEAGUE_COUNTRIES.findIndex(country => country.id === (countryId || DEFAULT_COUNTRY_ID)))
);
