import { InboxMessage } from '../models/types';
import {
  buildMessage,
  getMessageTitleForNews,
  getSystemMessageCategory,
} from './inboxCore';

export const buildLegacyInboxMessages = (news: string[], week = 1) => (
  news
    .filter(item => getSystemMessageCategory(item) !== 'system_news')
    .map(item => buildMessage({
      week,
      source: 'system',
      category: getSystemMessageCategory(item),
      title: getMessageTitleForNews(item),
      body: item,
      isRead: true,
    }))
);

export const generateSystemInboxMessages = (week: number, news: string[], season?: number) => (
  news
    .filter(item => getSystemMessageCategory(item) !== 'system_news')
    .map(item => buildMessage({
      week,
      season,
      source: 'system',
      category: getSystemMessageCategory(item),
      title: getMessageTitleForNews(item),
      body: item,
      isRead: false,
    }))
);

/** Generate a career milestone message when the user manually switches teams via Settings. */
export const generateTeamSwitchMessage = (
  week: number,
  previousTeamName: string,
  newTeamName: string,
  newDivision: string,
): InboxMessage =>
  buildMessage({
    week,
    source: 'system',
    category: 'career_milestone',
    title: `Took charge of ${newTeamName}`,
    body: `You have left ${previousTeamName} and taken control of ${newTeamName} (${newDivision}). This move was initiated from the Settings screen.`,
    isRead: true,
  });
