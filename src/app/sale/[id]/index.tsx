import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { NoSale, useDraft, useQtyLabel } from '@/components/sale';
import { Btn, Card, MicIcon, Row, Screen, T } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { fmtMoney, lineTotal, openDrafts, saleTotal } from '@/lib/engine';
import { useT } from '@/lib/i18n';
import { actions } from '@/lib/store';

export default function NewBill() {
  const t = useT();
  const router = useRouter();
  const qtyLabel = useQtyLabel();
  const { id, app, sale } = useDraft();
  const [voiceNote, setVoiceNote] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  if (!sale) return <NoSale title={t('newBill')} />;
  const others = openDrafts(app).filter((d) => d.id !== sale.id).length;

  const cancel = () => {
    if (sale.items.length && !confirmCancel) return setConfirmCancel(true);
    actions.discardSale(sale.id);
    router.replace('/');
  };

  return (
    <Screen
      title={t('newBill')}
      footer={
        sale.items.length ? (
          <Btn label={`${t('reviewBill')} · ${fmtMoney(saleTotal(sale.items))}`} onPress={() => router.push(`/sale/${id}/review`)} />
        ) : undefined
      }>
      <Card>
        <T v="caption" c="ash">{t('saleRef')}</T>
        <T v="h2">{t('saleN', { n: sale.label })}</T>
        <T c="ash">
          {t('itemsCount', { n: sale.items.length })} · {fmtMoney(saleTotal(sale.items))}
        </T>
      </Card>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('startSpeaking')}
        onPress={() => setVoiceNote(true)}
        style={({ pressed }) => ({
          minHeight: 96,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          borderRadius: R.card,
          borderWidth: 1,
          borderColor: C.ink,
          backgroundColor: C.paper,
          opacity: pressed ? 0.75 : 1,
        })}>
        <MicIcon size={32} />
        <T v="h3">{t('startSpeaking')}</T>
      </Pressable>

      <Card wash>
        <T v="caption" c="ash">{t('transcript')}</T>
        <T v="sub">{voiceNote ? t('voiceOff') : t('transcriptEmpty')}</T>
        {voiceNote ? <T c="ash">{t('voiceOffHint')}</T> : null}
      </Card>

      {sale.items.length ? (
        <Card>
          {sale.items.map((i) => (
            <Row key={i.id} style={{ justifyContent: 'space-between' }}>
              <T style={{ flex: 1 }}>
                {i.name} · {qtyLabel(i.qty, i.unit)}
              </T>
              <T>{fmtMoney(lineTotal(i.unitPaise, i.qty))}</T>
            </Row>
          ))}
          <Btn kind="wash" label={t('changeItems')} onPress={() => router.push(`/sale/${id}/edit`)} />
        </Card>
      ) : null}

      <Btn kind="outline" label={t('addManual')} onPress={() => router.push(`/sale/${id}/search`)} />
      <Btn kind="outline" label={t('scanBarcode')} onPress={() => router.push(`/scan?saleId=${id}`)} />
      {others > 0 ? <Btn kind="wash" label={`${t('openSalesBtn')} (${others})`} onPress={() => router.push('/sales')} /> : null}

      {confirmCancel ? (
        <Card wash>
          <T v="sub">{t('cancelAsk')}</T>
          <Btn kind="outline" label={t('cancelYes')} onPress={cancel} />
          <Btn kind="wash" label={t('keepBill')} onPress={() => setConfirmCancel(false)} />
        </Card>
      ) : (
        <Btn kind="wash" label={t('cancelBill')} onPress={cancel} />
      )}
    </Screen>
  );
}
