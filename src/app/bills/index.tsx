import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable } from 'react-native';

import { Btn, Empty, Row, Screen, T } from '@/components/ui';
import { C } from '@/constants/theme';
import { confirmedBills, fmtMoney } from '@/lib/engine';
import { fmtDateTime, useT } from '@/lib/i18n';
import { useApp } from '@/lib/store';

const PAGE = 30;

export default function Bills() {
  const t = useT();
  const router = useRouter();
  const bills = confirmedBills(useApp());
  const [shown, setShown] = useState(PAGE);

  return (
    <Screen title={t('history')} tab="history" back={false} scroll={false}>
      <FlatList
        style={{ flex: 1 }}
        data={bills.slice(0, shown)}
        keyExtractor={(b) => b.id}
        ListEmptyComponent={<Empty title={t('noBills')} hint={t('noBillsHint')} />}
        ListFooterComponent={
          bills.length > shown ? <Btn kind="outline" label={t('showOlder')} onPress={() => setShown((n) => n + PAGE)} style={{ marginVertical: 12 }} /> : undefined
        }
        renderItem={({ item: b }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${b.ref} ${fmtMoney(b.totalPaise ?? 0)}`}
            onPress={() => router.push(`/bills/${b.id}`)}
            style={({ pressed }) => ({ minHeight: 64, paddingVertical: 10, justifyContent: 'center', borderBottomWidth: 1, borderColor: C.hairline, opacity: pressed ? 0.75 : 1 })}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T v="sub">{b.ref}</T>
              <T v="sub">{fmtMoney(b.totalPaise ?? 0)}</T>
            </Row>
            <T c="ash">
              {fmtDateTime(b.confirmedAt ?? b.createdAt)} · {b.pay === 'cash' ? t('payCash') : b.pay === 'upi' ? t('payUpi') : t('payStatusNone')}
            </T>
          </Pressable>
        )}
      />
    </Screen>
  );
}
