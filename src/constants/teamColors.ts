export interface TeamTheme {
    primary: string;
    secondary: string;
    stadium: string;
    founded: number;
}

const parseHexColor = (value: string) => {
    const normalized = value.trim().replace('#', '');
    if (normalized.length !== 6) return null;
    const parsed = Number.parseInt(normalized, 16);
    if (Number.isNaN(parsed)) return null;
    return {
        r: (parsed >> 16) & 255,
        g: (parsed >> 8) & 255,
        b: parsed & 255,
    };
};

const isLowContrastOnDark = (value: string) => {
    const rgb = parseHexColor(value);
    if (!rgb) return false;
    const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
    return luminance < 0.2;
};

export const getReadableTeamTextColor = (value: string) => (
    isLowContrastOnDark(value) ? '#f8fafc' : value
);

export const getDisplayKitColor = (value: string) => (
    isLowContrastOnDark(value) ? '#475569' : value
);

export const getDisplaySecondaryColor = (value: string) => (
    value === '#FFFFFF' ? '#e2e8f0' : getDisplayKitColor(value)
);

export const TEAM_COLORS: Record<string, TeamTheme> = {
    'Arsenal': { primary: '#EF0107', secondary: '#FFFFFF', stadium: 'Emirates Stadium', founded: 1886 },
    'Aston Villa': { primary: '#6C1D45', secondary: '#95BFE5', stadium: 'Villa Park', founded: 1874 },
    'Bournemouth': { primary: '#B50E12', secondary: '#000000', stadium: 'Vitality Stadium', founded: 1899 },
    'Brentford': { primary: '#E30613', secondary: '#FFFFFF', stadium: 'Gtech Community Stadium', founded: 1889 },
    'Brighton': { primary: '#0057B8', secondary: '#FFFFFF', stadium: 'Amex Stadium', founded: 1901 },
    'Burnley': { primary: '#6C1D45', secondary: '#99D6EA', stadium: 'Turf Moor', founded: 1882 },
    'Chelsea': { primary: '#034694', secondary: '#FFFFFF', stadium: 'Stamford Bridge', founded: 1905 },
    'Crystal Palace': { primary: '#1B458F', secondary: '#C4122E', stadium: 'Selhurst Park', founded: 1905 },
    'Everton': { primary: '#003399', secondary: '#FFFFFF', stadium: 'Goodison Park', founded: 1878 },
    'Fulham': { primary: '#FFFFFF', secondary: '#000000', stadium: 'Craven Cottage', founded: 1879 },
    'Leeds United': { primary: '#FFCD00', secondary: '#1D428A', stadium: 'Elland Road', founded: 1919 },
    'Liverpool': { primary: '#C8102E', secondary: '#FFFFFF', stadium: 'Anfield', founded: 1892 },
    'Luton Town': { primary: '#F78F1E', secondary: '#1C2C5B', stadium: 'Kenilworth Road', founded: 1885 },
    'Manchester City': { primary: '#6CABDD', secondary: '#1C2C5B', stadium: 'Etihad Stadium', founded: 1880 },
    'Manchester Utd': { primary: '#DA291C', secondary: '#000000', stadium: 'Old Trafford', founded: 1878 },
    'Newcastle Utd': { primary: '#000000', secondary: '#FFFFFF', stadium: 'St. James\' Park', founded: 1892 },
    'Nottingham Forest': { primary: '#DD0000', secondary: '#FFFFFF', stadium: 'City Ground', founded: 1865 },
    'Sunderland': { primary: '#EB172B', secondary: '#FFFFFF', stadium: 'Stadium of Light', founded: 1879 },
    'Sheffield Utd': { primary: '#EE2737', secondary: '#000000', stadium: 'Bramall Lane', founded: 1889 },
    'Tottenham Hotspur': { primary: '#132257', secondary: '#FFFFFF', stadium: 'Tottenham Hotspur Stadium', founded: 1882 },
    'West Ham Utd': { primary: '#7A263A', secondary: '#1BB1E7', stadium: 'London Stadium', founded: 1895 },
    'Wolves': { primary: '#FDB913', secondary: '#231F20', stadium: 'Molineux Stadium', founded: 1877 },
    'Leicester City': { primary: '#003090', secondary: '#FFFFFF', stadium: 'King Power Stadium', founded: 1884 },
};

const TEAM_ALIASES: Record<string, string> = {
    'man city': 'Manchester City',
    'man utd': 'Manchester Utd',
    'spurs': 'Tottenham Hotspur',
    'newcastle': 'Newcastle Utd',
    'west ham': 'West Ham Utd',
    'sheffield': 'Sheffield Utd',
    'nott': 'Nottingham Forest',
};

export const getTeamTheme = (teamName: string): TeamTheme => {
    const name = teamName.trim();
    // Exact match first
    if (TEAM_COLORS[name]) return TEAM_COLORS[name];

    const lower = name.toLowerCase();
    const aliasMatch = Object.entries(TEAM_ALIASES).find(([alias]) => lower.includes(alias));
    if (aliasMatch) {
        const matchedTeam = TEAM_ALIASES[aliasMatch[0]];
        if (TEAM_COLORS[matchedTeam]) return TEAM_COLORS[matchedTeam];
    }

    // Fuzzy: check if any key is contained in teamName or vice-versa
    const fuzzyKey = Object.keys(TEAM_COLORS).find(k => {
        const keyLower = k.toLowerCase();
        return lower.includes(keyLower) || keyLower.includes(lower);
    });
    if (fuzzyKey) return TEAM_COLORS[fuzzyKey];
    return { primary: '#f8fafc', secondary: '#0f172a', stadium: 'Community Stadium', founded: 1900 };
};

export const getTeamColor = (teamName: string) => {
    return getTeamTheme(teamName).primary;
};
