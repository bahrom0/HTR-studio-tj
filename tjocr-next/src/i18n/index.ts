import ru from './dictionaries/ru.json';
import tg from './dictionaries/tg.json';

export type Locale = 'ru' | 'tg';
export type Dictionary = typeof ru;

export const dictionaries = {
  ru,
  tg,
};

export function getDictionary(locale: Locale) {
  return dictionaries[locale] || dictionaries.ru;
}
