import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type CalendarWindowBannerProps = {
  text: string;
  isOpen: boolean;
};

export const CalendarWindowBanner = React.memo(function CalendarWindowBanner({ text, isOpen }: CalendarWindowBannerProps) {
  return (
    <View style={isOpen ? styles.windowBanner : styles.windowBannerClosed}>
      <Text style={styles.windowText}>{text}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  windowBanner: { backgroundColor: '#064e3b', paddingVertical: 6, alignItems: 'center', marginVertical: 4 },
  windowBannerClosed: { backgroundColor: '#7f1d1d', paddingVertical: 6, alignItems: 'center', marginVertical: 4 },
  windowText: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
});
