import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { NoSale, useDraft, useQtyLabel } from '@/components/sale';
import { Btn, Card, Choice, Row, Screen, T } from '@/components/ui';
import { EngineError, fmtMoney, fmtQty, lineTotal, saleTotal, stockShortages, type PayMethod } from '@/lib/engine';
import { useT } from '@/lib/i18n';
import { actions } from '@/lib/store';

export default function Review() {
  const t = useT();
  const router = useRouter();
  const qtyLabel = useQtyLabel();
  const { id, app, sale } = useDraft();
  const [pay, setPay] = useState<PayMethod>('none');
  const [askOverride, setAskOverride] = useState(false);
  const [error, setError] = useState('');

  if (!sale) return <NoSale title={t('reviewTitle')} />;
  const short = stockShortages(app, sale);

  const confirm = (override = false) => {
    if (short.length && !override) return setAskOverride(true);
    try {
      actions.confirmSale(sale.id, pay, override);
      router.replace(`/bills/${id}?new=1`);
    } catch (e) {
      setError(e instanceof EngineError ? t(e.code === 'EMPTY' ? 'billEmpty' : 'confirmFailed') : t('confirmFailed'));
    }
  };

  return (
    <Screen
      title={t('reviewTitle')}
      footer={
        <>
          <Btn label={t('yesCorrect')} onPress={() => confirm()} disabled={!sale.items.length} />
          <Btn kind="outline" label={t('noChange')} onPress={() => router.replace(`/sale/${id}/edit`)} />
        </>
      }>
      <Card>
        <T v="caption" c="ash">{t('saleRef')}</T>
        <T v="h3">{t('saleN', { n: sale.label })}</T>
      </Card>

      {sale.items.length === 0 ? (
        <Card wash><T v="sub">{t('billEmpty')}</T></Card>
      ) : (
        <Card>
          {sale.items.map((i, n) => (
            <View key={i.id} style={{ gap: 4, paddingTop: n ? 12 : 0, borderTopWidth: n ? 1 : 0, borderColor: '#e5e7eb' }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <T v="sub" style={{ flex: 1 }}>{i.name}</T>
                <T v="sub">{fmtMoney(lineTotal(i.unitPaise, i.qty))}</T>
              </Row>
              <T c="ash">
                {qtyLabel(i.qty, i.unit)} × {fmtMoney(i.unitPaise)}
              </T>
            </View>
          ))}
        </Card>
      )}

      <Card wash>
        <T v="caption" c="ash">{t('total')}</T>
        <T v="h1">{fmtMoney(saleTotal(sale.items))}</T>
      </Card>

      {short.length ? (
        <Card>
          <T v="sub">⚠ {t('stockWarn')}</T>
          {short.map((x) => (
            <T key={x.productId}>
              {x.name}: {t('need')} {fmtQty(x.need)}, {t('have')} {fmtQty(x.have)}
            </T>
          ))}
        </Card>
      ) : null}

      <Choice
        label={t('paymentRecorded')}
        value={pay}
        onChange={setPay}
        options={[
          ['cash', t('payCash')],
          ['upi', t('payUpi')],
          ['none', t('payNone')],
        ]}
      />
      <T v="caption" c="ash">{t('payNote')}</T>

      {askOverride ? (
        <Card wash>
          <T v="sub">{t('overrideAsk')}</T>
          <Btn kind="outline" label={t('sellAnyway')} onPress={() => confirm(true)} />
          <Btn kind="wash" label={t('changeBillShort')} onPress={() => router.replace(`/sale/${id}/edit`)} />
        </Card>
      ) : null}
      {error ? <T>⚠ {error}</T> : null}
    </Screen>
  );
}
