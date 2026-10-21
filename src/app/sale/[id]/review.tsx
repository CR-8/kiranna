import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { FlatList, View } from 'react-native';

import { BillTotalBar, NoSale, useDraft, useQtyLabel } from '@/components/sale';
import { Btn, ConfirmAction, Choice, Empty, ErrorMessage, Field, Row, Screen, T } from '@/components/ui';
import { C } from '@/constants/theme';
import { EngineError, fmtMoney, fmtQty, lineTotal, parsePaise, saleTotal, stockShortages, type PayMethod } from '@/lib/engine';
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
  const [discount, setDiscount] = useState<string | null>(null); // null = no discount field shown
  const confirming = useRef(false); // a double tap must never run the commit twice

  if (!sale) return <NoSale title={t('reviewTitle')} />;
  const short = stockShortages(app, sale);
  const gross = saleTotal(sale.items);
  const disc = discount?.trim() ? parsePaise(discount, true) : 0;
  const discBad = disc === null || disc > gross;

  const confirm = (override = false) => {
    if (confirming.current) return;
    if (discBad) return setError(t('errDiscount'));
    if (short.length && !override) return setAskOverride(true);
    confirming.current = true;
    try {
      actions.confirmSale(sale.id, pay, override, disc ?? 0);
      router.replace(`/bills/${id}?new=1`);
    } catch (e) {
      confirming.current = false;
      setError(e instanceof EngineError && e.code === 'EMPTY' ? t('billEmpty') : t('confirmFailed'));
    }
  };

  return (
    <Screen
      title={t('reviewTitle')}
      scroll={false}
      footer={
        <>
          <BillTotalBar items={sale.items} discountPaise={discBad ? 0 : (disc ?? 0)}>
            <Btn label={t('yesCorrect')} onPress={() => confirm()} disabled={!sale.items.length} />
          </BillTotalBar>
          <Btn kind="outline" label={t('noChange')} onPress={() => router.back()} />
        </>
      }>
      <T v="h3">{t('saleN', { n: sale.label })}</T>
      <FlatList
        style={{ flex: 1 }}
        data={sale.items}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={<Empty title={t('billEmpty')} />}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: C.hairline }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <T v="sub" style={{ flex: 1 }}>{item.name}</T>
              <T v="sub">{fmtMoney(lineTotal(item.unitPaise, item.qty))}</T>
            </Row>
            <T c="ash">
              {qtyLabel(item.qty, item.unit)} × {fmtMoney(item.unitPaise)}
            </T>
          </View>
        )}
      />

      {short.length ? (
        <View>
          <T v="sub">⚠ {t('stockWarn')}</T>
          {short.map((x) => (
            <T key={x.productId}>
              {x.name}: {t('need')} {fmtQty(x.need)}, {t('have')} {fmtQty(x.have)}
            </T>
          ))}
        </View>
      ) : null}
      {askOverride ? (
        <ConfirmAction ask={t('overrideAsk')} yes={t('sellAnyway')} no={t('noChange')} onYes={() => confirm(true)} onNo={() => router.back()} />
      ) : null}
      {error ? <ErrorMessage text={error} /> : null}

      <Choice
        row
        label={t('paymentRecorded')}
        value={pay}
        onChange={setPay}
        options={[
          ['cash', t('payCash')],
          ['upi', t('payUpi')],
          ['none', t('payNone')],
        ]}
      />
      {discount === null ? (
        <Btn kind="wash" size="sm" label={t('addDiscount')} onPress={() => setDiscount('')} />
      ) : (
        <Field label={`${t('discount')} (₹)`} value={discount} onChangeText={(v) => { setDiscount(v); setError(''); }} keyboardType="decimal-pad" placeholder="0" autoFocus />
      )}
      {pay === 'upi' ? <T v="caption" c="ash">{t('payNote')}</T> : null}
    </Screen>
  );
}
