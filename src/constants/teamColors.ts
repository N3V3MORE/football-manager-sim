export interface TeamTheme {
    primary: string;
    secondary: string;
    stadium: string;
    founded: number;
}

export const TEAM_COLORS: Record<string, TeamTheme> = {
    'Arsenal': { primary: '#EF0107', secondary: '#FFFFFF', stadium: 'Emirates Stadium', founded: 1886 },
    'Aston Villa': { primary: '#670E36', secondary: '#95BFE5', stadium: 'Villa Park', founded: 1874 },
    'Bournemouth': { primary: '#B50E12', secondary: '#000000', stadium: 'Vitality Stadium', founded: 1899 },
    'Brentford': { primary: '#E30613', secondary: '#FFFFFF', stadium: 'Gtech Community Stadium', founded: 1889 },
    'Brighton': { primary: '#0057B8', secondary: '#FFFFFF', stadium: 'Amex Stadium', founded: 1901 },
    'Chelsea': { primary: '#034694', secondary: '#FFFFFF', stadium: 'Stamford Bridge', founded: 1905 },
    'Crystal Palace': { primary: '#1B458F', secondary: '#C4122E', stadium: 'Selhurst Park', founded: 1905 },
    'Everton': { primary: '#003399', secondary: '#FFFFFF', stadium: 'Goodison Park', founded: 1878 },
    'Fulham': { primary: '#FFFFFF', secondary: '#000000', stadium: 'Craven Cottage', founded: 1879 },
    'Liverpool': { primary: '#C8102E', secondary: '#FFFFFF', stadium: 'Anfield', founded: 1892 },
    'Luton Town': { primary: '#F78F1E', secondary: '#1C2C5B', stadium: 'Kenilworth Road', founded: 1885 },
    'Manchester City': { primary: '#6CABDD', secondary: '#1C2C5B', stadium: 'Etihad Stadium', founded: 1880 },
    'Manchester Utd': { primary: '#DA291C', secondary: '#000000', stadium: 'Old Trafford', founded: 1878 },
    'Newcastle Utd': { primary: '#000000', secondary: '#FFFFFF', stadium: 'St. James\' Park', founded: 1892 },
    'Nottingham Forest': { primary: '#DD0000', secondary: '#FFFFFF', stadium: 'City Ground', founded: 1865 },
    'Sheffield Utd': { primary: '#EE2737', secondary: '#000000', stadium: 'Bramall Lane', founded: 1889 },
    'Tottenham Hotspur': { primary: '#132257', secondary: '#FFFFFF', stadium: 'Tottenham Hotspur Stadium', founded: 1882 },
    'West Ham Utd': { primary: '#7A263A', secondary: '#1BB1E7', stadium: 'London Stadium', founded: 1895 },
    'Wolves': { primary: '#FDB913', secondary: '#231F20', stadium: 'Molineux Stadium', founded: 1877 },
    'Leicester City': { primary: '#003090', secondary: '#FFFFFF', stadium: 'King Power Stadium', founded: 1884 },
};

export const getTeamTheme = (teamName: string): TeamTheme => {
    const name = teamName.trim();
    // Exact match first
    if (TEAM_COLORS[name]) return TEAM_COLORS[name];
    // Fuzzy: check if any key is contained in teamName or vice-versa
    const lower = name.toLowerCase();
    const fuzzyKey = Object.keys(TEAM_COLORS).find(k => {
        const kl = k.toLowerCase();
        return lower.includes(kl) || kl.includes(lower) ||
            // short form aliases
            (lower.includes('man city') && kl === 'manchester city') ||
            (lower.includes('man utd') && kl === 'manchester utd') ||
            (lower.includes('spurs') && kl === 'tottenham hotspur') ||
            (lower.includes('newcastle') && kl === 'newcastle utd') ||
            (lower.includes('west ham') && kl === 'west ham utd') ||
            (lower.includes('sheffield') && kl === 'sheffield utd') ||
            (lower.includes('nott') && kl === 'nottingham forest');
    });
    if (fuzzyKey) return TEAM_COLORS[fuzzyKey];
    return { primary: '#f8fafc', secondary: '#0f172a', stadium: 'Community Stadium', founded: 1900 };
};

export const getTeamColor = (teamName: string) => {
    return getTeamTheme(teamName).primary;
};
