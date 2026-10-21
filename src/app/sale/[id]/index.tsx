import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList } from 'react-native';

import { BillItemRow, BillTotalBar, NoSale, useDraft } from '@/components/sale';
import { Btn, Empty, MicrophoneButton, Row, Screen, T, type MicState } from '@/components/ui';
import { openDrafts } from '@/lib/engine';
import { useT } from '@/lib/i18n';
import { actions } from '@/lib/store';

// ponytail: no speech engine is bundled, so the mic honestly reports UNAVAILABLE.
// Drive this from the local speech model's state (ready/listening/processing/results) when it lands.
const MIC: MicState = 'unavailable';

/** The whole sale lives here: add, correct, see the total, go to review. No separate edit screen. */
export default function NewBill() {
  const t = useT();
  const router = useRouter();
  const { id, app, sale } = useDraft();
  const [micTapped, setMicTapped] = useState(false);

  if (!sale) return <NoSale title={t('newBill')} />;

  return (
    <Screen
      title={t('newBill')}
      scroll={false}
      footer={
        <BillTotalBar items={sale.items}>
          <Btn label={t('reviewBill')} disabled={!sale.items.length} onPress={() => router.push(`/sale/${id}/review`)} />
        </BillTotalBar>
      }>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="h2">{t('saleN', { n: sale.label })}</T>
        <Btn size="sm" kind="outline" label={`${t('openSalesBtn')} (${openDrafts(app).length})`} onPress={() => router.push('/sales')} />
      </Row>

      <MicrophoneButton state={MIC} onPress={() => setMicTapped(true)} />
      {micTapped ? <T c="ash">{t('voiceOffHint')}</T> : null}

      <Row>
        <Btn label={t('addItem')} onPress={() => router.push(`/sale/${id}/search`)} style={{ flex: 1 }} />
        <Btn kind="outline" label={t('scanBarcode')} onPress={() => router.push(`/scan?saleId=${id}`)} style={{ flex: 1 }} />
      </Row>

      <FlatList
        style={{ flex: 1 }}
        data={sale.items}
        keyExtractor={(i) => i.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Empty title={t('billEmpty')} />}
        renderItem={({ item }) => (
          <BillItemRow
            item={item}
            onQty={(q) => actions.setQty(sale.id, item.id, q)}
            onReplace={() => router.push(`/sale/${id}/search?replace=${item.id}`)}
            onRemove={() => actions.removeItem(sale.id, item.id)}
          />
        )}
      />
    </Screen>
  );
}
