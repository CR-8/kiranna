import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';

import { Btn, ConfirmAction, Empty, Row, Screen, T } from '@/components/ui';
import { C } from '@/constants/theme';
import { fmtMoney, openDrafts, saleTotal } from '@/lib/engine';
import { useT } from '@/lib/i18n';
import { actions, useApp } from '@/lib/store';

/** Anonymous open sales: reference, item count, total, OPEN. Drafts persist across restarts. */
export default function Sales() {
  const t = useT();
  const router = useRouter();
  const drafts = openDrafts(useApp());
  const [closing, setClosing] = useState<string | null>(null);

  return (
    <Screen
      title={t('openSales')}
      scroll={false}
      footer={<Btn label={t('newSale')} onPress={() => router.replace(`/sale/${actions.startSale()}`)} />}>
      <FlatList
        style={{ flex: 1 }}
        data={drafts}
        keyExtractor={(d) => d.id}
        ListEmptyComponent={<Empty title={t('noOpenSales')} hint={t('noOpenSalesHint')} />}
        renderItem={({ item: d }) => (
          <View style={{ paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderColor: C.hairline }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View>
                <T v="h3">{t('saleN', { n: d.label })}</T>
                <T c="ash">{t('itemsCount', { n: d.items.length })} · {fmtMoney(saleTotal(d.items))}</T>
              </View>
              <Btn size="sm" label={t('openSale')} onPress={() => router.replace(`/sale/${d.id}`)} style={{ minWidth: 110 }} />
            </Row>
            {closing === d.id ? (
              <ConfirmAction
                ask={t('closeAsk')}
                yes={t('closeYes')}
                no={t('keep')}
                onYes={() => {
                  actions.discardSale(d.id);
                  setClosing(null);
                }}
                onNo={() => setClosing(null)}
              />
            ) : (
              <Btn size="sm" kind="wash" label={t('closeDraft')} onPress={() => (d.items.length ? setClosing(d.id) : actions.discardSale(d.id))} style={{ alignSelf: 'flex-start' }} />
            )}
          </View>
        )}
      />
    </Screen>
  );
}
