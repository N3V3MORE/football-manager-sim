const channels = (hex: string): number[] => {
  if (!/^#([a-f\d]{3}|[a-f\d]{6})$/i.test(hex)) throw new Error('Text colours must use RGB hex values.');
  const rgb = hex.length === 4 ? hex.slice(1).split('').map(value => value + value).join('') : hex.slice(1);
  return [0, 2, 4].map(offset => parseInt(rgb.slice(offset, offset + 2), 16));
};

const luminance = (hex: string) => channels(hex).map(value => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);

export const getTextContrast = (foreground: string, background: string): number => {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
};

/** Preserve readable colours; otherwise make the smallest contrasting tint. */
export function getReadableTextColor(foreground: string, background: string): string {
  if (getTextContrast(foreground, background) >= 4.5) return foreground;
  const rgb = channels(foreground);
  const destination = getTextContrast('#ffffff', background) >= 4.5 ? 255 : 0;
  const tint = (amount: number) => '#' + rgb.map(channel => Math.round(channel + (destination - channel) * amount / 255).toString(16).padStart(2, '0')).join('');
  let minimum = 1;
  let maximum = 255;
  while (minimum < maximum) {
    const middle = Math.floor((minimum + maximum) / 2);
    if (getTextContrast(tint(middle), background) >= 4.5) maximum = middle;
    else minimum = middle + 1;
  }
  return tint(minimum);
}
