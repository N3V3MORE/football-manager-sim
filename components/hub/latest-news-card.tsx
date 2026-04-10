import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type LatestNewsCardProps = {
  news: string[];
};

export function LatestNewsCard({ news }: LatestNewsCardProps) {
  const items = news.slice(0, 3);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>LEAGUE NEWS</Text>
      {items.length > 0 ? (
        items.map((item, index) => (
          <View key={`${index}-${item}`} style={styles.newsItem}>
            <Text style={styles.newsText}>{item}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.newsText}>No news yet. Advance the week to see updates!</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111827',
    marginHorizontal: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    marginTop: 14,
  },
  cardTitle: { fontSize: 13, fontWeight: '900', marginBottom: 16, color: '#facc15', letterSpacing: 1.2, textTransform: 'uppercase' },
  newsItem: { marginBottom: 8 },
  newsText: { fontSize: 14, color: '#cbd5e1', lineHeight: 22, fontWeight: '600' },
});
