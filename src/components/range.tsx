import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { Choice, Field, Row, T } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { customRange, formatDay, rangeFor, type Range, type RangeKey } from '@/lib/insights';

export type RangePick = RangeKey | 'all';

/**
 * Today / Yesterday / This week / This month / Custom (and optionally All) chips, plus the chosen [from, to).
 * `range` is null for All and for a custom range that is not valid yet (`invalid` tells which).
 * Pass `preset` to open on a specific range, e.g. when a report row links to the bills behind it.
 */
export function useRange(initial: RangePick = 'today', opts: { all?: boolean; preset?: Range } = {}) {
  const t = useT();
  const [key, setKey] = useState<RangePick>(opts.preset ? 'custom' : initial);
  const [from, setFrom] = useState(opts.preset ? formatDay(opts.preset.from) : '');
  const [to, setTo] = useState(opts.preset ? formatDay(opts.preset.to - 1) : '');
  const [now, setNow] = useState(Date.now);
  useFocusEffect(useCallback(() => setNow(Date.now()), [])); // "Today" must not go stale overnight

  const custom = key === 'custom' ? customRange(from, to) : null;
  const range: Range | null = key === 'all' ? null : key === 'custom' ? custom : rangeFor(key, now);
  const invalid = key === 'custom' && !custom;

  const options: [RangePick, string][] = [
    ...(opts.all ? ([['all', t('rangeAll')]] as [RangePick, string][]) : []),
    ['today', t('rangeToday')],
    ['yesterday', t('rangeYesterday')],
    ['week', t('rangeWeek')],
    ['month', t('rangeMonth')],
    ['custom', t('rangeCustom')],
  ];
  const ui = (
    <View style={{ gap: 8 }}>
      <Choice value={key} onChange={setKey} options={options} />
      {key === 'custom' ? (
        <View style={{ gap: 4 }}>
          <Row>
            <View style={{ flex: 1 }}>
              <Field label={t('dateFrom')} value={from} onChangeText={setFrom} placeholder="DD/MM/YYYY" keyboardType="numbers-and-punctuation" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label={t('dateTo')} value={to} onChangeText={setTo} placeholder="DD/MM/YYYY" keyboardType="numbers-and-punctuation" />
            </View>
          </Row>
          {invalid ? <T c="ash">{t('dateHint')}</T> : null}
        </View>
      ) : null}
    </View>
  );
  return { key, range, invalid, now, ui };
}
