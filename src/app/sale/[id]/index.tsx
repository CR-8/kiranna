import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList } from 'react-native';

import { BillItemRow, BillTotalBar, NoSale, useDraft } from '@/components/sale';
import { Btn, Empty, MicrophoneButton, Row, Screen, T } from '@/components/ui';
import { micStateOf, useVoiceInput, VoiceStatus } from '@/components/voice';
import { openDrafts } from '@/lib/engine';
import { useT } from '@/lib/i18n';
import { actions } from '@/lib/store';

/** The whole sale lives here: add, correct, see the total, go to review. No separate edit screen. */
export default function NewBill() {
  const t = useT();
  const router = useRouter();
  const { id, app, sale } = useDraft();
  // Raw transcript only. Matching it to products/quantities belongs to the inventory layer.
  const [heard, setHeard] = useState<string | null>(null);
  const voice = useVoiceInput((r) => setHeard(r.transcript));

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

      <MicrophoneButton state={micStateOf(voice, heard)} onPress={voice.toggle} />
      {voice.state.status !== 'idle' || voice.webNote || heard ? <VoiceStatus voice={voice} heard={heard} /> : null}

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
