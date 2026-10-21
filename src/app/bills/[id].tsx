import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Share, View } from 'react-native';

import { useQtyLabel } from '@/components/sale';
import { Btn, Card, Empty, Row, Screen, T } from '@/components/ui';
import { C } from '@/constants/theme';
import { fmtMoney, lineTotal, receiptText } from '@/lib/engine';
import { fmtDateTime, useT } from '@/lib/i18n';
import { useApp } from '@/lib/store';

export default function Receipt() {
  const t = useT();
  const router = useRouter();
  const qtyLabel = useQtyLabel();
  const app = useApp();
  const { id, new: isNew } = useLocalSearchParams<{ id: string; new?: string }>();
  const bill = app.sales.find((s) => s.id === id && s.status === 'confirmed');
  const [msg, setMsg] = useState('');

  if (!bill) return <Screen title={t('receiptTitle')}><Empty title={t('noBills')} /></Screen>;

  // Payment is shown only when the shopkeeper actually recorded one.
  const payLine = bill.pay === 'cash' ? `${t('paymentRecorded')}: ${t('payCash')}` : bill.pay === 'upi' ? `${t('paymentRecorded')}: ${t('payUpi')} (${t('notVerified')})` : null;
  const text = receiptText(app.shopName, bill, payLine);

  const share = async () => {
    try {
      await Share.share({ message: text });
      setMsg(t('shareOpened'));
    } catch {
      try {
        await navigator.clipboard.writeText(text); // browsers without a share sheet
        setMsg(t('copied'));
      } catch {
        setMsg(t('shareFailed'));
      }
    }
  };
  const whatsapp = () =>
    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`)
      .then(() => setMsg(t('shareOpened')))
      .catch(() => setMsg(t('shareFailed')));

  return (
    <Screen
      title={t('receiptTitle')}
      back={!isNew}
      footer={<Btn label={t('done')} onPress={() => (isNew ? router.replace('/') : router.back())} />}>
      <Card>
        <T v="h2">{app.shopName}</T>
        <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <T v="sub">{bill.ref}</T>
          <T c="ash">{fmtDateTime(bill.confirmedAt ?? bill.createdAt)}</T>
        </Row>
        <View style={{ height: 1, backgroundColor: C.hairline }} />
        {bill.items.map((i) => (
          <View key={i.id} style={{ gap: 2 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <T style={{ flex: 1 }}>{i.name}</T>
              <T>{fmtMoney(lineTotal(i.unitPaise, i.qty))}</T>
            </Row>
            <T v="caption" c="ash">
              {qtyLabel(i.qty, i.unit)} × {fmtMoney(i.unitPaise)}
            </T>
          </View>
        ))}
        <View style={{ height: 1, backgroundColor: C.hairline }} />
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="caption" c="ash">{t('total')}</T>
          <T v="h1">{fmtMoney(bill.totalPaise ?? 0)}</T>
        </Row>
        {payLine ? <T c="ash">{payLine}</T> : null}
      </Card>

      {isNew ? <T v="sub">✓ {t('billSaved')}</T> : null}
      <Row>
        <Btn kind="outline" label={t('shareWhatsapp')} onPress={whatsapp} style={{ flex: 1 }} />
        <Btn kind="outline" label={t('share')} onPress={share} style={{ flex: 1 }} />
      </Row>
      {msg ? <Card wash><T>{msg}</T></Card> : null}
    </Screen>
  );
}
